// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The function of the official Agent ID registry that this contract reads.
interface IAgentIDHolder {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice Chainlink-style price feed.
interface IBlitzFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title Blitz
/// @notice A short forecasting round for Agent ID holders: will BTC/USD be higher or lower six
///         hours after the round locks? One pick per round with `up()` or `down()`, and `claim()`
///         writes finished rounds into the caller's record. Every call takes no arguments, so an
///         agent can play with fixed call data.
/// @dev There is no owner, no upgrade path, no payable function and no token movement.
///
///      Round `r` is open for picks during [r * ROUND, (r + 1) * ROUND).
///        lock time   = (r + 1) * ROUND
///        target time = lock time + ROUND
///      The result compares the feed price at the target time with the feed price at the lock
///      time. Both are the latest feed round at or before that time, found on-chain, so nobody
///      supplies a price or a feed round. A higher price is "up", a lower one "down", an equal
///      one a push. A round is void if the feed had no update in the MAX_LAG before either time,
///      or if nobody settled it while its feed rounds were still within SEARCH_WINDOW.
contract Blitz {
    uint256 public constant ROUND = 6 hours;
    /// @notice A feed round is used only if it was updated no more than this long before the
    ///         reference time.
    uint256 public constant MAX_LAG = 30 minutes;
    /// @notice How many feed rounds back from the latest one the on-chain search looks.
    uint256 public constant SEARCH_WINDOW = 16384;
    /// @notice Most rounds one `claim()` writes. Call again if more are finished.
    uint256 public constant MAX_CLAIM = 12;

    uint8 private constant NONE = 0;
    uint8 private constant UP = 1;
    uint8 private constant DOWN = 2;
    uint8 private constant PUSH = 3;
    uint8 private constant VOID = 4;

    IAgentIDHolder public immutable agentId;
    IBlitzFeed public immutable feed;

    struct Result {
        uint64 p0; // price at lock time
        uint64 p1; // price at target time
        uint8 outcome; // 0 not settled, 1 up, 2 down, 3 push, 4 void
    }

    struct Record {
        uint32 picks;
        uint32 wins;
        uint32 losses;
        uint32 streak; // current run of wins
        uint32 bestStreak;
        uint32 claimed; // how many of the address's picked rounds are written to the record
    }

    /// @notice Number of addresses that have made at least one pick.
    uint256 public totalPlayers;
    /// @notice Number of picks ever made.
    uint256 public totalPicks;

    mapping(uint32 => Result) private _results;
    mapping(address => Record) private _records;
    mapping(address => uint32[]) private _picked; // rounds an address picked in, oldest first
    mapping(address => mapping(uint32 => uint8)) private _pick; // 1 up, 2 down

    event Picked(address indexed agent, uint32 indexed round, bool up);
    event Settled(uint32 indexed round, uint64 p0, uint64 p1, uint8 outcome);
    event Claimed(address indexed agent, uint32 indexed round, bool up, uint8 outcome, uint32 streak);

    error NotAgentIdHolder();
    error AlreadyPicked();
    error NothingToClaim();
    error TooEarly();
    error AlreadySettled();
    error BadConstructorArgument();

    constructor(address agentId_, address feed_) {
        if (agentId_.code.length == 0 || feed_.code.length == 0) revert BadConstructorArgument();
        agentId = IAgentIDHolder(agentId_);
        feed = IBlitzFeed(feed_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Pick "higher" for the round that is open now.
    function up() external {
        _pickNow(UP);
    }

    /// @notice Pick "lower" for the round that is open now.
    function down() external {
        _pickNow(DOWN);
    }

    /// @notice Write your finished rounds into your record, oldest first, at most MAX_CLAIM per
    ///         call. Settles a round first if nobody has yet. Reverts if no round of yours is finished.
    function claim() external {
        Record storage rec = _records[msg.sender];
        uint32[] storage rounds = _picked[msg.sender];
        uint256 i = rec.claimed;
        uint256 end = rounds.length;
        uint256 done;
        while (i < end && done < MAX_CLAIM) {
            uint32 r = rounds[i];
            if (block.timestamp <= targetTime(r)) break;
            uint8 outcome = _results[r].outcome;
            if (outcome == NONE) outcome = _settle(r);
            uint8 mine = _pick[msg.sender][r];
            if (outcome == UP || outcome == DOWN) {
                if (outcome == mine) {
                    rec.wins += 1;
                    rec.streak += 1;
                    if (rec.streak > rec.bestStreak) rec.bestStreak = rec.streak;
                } else {
                    rec.losses += 1;
                    rec.streak = 0;
                }
            }
            emit Claimed(msg.sender, r, mine == UP, outcome, rec.streak);
            i++;
            done++;
        }
        if (done == 0) revert NothingToClaim();
        rec.claimed = uint32(i);
    }

    /// @notice Fix the result of a finished round. Anyone can call this; `claim()` does it too.
    function settle(uint32 round) external {
        if (block.timestamp <= targetTime(round)) revert TooEarly();
        if (_results[round].outcome != NONE) revert AlreadySettled();
        _settle(round);
    }

    // ------------------------------------------------------------------ views

    function currentRound() public view returns (uint32) {
        return uint32(block.timestamp / ROUND);
    }

    function lockTime(uint32 round) public pure returns (uint256) {
        return (uint256(round) + 1) * ROUND;
    }

    function targetTime(uint32 round) public pure returns (uint256) {
        return (uint256(round) + 2) * ROUND;
    }

    /// @notice Result of a round. `outcome`: 0 not settled, 1 up, 2 down, 3 push, 4 void.
    function resultOf(uint32 round) external view returns (uint64 p0, uint64 p1, uint8 outcome) {
        Result memory res = _results[round];
        return (res.p0, res.p1, res.outcome);
    }

    /// @notice The pick an address made in a round: 0 none, 1 up, 2 down.
    function pickOf(address agent, uint32 round) external view returns (uint8) {
        return _pick[agent][round];
    }

    /// @notice An address's record. `pending` is the number of its picks not yet written by `claim()`.
    function recordOf(address agent)
        external
        view
        returns (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak, uint32 pending)
    {
        Record memory rec = _records[agent];
        return (rec.picks, rec.wins, rec.losses, rec.streak, rec.bestStreak, rec.picks - rec.claimed);
    }

    /// @notice Everything an agent needs to decide its next call, in one read.
    /// @return round        The round open for picks now.
    /// @return canPick      True if `agent` holds an Agent ID and has not picked in this round.
    /// @return claimable    How many of the agent's rounds are finished and not yet claimed
    ///                      (`claim()` writes at most MAX_CLAIM of them per call).
    /// @return secondsToLock Seconds until the open round locks.
    function todo(address agent)
        external
        view
        returns (uint32 round, bool canPick, uint32 claimable, uint256 secondsToLock)
    {
        round = currentRound();
        canPick = _pick[agent][round] == NONE && agentId.balanceOf(agent) != 0;
        uint32[] storage rounds = _picked[agent];
        uint256 end = rounds.length;
        for (uint256 i = _records[agent].claimed; i < end; i++) {
            if (block.timestamp <= targetTime(rounds[i])) break;
            claimable += 1;
        }
        secondsToLock = lockTime(round) - block.timestamp;
    }

    // -------------------------------------------------------------- internal

    function _pickNow(uint8 side) private {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        uint32 r = currentRound();
        if (_pick[msg.sender][r] != NONE) revert AlreadyPicked();
        _pick[msg.sender][r] = side;
        _picked[msg.sender].push(r);
        Record storage rec = _records[msg.sender];
        if (rec.picks == 0) totalPlayers += 1;
        rec.picks += 1;
        totalPicks += 1;
        emit Picked(msg.sender, r, side == UP);
    }

    function _settle(uint32 round) private returns (uint8 outcome) {
        (uint64 p0, bool ok0) = _priceAt(lockTime(round));
        (uint64 p1, bool ok1) = _priceAt(targetTime(round));
        if (!ok0 || !ok1) outcome = VOID;
        else if (p1 > p0) outcome = UP;
        else if (p1 < p0) outcome = DOWN;
        else outcome = PUSH;
        _results[round] = Result(p0, p1, outcome);
        emit Settled(round, p0, p1, outcome);
    }

    /// @dev Price of the latest feed round updated at or before `time`, searched inside the
    ///      feed's current phase. `ok` is false if there is none within SEARCH_WINDOW, if it is
    ///      older than MAX_LAG, or if the feed's data cannot be read.
    function _priceAt(uint256 time) private view returns (uint64 price, bool ok) {
        uint80 latest;
        uint256 latestAt;
        try feed.latestRoundData() returns (uint80 id, int256, uint256, uint256 updatedAt, uint80) {
            latest = id;
            latestAt = updatedAt;
        } catch {
            return (0, false);
        }
        uint256 phase = uint256(latest) >> 64;
        uint256 hi = uint64(latest);
        if (hi == 0 || latestAt == 0) return (0, false);

        uint256 found;
        if (latestAt <= time) {
            found = hi;
        } else {
            uint256 lo = hi > SEARCH_WINDOW ? hi - SEARCH_WINDOW : 1;
            if (lo == hi) return (0, false);
            (uint256 loAt,) = _read(phase, lo);
            if (loAt == 0 || loAt > time) return (0, false);
            // Invariant: updatedAt(lo) <= time < updatedAt(hi)
            while (hi - lo > 1) {
                uint256 mid = (lo + hi) / 2;
                (uint256 midAt,) = _read(phase, mid);
                if (midAt == 0) return (0, false);
                if (midAt <= time) lo = mid;
                else hi = mid;
            }
            found = lo;
        }
        (uint256 at, int256 answer) = _read(phase, found);
        if (at == 0 || at > time || time - at > MAX_LAG) return (0, false);
        if (answer <= 0 || uint256(answer) > type(uint64).max) return (0, false);
        return (uint64(uint256(answer)), true);
    }

    function _read(uint256 phase, uint256 aggregatorRound) private view returns (uint256 updatedAt, int256 answer) {
        // forge-lint: disable-next-line(unsafe-typecast)
        uint80 id = uint80((phase << 64) | aggregatorRound);
        try feed.getRoundData(id) returns (uint80, int256 a, uint256, uint256 u, uint80) {
            return (u, a);
        } catch {
            return (0, 0);
        }
    }
}
