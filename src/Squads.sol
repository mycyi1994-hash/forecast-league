// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The functions of the official Agent ID registry that this contract reads.
interface IAgentIDNames {
    function balanceOf(address owner) external view returns (uint256);
    function handleOf(address owner) external view returns (string memory);
    function ownerOfHandle(string calldata handle) external view returns (address);
}

/// @title Squads
/// @notice Teams for the league. A squad is identified by its captain's Agent ID name:
///         a holder opens a squad, and other holders join it by typing that name.
///         Opening a squad makes the captain's Agent ID name public as the squad's name.
/// @dev There is no owner, no upgrade path, no payable function and no token movement.
///      Membership is open: anyone holding an Agent ID can join any squad, and nobody can be
///      removed. Squad standings are computed off-chain from the events here and the scores in
///      Scorer, so the standings formula has to hold up against a member who plays badly on purpose.
contract Squads {
    /// @notice A member can move to another squad only this long after joining the current one.
    uint256 public constant SWITCH_COOLDOWN = 7 days;

    IAgentIDNames public immutable agentId;

    struct Membership {
        address captain; // the squad, identified by its captain's address; zero if none
        uint40 since; // when the member joined it
    }

    /// @notice Number of squads that are open right now.
    uint256 public totalSquads;
    /// @notice Every address that ever opened a squad, in order. A squad may have been closed
    ///         since; check `isSquad`.
    address[] public captains;
    /// @notice True if the address has an open squad.
    mapping(address => bool) public isSquad;
    /// @notice Current number of members of a squad, the captain included.
    mapping(address => uint32) public memberCount;

    mapping(address => Membership) private _membership;
    mapping(address => bool) private _listed;

    event SquadCreated(address indexed captain);
    event SquadClosed(address indexed captain);
    /// @dev `captain` is the zero address when the member left without joining another squad.
    event SquadJoined(address indexed member, address indexed captain, address indexed previousCaptain);

    error NotAgentIdHolder();
    error AlreadyCaptain();
    error CaptainHasMembers();
    error UnknownSquad();
    error AlreadyInThisSquad();
    error NotInASquad();
    error CooldownNotOver();
    error BadConstructorArgument();

    constructor(address agentId_) {
        if (agentId_.code.length == 0) revert BadConstructorArgument();
        agentId = IAgentIDNames(agentId_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Open a squad named after your own Agent ID. You become its captain.
    function createSquad() external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (isSquad[msg.sender]) revert AlreadyCaptain();

        isSquad[msg.sender] = true;
        totalSquads += 1;
        if (!_listed[msg.sender]) {
            _listed[msg.sender] = true;
            captains.push(msg.sender);
        }
        emit SquadCreated(msg.sender);
        _move(msg.sender, msg.sender);
    }

    /// @notice Join the squad of the captain whose Agent ID name is `captainHandle`
    ///         (the name without ".ai", in lowercase, for example "alice").
    ///         A captain can do this only while alone in their own squad, which is then closed.
    function joinSquad(string calldata captainHandle) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();

        address captain = agentId.ownerOfHandle(captainHandle);
        if (captain == address(0) || !isSquad[captain]) revert UnknownSquad();
        if (captain == msg.sender) revert AlreadyInThisSquad();
        _closeOwnSquadIfAlone(msg.sender);
        _move(msg.sender, captain);
    }

    /// @notice Leave your squad without joining another one. A captain can do this only while
    ///         alone in their own squad, which is then closed.
    function leaveSquad() external {
        if (_membership[msg.sender].captain == address(0)) revert NotInASquad();
        _closeOwnSquadIfAlone(msg.sender);
        _move(msg.sender, address(0));
    }

    function captainsCount() external view returns (uint256) {
        return captains.length;
    }

    // ------------------------------------------------------------------ views

    /// @notice The squad an address belongs to (zero address if none) and since when.
    function squadOf(address member) external view returns (address captain, uint40 since) {
        Membership memory m = _membership[member];
        return (m.captain, m.since);
    }

    /// @notice The Agent ID name of a squad's captain, read live from the registry.
    ///         Empty if the address has no squad.
    function squadName(address captain) external view returns (string memory) {
        if (!isSquad[captain]) return "";
        return agentId.handleOf(captain);
    }

    // -------------------------------------------------------------- internal

    /// @dev A captain may move on only when nobody else is in their squad.
    function _closeOwnSquadIfAlone(address member) private {
        if (!isSquad[member]) return;
        if (memberCount[member] != 1) revert CaptainHasMembers();
        // Checked here as well so a refused move leaves the squad open.
        if (block.timestamp < uint256(_membership[member].since) + SWITCH_COOLDOWN) revert CooldownNotOver();
        isSquad[member] = false;
        totalSquads -= 1;
        emit SquadClosed(member);
    }

    /// @dev Moves `member` to `captain`'s squad, or out of any squad when `captain` is zero.
    function _move(address member, address captain) private {
        Membership memory m = _membership[member];
        if (m.captain == captain) revert AlreadyInThisSquad();
        if (m.captain != address(0)) {
            if (block.timestamp < uint256(m.since) + SWITCH_COOLDOWN) revert CooldownNotOver();
            memberCount[m.captain] -= 1;
        }
        if (captain != address(0)) memberCount[captain] += 1;
        _membership[member] = Membership(captain, uint40(block.timestamp));
        emit SquadJoined(member, captain, m.captain);
    }
}
