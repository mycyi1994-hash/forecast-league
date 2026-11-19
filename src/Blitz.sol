// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The function of the official Agent ID registry that this contract reads.
interface IAgentIDHolder {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice The function of the Forecast League squads contract that this contract reads.
interface ISquadsOf {
    function squadOf(address member) external view returns (address captain, uint40 since);
}

/// @notice Chainlink-style price feed.
interface IBlitzFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title Blitz
/// @notice A free round ticket for Agent ID holders, every six hours: will BTC/USD be higher or
///         lower six hours after the round locks? Each Agent ID can mint one ticket per round.
///         `up()` and `down()` choose the side, `mint()` takes the side this contract assigns
///         to the caller for that round. `claim()` writes finished rounds into the record.
///         Every call takes no arguments, so an agent can play with fixed call data.
/// @dev There is no owner, no upgrade path, no payable function and no token movement. Tickets
///      are non-transferable ERC-721 tokens with metadata built on-chain.
///
///      Round `r` is open for tickets during [r * ROUND, (r + 1) * ROUND). A transaction mined
///      exactly at a boundary belongs to the round that starts there.
///        lock time   = (r + 1) * ROUND
///        target time = lock time + ROUND
///      The result compares the feed price at the target time with the feed price at the lock
///      time. Both are the latest feed round at or before that time, found on-chain by searching
///      the feed's current phase, so nobody supplies a price or a feed round, and within a feed
///      phase every caller gets the same result whenever they settle. A higher price is "up", a
///      lower one "down", an equal one a push. A round is void if the feed had no update in the
///      MAX_LAG before either time. If the feed's operator moves it to a new phase before a
///      round is settled, that round is settled from the new phase and is void if the new phase
///      has no round at or before the time, so rounds should be settled soon after they finish.
///      The first settlement of a round costs about 300,000 gas; later claims of it are cheap.
contract Blitz {
    uint256 public constant ROUND = 6 hours;
    /// @notice A feed round is used only if it was updated no more than this long before the
    ///         reference time.
    uint256 public constant MAX_LAG = 30 minutes;
    /// @notice Most rounds one `claim()` writes. Call again if more are finished.
    uint256 public constant MAX_CLAIM = 12;
    /// @notice The first tickets of each round carry the "Early" mark.
    uint32 public constant EARLY_COUNT = 25;

    string public constant name = "Forecast League Blitz";
    string public constant symbol = "BLITZ";

    uint8 private constant NONE = 0;
    uint8 private constant UP = 1;
    uint8 private constant DOWN = 2;
    uint8 private constant PUSH = 3;
    uint8 private constant VOID = 4;

    IAgentIDHolder public immutable agentId;
    IBlitzFeed public immutable feed;
    /// @notice The squads contract. A ticket also counts for the squad its holder is in when it is minted.
    ISquadsOf public immutable squads;

    struct Result {
        uint64 p0; // price at lock time
        uint64 p1; // price at target time
        uint8 outcome; // 0 not settled, 1 up, 2 down, 3 push, 4 void
    }

    struct Ticket {
        address owner;
        uint32 round;
        uint32 seq; // position among the round's tickets, starting at 1
        uint8 side; // 1 up, 2 down
    }

    /// @dev Tickets a squad's members minted in one round, by side.
    struct SquadRound {
        uint32 up;
        uint32 down;
    }

    struct Record {
        uint32 picks;
        uint32 wins;
        uint32 losses;
        uint32 streak; // current run of wins
        uint32 bestStreak;
        uint32 claimed; // how many of the address's tickets are written to the record
    }

    /// @notice Number of tickets ever minted. Ticket ids run from 1 to this number.
    uint256 public totalSupply;
    /// @notice Number of addresses that hold at least one ticket.
    uint256 public totalPlayers;
    /// @notice Tickets minted in a round.
    mapping(uint32 => uint32) public roundMinted;
    /// @notice Tickets ever minted by members of a squad (the squad is its captain's address).
    mapping(address => uint32) public squadTickets;

    mapping(uint32 => Result) private _results;
    mapping(uint256 => Ticket) private _tickets;
    mapping(address => Record) private _records;
    mapping(address => mapping(uint32 => SquadRound)) private _squadRounds; // by captain and round
    mapping(address => uint256[]) private _owned; // ticket ids of an address, oldest first
    mapping(address => mapping(uint32 => uint256)) private _ticketIn; // ticket id of an address in a round

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    /// @dev Declared for the ERC-721 interface. Never emitted: tickets cannot be approved or moved.
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// @dev ERC-4906. A ticket's metadata changes when its round finishes and is settled.
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event Picked(address indexed agent, uint32 indexed round, bool up, uint256 tokenId);
    /// @dev Emitted with `Picked` when the agent is in a squad at that moment.
    event SquadTicket(address indexed captain, uint32 indexed round, address indexed agent);
    event Settled(uint32 indexed round, uint64 p0, uint64 p1, uint8 outcome);
    event Claimed(address indexed agent, uint32 indexed round, uint256 tokenId, uint8 outcome, uint32 streak);

    error NotAgentIdHolder();
    error AlreadyPicked();
    error NothingToClaim();
    error TooEarly();
    error AlreadySettled();
    error NoTickets();
    error ZeroAddress();
    error NonexistentToken();
    error NonTransferable();
    error BadConstructorArgument();

    constructor(address agentId_, address feed_, address squads_) {
        if (agentId_.code.length == 0 || feed_.code.length == 0 || squads_.code.length == 0) {
            revert BadConstructorArgument();
        }
        agentId = IAgentIDHolder(agentId_);
        feed = IBlitzFeed(feed_);
        squads = ISquadsOf(squads_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Mint this round's ticket with the side "higher".
    function up() external {
        _mintTicket(UP);
    }

    /// @notice Mint this round's ticket with the side "lower".
    function down() external {
        _mintTicket(DOWN);
    }

    /// @notice Mint this round's ticket with the side this contract assigns to the caller for
    ///         the round (see `assignedSide`). For callers that do not want to choose.
    function mint() external {
        _mintTicket(assignedSide(msg.sender, currentRound()) ? UP : DOWN);
    }

    /// @notice Write your finished rounds into your record, oldest first, at most MAX_CLAIM per
    ///         call. Settles a round first if nobody has yet. Reverts if no round of yours is finished.
    function claim() external {
        _claim(msg.sender);
    }

    /// @notice The same for any address. A record cannot be kept flattering by not claiming.
    function claimFor(address agent) external {
        _claim(agent);
    }

    /// @notice Fix the result of a finished round that has tickets. Anyone can call this;
    ///         `claim()` does it too.
    function settle(uint32 round) external {
        if (block.timestamp <= targetTime(round)) revert TooEarly();
        if (_results[round].outcome != NONE) revert AlreadySettled();
        if (roundMinted[round] == 0) revert NoTickets();
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

    /// @notice The side `mint()` gives an address in a round: true for up. Fixed by the address
    ///         and the round, so it can be read before minting.
    function assignedSide(address agent, uint32 round) public pure returns (bool) {
        return uint256(keccak256(abi.encode(agent, round))) & 1 == 1;
    }

    /// @notice Result of a round. `outcome`: 0 not settled, 1 up, 2 down, 3 push, 4 void.
    ///         `finished` is true once the target time has passed, settled or not.
    function resultOf(uint32 round) external view returns (uint64 p0, uint64 p1, uint8 outcome, bool finished) {
        Result memory res = _results[round];
        return (res.p0, res.p1, res.outcome, block.timestamp > targetTime(round));
    }

    /// @notice The side an address took in a round: 0 none, 1 up, 2 down.
    function pickOf(address agent, uint32 round) external view returns (uint8) {
        return _tickets[_ticketIn[agent][round]].side;
    }

    /// @notice A ticket. `status`: 0 live (round not finished), 1 finished and waiting to be
    ///         settled, 2 won, 3 lost, 4 push, 5 void.
    function ticket(uint256 tokenId)
        external
        view
        returns (address holder, uint32 round, bool isUp, uint32 seq, uint8 status)
    {
        Ticket memory t = _tickets[tokenId];
        if (t.owner == address(0)) revert NonexistentToken();
        return (t.owner, t.round, t.side == UP, t.seq, _status(t));
    }

    /// @notice The ticket id of an address at a position in its own list (0 is its oldest).
    function tokenOfOwnerByIndex(address holder, uint256 index) external view returns (uint256) {
        return _owned[holder][index];
    }

    /// @notice An address's record. `unclaimed` counts its tickets not yet written by `claim()`,
    ///         finished or not; `todo` says how many of them can be claimed now.
    function recordOf(address agent)
        external
        view
        returns (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak, uint32 unclaimed)
    {
        Record memory rec = _records[agent];
        return (rec.picks, rec.wins, rec.losses, rec.streak, rec.bestStreak, rec.picks - rec.claimed);
    }

    /// @notice A squad's tickets in one round and what became of them. A ticket counts for the
    ///         squad its holder is in at the moment it is minted, and for no other: joining,
    ///         leaving or claiming later changes nothing. Wins and losses follow from the round's
    ///         result, so they are zero until the round is settled and for a push or a void.
    function squadRoundOf(address captain, uint32 round)
        public
        view
        returns (uint32 upTickets, uint32 downTickets, uint32 wins, uint32 losses)
    {
        SquadRound memory sr = _squadRounds[captain][round];
        uint8 outcome = _results[round].outcome;
        if (outcome == UP) return (sr.up, sr.down, sr.up, sr.down);
        if (outcome == DOWN) return (sr.up, sr.down, sr.down, sr.up);
        return (sr.up, sr.down, 0, 0);
    }

    /// @notice The same, summed over the rounds `fromRound` to `toRound` inclusive. A read for
    ///         standings; the range is the caller's choice.
    function squadTally(address captain, uint32 fromRound, uint32 toRound)
        external
        view
        returns (uint32 tickets, uint32 wins, uint32 losses)
    {
        for (uint32 r = fromRound; r <= toRound; r++) {
            (uint32 u, uint32 d, uint32 w, uint32 l) = squadRoundOf(captain, r);
            tickets += u + d;
            wins += w;
            losses += l;
            if (r == type(uint32).max) break;
        }
    }

    /// @notice Everything an agent needs to decide its next call, in one read.
    /// @return round         The round open for tickets now.
    /// @return canMint       True if `agent` holds an Agent ID and has no ticket in this round.
    ///                       A call sent in the last seconds of a round may be mined in the next one.
    /// @return claimable     How many of the agent's rounds are finished and not yet claimed
    ///                       (`claim()` writes at most MAX_CLAIM of them per call).
    /// @return secondsToLock Seconds until the open round locks.
    /// @return minted        Tickets minted in the open round so far.
    /// @return earlyLeft     How many of the round's "Early" tickets are left.
    function todo(address agent)
        external
        view
        returns (uint32 round, bool canMint, uint32 claimable, uint256 secondsToLock, uint32 minted, uint32 earlyLeft)
    {
        round = currentRound();
        if (_ticketIn[agent][round] == 0) {
            try agentId.balanceOf(agent) returns (uint256 balance) {
                canMint = balance != 0;
            } catch {}
        }
        uint256[] storage owned = _owned[agent];
        uint256 end = owned.length;
        for (uint256 i = _records[agent].claimed; i < end; i++) {
            if (block.timestamp <= targetTime(_tickets[owned[i]].round)) break;
            claimable += 1;
        }
        secondsToLock = lockTime(round) - block.timestamp;
        minted = roundMinted[round];
        earlyLeft = minted >= EARLY_COUNT ? 0 : EARLY_COUNT - minted;
    }

    // ------------------------------------------- common reads that mint tools look for

    /// @notice There is no owner. Returned so that tools reading `owner()` see that.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice A ticket costs nothing.
    function mintPrice() external pure returns (uint256) {
        return 0;
    }

    /// @notice A ticket costs nothing.
    function price() external pure returns (uint256) {
        return 0;
    }

    /// @notice Tickets ever minted. The same as `totalSupply`; there is no cap.
    function totalMinted() external view returns (uint256) {
        return totalSupply;
    }

    /// @notice There is no cap. Returned as the largest number so that tools reading
    ///         `maxSupply()` see that the supply is not limited.
    function maxSupply() external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice True if the address already has its ticket for the round open now.
    function hasMinted(address agent) external view returns (bool) {
        return _ticketIn[agent][currentRound()] != 0;
    }

    // ---------------------------------------- non-transferable ticket (ERC-721 read side)

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _owned[holder].length;
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _tickets[tokenId].owner;
        if (holder == address(0)) revert NonexistentToken();
    }

    /// @notice ERC-5192: every ticket is permanently locked.
    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure {
        revert NonTransferable();
    }

    function setApprovalForAll(address, bool) external pure {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) external pure {
        revert NonTransferable();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert NonTransferable();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert NonTransferable();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 metadata
            || interfaceId == 0xb45a3c0e // ERC-5192
            || interfaceId == 0x49064906; // ERC-4906
    }

    /// @notice Ticket metadata and image, built on-chain from fixed text and numbers only.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        Ticket memory t = _tickets[tokenId];
        if (t.owner == address(0)) revert NonexistentToken();
        string memory id = Strings.toString(tokenId);
        string memory round = Strings.toString(t.round);
        string memory side = t.side == UP ? "UP" : "DOWN";
        string memory status = _statusText(_status(t));
        bool early = t.seq <= EARLY_COUNT;

        string memory head = string.concat(
            '{"name":"Blitz #',
            id,
            '","description":"Non-transferable round ticket of Forecast League Blitz. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(id, round, t.side == UP, status, early)))
        );
        string memory json = string.concat(
            head,
            '","attributes":[{"trait_type":"Round","value":',
            round,
            '},{"trait_type":"Pick","value":"',
            side,
            '"},{"trait_type":"Result","value":"',
            status,
            '"},{"trait_type":"Early","value":"',
            early ? "Yes" : "No",
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // -------------------------------------------------------------- internal

    function _mintTicket(uint8 side) private {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        uint32 r = currentRound();
        if (_ticketIn[msg.sender][r] != 0) revert AlreadyPicked();

        uint256 tokenId = ++totalSupply;
        uint32 seq = ++roundMinted[r];
        _tickets[tokenId] = Ticket(msg.sender, r, seq, side);
        _ticketIn[msg.sender][r] = tokenId;
        _owned[msg.sender].push(tokenId);
        Record storage rec = _records[msg.sender];
        if (rec.picks == 0) totalPlayers += 1;
        rec.picks += 1;

        emit Transfer(address(0), msg.sender, tokenId);
        emit Locked(tokenId);
        emit Picked(msg.sender, r, side == UP, tokenId);

        address captain = _squadOf(msg.sender);
        if (captain != address(0)) {
            squadTickets[captain] += 1;
            if (side == UP) _squadRounds[captain][r].up += 1;
            else _squadRounds[captain][r].down += 1;
            emit SquadTicket(captain, r, msg.sender);
        }
    }

    function _claim(address agent) private {
        Record storage rec = _records[agent];
        uint256[] storage owned = _owned[agent];
        uint256 i = rec.claimed;
        uint256 end = owned.length;
        uint256 done;
        while (i < end && done < MAX_CLAIM) {
            uint256 tokenId = owned[i];
            Ticket memory t = _tickets[tokenId];
            if (block.timestamp <= targetTime(t.round)) break;
            uint8 outcome = _results[t.round].outcome;
            if (outcome == NONE) outcome = _settle(t.round);
            if (outcome == UP || outcome == DOWN) {
                if (outcome == t.side) {
                    rec.wins += 1;
                    rec.streak += 1;
                    if (rec.streak > rec.bestStreak) rec.bestStreak = rec.streak;
                } else {
                    rec.losses += 1;
                    rec.streak = 0;
                }
            }
            emit Claimed(agent, t.round, tokenId, outcome, rec.streak);
            emit MetadataUpdate(tokenId);
            i++;
            done++;
        }
        if (done == 0) revert NothingToClaim();
        // forge-lint: disable-next-line(unsafe-typecast)
        rec.claimed = uint32(i);
    }

    function _settle(uint32 round) private returns (uint8 outcome) {
        (uint64 p0, bool ok0) = _priceAt(lockTime(round));
        (uint64 p1, bool ok1) = _priceAt(targetTime(round));
        if (!ok0 || !ok1) {
            outcome = VOID;
            p0 = 0;
            p1 = 0;
        } else if (p1 > p0) {
            outcome = UP;
        } else if (p1 < p0) {
            outcome = DOWN;
        } else {
            outcome = PUSH;
        }
        _results[round] = Result(p0, p1, outcome);
        emit Settled(round, p0, p1, outcome);
        // The round's tickets now show their result. Their ids are not contiguous, so the
        // whole range is announced.
        emit BatchMetadataUpdate(1, totalSupply);
    }

    /// @dev Price of the latest feed round updated at or before `time`, searched through the
    ///      whole of the feed's current phase. `ok` is false if the phase has no such round,
    ///      if that round is older than MAX_LAG, or if the feed's data cannot be read.
    function _priceAt(uint256 time) private view returns (uint64 value, bool ok) {
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
            uint256 lo = 1;
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

    /// @dev The captain of the squad an address is in, or zero. A revert or running out of gas in
    ///      the squads contract counts as "no squad". The squads address is fixed at deployment
    ///      to this project's own verified contract, which has no owner and cannot change.
    function _squadOf(address agent) private view returns (address captain) {
        try squads.squadOf(agent) returns (address c, uint40) {
            return c;
        } catch {
            return address(0);
        }
    }

    /// @dev 0 live, 1 finished and not settled, 2 won, 3 lost, 4 push, 5 void.
    function _status(Ticket memory t) private view returns (uint8) {
        if (block.timestamp <= targetTime(t.round)) return 0;
        uint8 outcome = _results[t.round].outcome;
        if (outcome == NONE) return 1;
        if (outcome == PUSH) return 4;
        if (outcome == VOID) return 5;
        return outcome == t.side ? 2 : 3;
    }

    function _statusText(uint8 status) private pure returns (string memory) {
        if (status == 0) return "LIVE";
        if (status == 1) return "SETTLING";
        if (status == 2) return "WON";
        if (status == 3) return "LOST";
        if (status == 4) return "PUSH";
        return "VOID";
    }

    function _svg(string memory id, string memory round, bool isUp, string memory status, bool early)
        private
        pure
        returns (string memory)
    {
        string memory color = isUp ? "#c8ff7a" : "#ff8b8b";
        string memory top = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><rect width="500" height="500" rx="36" fill="#0b0e14"/>',
            '<rect x="14" y="14" width="472" height="472" rx="26" fill="none" stroke="',
            color,
            '" stroke-width="4"/><g font-family="monospace"><text x="40" y="70" fill="#9aa0b4" font-size="20" letter-spacing="4">FORECAST LEAGUE BLITZ</text>',
            '<text x="40" y="108" fill="#eef0f6" font-size="22">ROUND ',
            round,
            "</text>"
        );
        string memory middle = string.concat(
            '<path d="',
            isUp ? "M250 140 L340 280 H160 Z" : "M250 280 L340 140 H160 Z",
            '" fill="',
            color,
            '"/><text x="250" y="365" text-anchor="middle" fill="',
            color,
            '" font-size="64" font-weight="bold">',
            isUp ? "UP" : "DOWN",
            "</text>"
        );
        string memory bottom = string.concat(
            '<text x="250" y="420" text-anchor="middle" fill="#eef0f6" font-size="28" letter-spacing="6">',
            status,
            '</text><text x="40" y="462" fill="#9aa0b4" font-size="18">#',
            id,
            "</text>",
            early ? '<text x="460" y="462" text-anchor="end" fill="#ffd95a" font-size="18" letter-spacing="3">EARLY</text>' : "",
            "</g></svg>"
        );
        return string.concat(top, middle, bottom);
    }
}
