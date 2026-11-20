// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The function of the official Agent ID registry that this contract reads.
interface IBadgeAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice The function of a Forecast League Blitz market that this contract reads.
interface IBadgeTickets {
    function balanceOf(address holder) external view returns (uint256);
}

/// @title Forecast League Badges
/// @notice Free, non-transferable badges for Agent ID holders who keep playing Blitz. A wallet
///         earns a badge at 3, 10 and 30 Blitz tickets, counted over the Blitz markets this
///         contract was deployed with. One call, no arguments, mints the next badge it has earned.
/// @dev There is no owner, no upgrade path, no payable function and no token movement. A badge
///      has no monetary value. The ticket count is read from the Blitz contracts at the time of
///      the call; tickets cannot be transferred, so a count never goes down.
contract Badges {
    IBadgeAgentID public immutable agentId;
    IBadgeTickets public immutable market0;
    IBadgeTickets public immutable market1;
    IBadgeTickets public immutable market2;

    string public constant name = "Forecast League Badge";
    string public constant symbol = "FLBADGE";

    /// @notice Tickets needed for the three badges.
    uint32 public constant TIER1 = 3;
    uint32 public constant TIER2 = 10;
    uint32 public constant TIER3 = 30;

    struct Badge {
        address owner;
        uint8 tier; // 1, 2 or 3
        uint32 tickets; // the holder's ticket count when the badge was minted
    }

    uint256 public totalSupply;
    mapping(uint256 => Badge) private _badges;
    /// @notice The highest badge an address holds: 0 none, 1, 2 or 3.
    mapping(address => uint8) public tierOf;
    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    /// @notice ERC-5192: the badge is locked from the moment it exists.
    event Locked(uint256 tokenId);
    event BadgeMinted(address indexed agent, uint256 indexed tokenId, uint8 tier, uint32 tickets);

    error NotAgentIdHolder();
    error NothingToClaim();
    error ZeroAddress();
    error NonexistentToken();
    error NonTransferable();
    error BadConstructorArgument();

    /// @param agentId_ The Agent ID registry.
    /// @param market0_ A Blitz market (required).
    /// @param market1_ A second Blitz market, or the zero address for none.
    /// @param market2_ A third Blitz market, or the zero address for none.
    constructor(address agentId_, address market0_, address market1_, address market2_) {
        if (agentId_.code.length == 0 || market0_.code.length == 0) revert BadConstructorArgument();
        if (market1_ != address(0) && market1_.code.length == 0) revert BadConstructorArgument();
        if (market2_ != address(0) && market2_.code.length == 0) revert BadConstructorArgument();
        agentId = IBadgeAgentID(agentId_);
        market0 = IBadgeTickets(market0_);
        market1 = IBadgeTickets(market1_);
        market2 = IBadgeTickets(market2_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Mint the next badge the caller has earned. Reverts with NothingToClaim if the
    ///         caller's tickets do not reach the next tier yet.
    function claim() external {
        _claim();
    }

    /// @notice The same as `claim()`, under the name mint tools look for.
    function mint() external {
        _claim();
    }

    // ------------------------------------------------------------------ views

    /// @notice Blitz tickets an address holds over the markets of this contract.
    function ticketsOf(address agent) public view returns (uint32) {
        if (agent == address(0)) return 0;
        uint256 n = market0.balanceOf(agent);
        if (address(market1) != address(0)) n += market1.balanceOf(agent);
        if (address(market2) != address(0)) n += market2.balanceOf(agent);
        return n > type(uint32).max ? type(uint32).max : uint32(n);
    }

    /// @notice Everything an agent needs to decide its next call, in one read.
    /// @return tickets   The agent's Blitz tickets now.
    /// @return held      The highest badge it holds: 0 none, 1, 2 or 3.
    /// @return canClaim  True if `claim()` would mint a badge now.
    /// @return nextTier  The badge it would mint next (1, 2 or 3), or 0 if it holds all three.
    /// @return needed    Tickets still missing for that badge; 0 if it can be claimed.
    function todo(address agent)
        external
        view
        returns (uint32 tickets, uint8 held, bool canClaim, uint8 nextTier, uint32 needed)
    {
        tickets = ticketsOf(agent);
        held = tierOf[agent];
        if (held >= 3) return (tickets, held, false, 0, 0);
        nextTier = held + 1;
        uint32 threshold = _threshold(nextTier);
        needed = tickets >= threshold ? 0 : threshold - tickets;
        if (needed == 0) {
            try agentId.balanceOf(agent) returns (uint256 balance) {
                canClaim = balance != 0;
            } catch {}
        }
    }

    /// @notice A badge: its holder, its tier and the holder's ticket count when it was minted.
    function badge(uint256 tokenId) external view returns (address holder, uint8 tier, uint32 tickets) {
        Badge memory b = _badges[tokenId];
        if (b.owner == address(0)) revert NonexistentToken();
        return (b.owner, b.tier, b.tickets);
    }

    // ------------------------------------------- common reads that mint tools look for

    /// @notice There is no owner. Returned so that tools reading `owner()` see that.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice A badge costs nothing.
    function mintPrice() external pure returns (uint256) {
        return 0;
    }

    /// @notice A badge costs nothing.
    function price() external pure returns (uint256) {
        return 0;
    }

    /// @notice Badges ever minted. The same as `totalSupply`; there is no cap.
    function totalMinted() external view returns (uint256) {
        return totalSupply;
    }

    /// @notice There is no cap. Returned as the largest number so that tools reading
    ///         `maxSupply()` see that the supply is not limited.
    function maxSupply() external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice True if the address has nothing to mint now: it holds the badge of every tier its
    ///         tickets reach.
    function hasMinted(address agent) external view returns (bool) {
        uint8 held = tierOf[agent];
        if (held >= 3) return true;
        return ticketsOf(agent) < _threshold(held + 1);
    }

    // ---------------------------------------- non-transferable badge (ERC-721 read side)

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balances[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _badges[tokenId].owner;
        if (holder == address(0)) revert NonexistentToken();
    }

    /// @notice ERC-5192: every badge is permanently locked.
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
            || interfaceId == 0xb45a3c0e; // ERC-5192
    }

    /// @notice Badge metadata and image, built on-chain from fixed text and numbers only.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        Badge memory b = _badges[tokenId];
        if (b.owner == address(0)) revert NonexistentToken();
        string memory id = Strings.toString(tokenId);
        string memory label = b.tier == 1 ? "REGULAR" : b.tier == 2 ? "VETERAN" : "MARATHON";
        string memory need = Strings.toString(_threshold(b.tier));
        string memory colour = b.tier == 1 ? "#c58b4a" : b.tier == 2 ? "#c9ced8" : "#f2c84b";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#0b0c12"/>',
            '<circle cx="200" cy="170" r="96" fill="none" stroke="',
            colour,
            '" stroke-width="10"/><g font-family="monospace" text-anchor="middle"><text x="200" y="160" fill="',
            colour,
            '" font-size="34">',
            need,
            '</text><text x="200" y="196" fill="#9aa0b4" font-size="16">TICKETS</text><text x="200" y="316" fill="#eef0f6" font-size="26" letter-spacing="3">',
            label,
            '</text><text x="200" y="350" fill="#9aa0b4" font-size="14" letter-spacing="3">FORECAST LEAGUE</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"',
            label,
            " badge #",
            id,
            '","description":"Non-transferable badge of Forecast League for holding ',
            need,
            ' Blitz tickets. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Tier","value":"',
            label,
            '"},{"trait_type":"Tickets when minted","value":',
            Strings.toString(b.tickets),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // -------------------------------------------------------------- internal

    function _threshold(uint8 tier) private pure returns (uint32) {
        return tier == 1 ? TIER1 : tier == 2 ? TIER2 : TIER3;
    }

    function _claim() private {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        uint8 held = tierOf[msg.sender];
        if (held >= 3) revert NothingToClaim();
        uint8 tier = held + 1;
        uint32 tickets = ticketsOf(msg.sender);
        if (tickets < _threshold(tier)) revert NothingToClaim();

        uint256 tokenId = ++totalSupply;
        _badges[tokenId] = Badge(msg.sender, tier, tickets);
        tierOf[msg.sender] = tier;
        _balances[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
        emit Locked(tokenId);
        emit BadgeMinted(msg.sender, tokenId, tier, tickets);
    }
}
