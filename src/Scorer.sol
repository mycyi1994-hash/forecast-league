// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPriceFeed {
    function decimals() external view returns (uint8);

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface ILeagueCore {
    function submissionOf(address agent, uint32 epoch)
        external
        view
        returns (uint64[3] memory prices, uint40 submittedAt);
}

/// @title Scorer
/// @notice Fixes the reference prices of each round from on-chain price feeds and scores the
///         forecasts recorded in LeagueCore. Every function can be called by anyone.
/// @dev There is no owner and nothing here can be changed after deployment. If a bug is found,
///      a new Scorer is deployed and the same submissions are scored again; LeagueCore is unaffected.
///
///      Round timing for epoch `e`:
///        lock time   = (e + 1) * 1 days            (00:00 UTC after the submission day)
///        target time = lock time + horizon
///      Score of one forecast, compared with "doing nothing" (submitting the lock price P0):
///        (|P1 - P0| - |P1 - forecast|) * 100 / max(|P1 - P0|, P0 / 1000), limited to -100..100
///      The division rounds toward zero.
contract Scorer {
    uint256 public constant EPOCH = 1 days;
    /// @notice A feed round is accepted only if it was updated at or before the reference time,
    ///         no more than this long before it, and the feed round right after it was not also
    ///         updated at or before the reference time. In other words it must be the latest one.
    uint256 public constant MAX_LAG = 30 minutes;
    /// @notice After a round is first settled, anyone may replace its prices with feed rounds
    ///         that are closer to the reference times during this window. Then it is final.
    ///         This only matters when a feed switches to a new series of round numbers.
    uint256 public constant CHALLENGE = 30 minutes;
    /// @notice A round that nobody settled within this time after its target time is void for
    ///         good: it can no longer be settled, and forecasts for it are skipped by everyone.
    uint256 public constant VOID_AFTER = 7 days;
    /// @notice Scored epochs needed for `isQualified`.
    uint32 public constant MIN_EPOCHS = 5;

    ILeagueCore public immutable core;
    /// @notice Seconds between lock time and target time.
    uint256 public immutable horizon;
    IPriceFeed public immutable feedBtc;
    IPriceFeed public immutable feedEth;
    IPriceFeed public immutable feedBnb;

    struct Round {
        uint64 p0; // price at lock time
        uint40 t0; // feed update time of p0
        uint64 p1; // price at target time
        uint40 t1; // feed update time of p1
        uint40 firstSettledAt;
    }

    struct Stats {
        uint32 epochs; // scored epochs
        uint32 forecasts; // scored single-pair forecasts
        uint32 wins; // forecasts with a positive score
        int64 total; // sum of scores
    }

    mapping(uint32 => mapping(uint8 => Round)) private _rounds;
    mapping(address => Stats) private _stats;
    mapping(address => mapping(uint32 => bool)) public scored;

    event Settled(uint32 indexed epoch, uint8 indexed feed, uint64 p0, uint40 t0, uint64 p1, uint40 t1);
    event Scored(address indexed agent, uint32 indexed epoch, int16 btc, int16 eth, int16 bnb, int64 total);

    error BadFeedIndex();
    error TooEarly();
    error RoundFinal();
    error BadFeedRound();
    error NotLatestRound();
    error RoundVoid();
    error NotCloser();
    error AlreadyScored();
    error NoSubmission();
    error NotFinal();

    constructor(address core_, address feedBtc_, address feedEth_, address feedBnb_, uint256 horizon_) {
        require(horizon_ >= 1 hours && horizon_ <= 1 days, "horizon");
        require(core_.code.length != 0, "core");
        require(
            IPriceFeed(feedBtc_).decimals() == 8 && IPriceFeed(feedEth_).decimals() == 8
                && IPriceFeed(feedBnb_).decimals() == 8,
            "feed decimals"
        );
        core = ILeagueCore(core_);
        feedBtc = IPriceFeed(feedBtc_);
        feedEth = IPriceFeed(feedEth_);
        feedBnb = IPriceFeed(feedBnb_);
        horizon = horizon_;
    }

    // ---------------------------------------------------------------- settle

    /// @notice Fix the lock and target prices of one pair for one epoch.
    /// @param feedRoundLock   Feed round whose update time is the latest one at or before lock time.
    /// @param feedRoundTarget Feed round whose update time is the latest one at or before target time.
    /// @dev Anyone can call this. During the challenge window a later call wins only if its feed
    ///      rounds are at least as close to the reference times and one of them is strictly closer.
    function settle(uint32 epoch, uint8 feed, uint80 feedRoundLock, uint80 feedRoundTarget) external {
        IPriceFeed f = _feed(feed);
        uint256 lockAt = lockTime(epoch);
        uint256 targetAt = lockAt + horizon;
        // Strictly after the target time, so every feed round at or before it already exists.
        if (block.timestamp <= targetAt) revert TooEarly();

        Round storage r = _rounds[epoch][feed];
        if (r.firstSettledAt == 0) {
            if (block.timestamp >= targetAt + VOID_AFTER) revert RoundVoid();
        } else if (block.timestamp >= uint256(r.firstSettledAt) + CHALLENGE) {
            revert RoundFinal();
        }

        (uint64 p0, uint40 t0) = _read(f, feedRoundLock, lockAt);
        (uint64 p1, uint40 t1) = _read(f, feedRoundTarget, targetAt);

        if (r.firstSettledAt == 0) {
            r.firstSettledAt = uint40(block.timestamp);
        } else {
            bool notWorse = t0 >= r.t0 && t1 >= r.t1;
            bool closer = t0 > r.t0 || t1 > r.t1;
            if (!notWorse || !closer) revert NotCloser();
        }

        r.p0 = p0;
        r.t0 = t0;
        r.p1 = p1;
        r.t1 = t1;
        emit Settled(epoch, feed, p0, t0, p1, t1);
    }

    // ----------------------------------------------------------------- score

    /// @notice Score one address for one epoch and add the result to its record.
    function score(address agent, uint32 epoch) public {
        if (scored[agent][epoch]) revert AlreadyScored();
        (uint64[3] memory prices, uint40 submittedAt) = core.submissionOf(agent, epoch);
        if (submittedAt == 0) revert NoSubmission();

        int16[3] memory s;
        Stats memory st = _stats[agent];
        bool any;
        for (uint8 i = 0; i < 3; i++) {
            if (prices[i] == 0) continue;
            Round memory r = _rounds[epoch][i];
            if (!_isFinal(r)) {
                // A void round can never be settled any more, so skipping it is the same for everyone.
                if (r.firstSettledAt == 0 && block.timestamp >= lockTime(epoch) + horizon + VOID_AFTER) continue;
                revert NotFinal();
            }
            s[i] = scoreOf(r.p0, r.p1, prices[i]);
            st.forecasts += 1;
            if (s[i] > 0) st.wins += 1;
            st.total += s[i];
            any = true;
        }
        // An epoch in which every forecast was void does not count as a scored epoch.
        if (any) st.epochs += 1;
        _stats[agent] = st;
        scored[agent][epoch] = true;
        emit Scored(agent, epoch, s[0], s[1], s[2], st.total);
    }

    /// @notice Score many addresses for one epoch. Addresses that cannot be scored are skipped.
    function scoreMany(address[] calldata agents, uint32 epoch) external {
        for (uint256 i = 0; i < agents.length; i++) {
            try this.score(agents[i], epoch) {} catch {}
        }
    }

    /// @notice The score formula. Submitting the lock price itself scores 0.
    function scoreOf(uint64 p0, uint64 p1, uint64 forecast) public pure returns (int16) {
        int256 base = _absDiff(p1, p0);
        int256 err = _absDiff(p1, forecast);
        int256 floor_ = int256(uint256(p0) / 1000);
        if (floor_ == 0) floor_ = 1;
        int256 denom = base > floor_ ? base : floor_;
        int256 v = ((base - err) * 100) / denom;
        if (v > 100) v = 100;
        if (v < -100) v = -100;
        return int16(v);
    }

    // ----------------------------------------------------------------- views

    function lockTime(uint32 epoch) public pure returns (uint256) {
        return (uint256(epoch) + 1) * EPOCH;
    }

    function roundOf(uint32 epoch, uint8 feed) external view returns (Round memory round, bool isFinal) {
        round = _rounds[epoch][feed];
        isFinal = _isFinal(round);
    }

    function statsOf(address agent) external view returns (uint32 epochs, uint32 forecasts, uint32 wins, int64 total) {
        Stats memory st = _stats[agent];
        return (st.epochs, st.forecasts, st.wins, st.total);
    }

    /// @notice True once an address has at least MIN_EPOCHS scored epochs and a positive total,
    ///         meaning that on balance it did better than submitting the lock price.
    function isQualified(address agent) external view returns (bool) {
        Stats memory st = _stats[agent];
        return st.epochs >= MIN_EPOCHS && st.total > 0;
    }

    // -------------------------------------------------------------- internal

    function _feed(uint8 feed) private view returns (IPriceFeed) {
        if (feed == 0) return feedBtc;
        if (feed == 1) return feedEth;
        if (feed == 2) return feedBnb;
        revert BadFeedIndex();
    }

    function _read(IPriceFeed f, uint80 feedRound, uint256 refTime) private view returns (uint64 price, uint40 at) {
        (, int256 answer,, uint256 updatedAt,) = f.getRoundData(feedRound);
        if (answer <= 0 || uint256(answer) > type(uint64).max) revert BadFeedRound();
        if (updatedAt == 0 || updatedAt > refTime || refTime - updatedAt > MAX_LAG) revert BadFeedRound();
        // It must be the latest round at or before the reference time: the next round must not
        // qualify too. A feed answers with zeros or reverts for a round that does not exist.
        try f.getRoundData(feedRound + 1) returns (uint80, int256 nextAnswer, uint256, uint256 nextUpdatedAt, uint80) {
            if (nextAnswer > 0 && nextUpdatedAt != 0 && nextUpdatedAt <= refTime) revert NotLatestRound();
        } catch {}
        return (uint64(uint256(answer)), uint40(updatedAt));
    }

    function _isFinal(Round memory r) private view returns (bool) {
        return r.firstSettledAt != 0 && block.timestamp >= uint256(r.firstSettledAt) + CHALLENGE;
    }

    function _absDiff(uint64 a, uint64 b) private pure returns (int256) {
        return a >= b ? int256(uint256(a - b)) : int256(uint256(b - a));
    }
}
