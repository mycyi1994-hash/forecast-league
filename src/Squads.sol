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
/// @dev There is no owner, no upgrade path, no payable function and no token movement.
///      Squad standings are computed off-chain from the events here and the scores in Scorer.
contract Squads {
    /// @notice A member can move to another squad only this long after joining the current one.
    uint256 public constant SWITCH_COOLDOWN = 7 days;

    IAgentIDNames public immutable agentId;

    struct Membership {
        address captain; // the squad, identified by its captain's address; zero if none
        uint40 since; // when the member joined it
    }

    uint256 public totalSquads;
    /// @notice True if the address opened a squad.
    mapping(address => bool) public isSquad;
    /// @notice Current number of members of a squad, the captain included.
    mapping(address => uint32) public memberCount;

    mapping(address => Membership) private _membership;

    event SquadCreated(address indexed captain);
    event SquadJoined(address indexed member, address indexed captain, address indexed previousCaptain);

    error NotAgentIdHolder();
    error AlreadyCaptain();
    error UnknownSquad();
    error AlreadyInThisSquad();
    error CooldownNotOver();
    error BadConstructorArgument();

    constructor(address agentId_) {
        if (agentId_.code.length == 0) revert BadConstructorArgument();
        agentId = IAgentIDNames(agentId_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Open a squad named after your own Agent ID. You become its captain and stay in it.
    function createSquad() external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (isSquad[msg.sender]) revert AlreadyCaptain();

        isSquad[msg.sender] = true;
        totalSquads += 1;
        emit SquadCreated(msg.sender);
        _move(msg.sender, msg.sender);
    }

    /// @notice Join the squad of the captain whose Agent ID name is `captainHandle`
    ///         (the name without ".ai", for example "alice").
    function joinSquad(string calldata captainHandle) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (isSquad[msg.sender]) revert AlreadyCaptain(); // a captain stays in their own squad

        address captain = agentId.ownerOfHandle(captainHandle);
        if (captain == address(0) || !isSquad[captain]) revert UnknownSquad();
        _move(msg.sender, captain);
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

    function _move(address member, address captain) private {
        Membership memory m = _membership[member];
        if (m.captain == captain) revert AlreadyInThisSquad();
        if (m.captain != address(0)) {
            if (block.timestamp < uint256(m.since) + SWITCH_COOLDOWN) revert CooldownNotOver();
            memberCount[m.captain] -= 1;
        }
        memberCount[captain] += 1;
        _membership[member] = Membership(captain, uint40(block.timestamp));
        emit SquadJoined(member, captain, m.captain);
    }
}
