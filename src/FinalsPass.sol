// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice `balanceOf`, as answered by the Agent ID registry and by every Forecast League token.
interface IPassBalance {
    function balanceOf(address holder) external view returns (uint256);
}

/// @title Forecast League Finals Pass
/// @notice The Season One pass: one free, non-transferable, numbered token per Agent ID wallet that
///         holds the Forecast League card. 5,000 exist at most, and minting ends on 8 December 2026.
///         The pass shows a tier that follows how many Forecast League contracts its holder has used.
/// @dev No owner, no upgrade path, no payable function, no token movement. A pass has no monetary
///      value. `mint()` takes no arguments. Every limit is a constant or fixed at deployment.
contract FinalsPass {
    IPassBalance public immutable agentId;
    /// @notice The Forecast League card contract. A wallet needs its card before it can mint a pass.
    IPassBalance public immutable card;

    string public constant name = "Forecast League Finals Pass";
    string public constant symbol = "FLPASS";

    /// @notice Passes that can ever exist.
    uint256 public constant MAX_SUPPLY = 5000;
    /// @notice Minting opens at 12:00 UTC on 26 November 2026.
    uint256 public constant OPENS_AT = 1_795_694_400;
    /// @notice Minting ends at 08:00 UTC on 8 December 2026.
    uint256 public constant CLOSES_AT = 1_796_716_800;

    /// @notice Tier thresholds: Forecast League contracts the holder has a token in.
    uint8 public constant SILVER_AT = 4;
    uint8 public constant GOLD_AT = 8;

    uint256 public totalSupply;
    mapping(uint256 => address) private _ownerOf;
    /// @notice The pass number of an address, or 0 if it has none.
    mapping(address => uint256) public passOf;

    /// @dev The Forecast League token contracts counted for the tier (the card is one of them).
    IPassBalance[] private _league;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    /// @notice ERC-5192: the pass is locked from the moment it exists.
    event Locked(uint256 tokenId);

    error NotAgentIdHolder();
    error MintCardFirst();
    error AlreadyMinted();
    error NotOpenYet();
    error Closed();
    error SoldOut();
    error ZeroAddress();
    error NonexistentToken();
    error NonTransferable();
    error BadConstructorArgument();

    /// @param agentId_ The Agent ID registry.
    /// @param card_ The Forecast League card contract.
    /// @param league_ The Forecast League token contracts counted for the tier. Must contain the
    ///        card, hold no duplicate, and every address must answer `balanceOf`.
    constructor(address agentId_, address card_, address[] memory league_) {
        if (agentId_.code.length == 0 || card_.code.length == 0) revert BadConstructorArgument();
        if (league_.length == 0 || league_.length > 16) revert BadConstructorArgument();
        IPassBalance(agentId_).balanceOf(address(this));
        bool hasCard;
        for (uint256 i = 0; i < league_.length; i++) {
            address a = league_[i];
            if (a.code.length == 0) revert BadConstructorArgument();
            for (uint256 j = 0; j < i; j++) {
                if (league_[j] == a) revert BadConstructorArgument();
            }
            // With no owner a wrong address could never be repaired, so it must answer now.
            IPassBalance(a).balanceOf(address(this));
            if (a == card_) hasCard = true;
            _league.push(IPassBalance(a));
        }
        if (!hasCard) revert BadConstructorArgument();
        agentId = IPassBalance(agentId_);
        card = IPassBalance(card_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Mint the caller's pass. Free, no arguments. The caller must hold an Agent ID and the
    ///         Forecast League card, and can mint once.
    function mint() external {
        if (block.timestamp < OPENS_AT) revert NotOpenYet();
        if (block.timestamp >= CLOSES_AT) revert Closed();
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (passOf[msg.sender] != 0) revert AlreadyMinted();
        if (card.balanceOf(msg.sender) == 0) revert MintCardFirst();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();

        uint256 tokenId = ++totalSupply;
        _ownerOf[tokenId] = msg.sender;
        passOf[msg.sender] = tokenId;
        emit Transfer(address(0), msg.sender, tokenId);
        emit Locked(tokenId);
    }

    // ------------------------------------------------------------------ views

    /// @notice What stands between an address and its pass.
    /// @return code 0 nothing: `mint()` would succeed now. 1 no Agent ID. 2 no Forecast League card
    ///         (call `mint()` on `card()` first). 3 already has a pass. 4 not open yet. 5 closed.
    ///         6 sold out.
    function missing(address agent) public view returns (uint8 code) {
        if (block.timestamp >= CLOSES_AT) return 5;
        if (totalSupply >= MAX_SUPPLY) return 6;
        if (passOf[agent] != 0) return 3;
        if (!_holds(agentId, agent)) return 1;
        if (!_holds(card, agent)) return 2;
        if (block.timestamp < OPENS_AT) return 4;
        return 0;
    }

    /// @notice Everything an agent needs to decide its next call, in one read.
    /// @return canMint True if `mint()` would succeed now.
    /// @return code The same as `missing(agent)`.
    /// @return left Passes not yet minted.
    /// @return secondsToOpen Seconds until minting opens; 0 once open.
    /// @return secondsToClose Seconds until minting ends; 0 once closed.
    function todo(address agent)
        external
        view
        returns (bool canMint, uint8 code, uint256 left, uint256 secondsToOpen, uint256 secondsToClose)
    {
        code = missing(agent);
        canMint = code == 0;
        left = MAX_SUPPLY - totalSupply;
        secondsToOpen = block.timestamp < OPENS_AT ? OPENS_AT - block.timestamp : 0;
        secondsToClose = block.timestamp < CLOSES_AT ? CLOSES_AT - block.timestamp : 0;
    }

    /// @notice Forecast League contracts an address holds a token in, of `leagueSize()`.
    function contractsUsed(address agent) public view returns (uint8 used) {
        if (agent == address(0)) return 0;
        uint256 n = _league.length;
        for (uint256 i = 0; i < n; i++) {
            if (_holds(_league[i], agent)) used += 1;
        }
    }

    /// @notice The tier a pass shows for an address now: 1 bronze, 2 silver, 3 gold. It follows
    ///         `contractsUsed` and so can rise after the pass is minted.
    function tierOf(address agent) public view returns (uint8) {
        uint8 used = contractsUsed(agent);
        return used >= GOLD_AT ? 3 : used >= SILVER_AT ? 2 : 1;
    }

    function leagueSize() external view returns (uint256) {
        return _league.length;
    }

    function leagueAt(uint256 index) external view returns (address) {
        return address(_league[index]);
    }

    // ------------------------------------------- common reads that mint tools look for

    /// @notice There is no owner. Returned so that tools reading `owner()` see that.
    function owner() external pure returns (address) {
        return address(0);
    }

    function mintPrice() external pure returns (uint256) {
        return 0;
    }

    function price() external pure returns (uint256) {
        return 0;
    }

    function totalMinted() external view returns (uint256) {
        return totalSupply;
    }

    function maxSupply() external pure returns (uint256) {
        return MAX_SUPPLY;
    }

    /// @notice True if the address already has its pass.
    function hasMinted(address agent) external view returns (bool) {
        return passOf[agent] != 0;
    }

    // ------------------------------------------------ non-transferable ERC-721 read side

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return passOf[holder] != 0 ? 1 : 0;
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _ownerOf[tokenId];
        if (holder == address(0)) revert NonexistentToken();
    }

    /// @notice ERC-5192: every pass is permanently locked.
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

    /// @notice Pass metadata and image, built on-chain from fixed text and numbers only. The tier
    ///         is read live from the holder's Forecast League tokens.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        address holder = ownerOf(tokenId);
        uint8 tier = tierOf(holder);
        string memory id = Strings.toString(tokenId);
        string memory label = tier == 3 ? "GOLD" : tier == 2 ? "SILVER" : "BRONZE";
        string memory colour = tier == 3 ? "#f2c84b" : tier == 2 ? "#c9ced8" : "#c58b4a";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#0b0c12"/>',
            '<rect x="30" y="70" width="340" height="260" rx="22" fill="none" stroke="',
            colour,
            '" stroke-width="6"/><g font-family="monospace" text-anchor="middle"><text x="200" y="128" fill="#9aa0b4" font-size="15" letter-spacing="4">FORECAST LEAGUE</text><text x="200" y="196" fill="#eef0f6" font-size="34" letter-spacing="2">FINALS PASS</text><text x="200" y="250" fill="',
            colour,
            '" font-size="30">#',
            id,
            ' / 5000</text><text x="200" y="298" fill="',
            colour,
            '" font-size="18" letter-spacing="5">',
            label,
            '</text><text x="200" y="364" fill="#9aa0b4" font-size="13" letter-spacing="3">SEASON ONE</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"Finals Pass #',
            id,
            '","description":"Non-transferable Season One pass of Forecast League, number ',
            id,
            ' of at most 5000. The tier follows how many Forecast League contracts the holder has used. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Tier","value":"',
            label,
            '"},{"trait_type":"Contracts used","value":',
            Strings.toString(contractsUsed(holder)),
            '},{"trait_type":"Number","value":',
            id,
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // -------------------------------------------------------------- internal

    function _holds(IPassBalance token, address agent) private view returns (bool) {
        if (agent == address(0)) return false;
        try token.balanceOf(agent) returns (uint256 balance) {
            return balance != 0;
        } catch {
            return false;
        }
    }
}
