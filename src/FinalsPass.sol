// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice `balanceOf`, as answered by the Agent ID registry and by every Forecast League token.
interface IPassBalance {
    function balanceOf(address holder) external view returns (uint256);
}

/// @title Forecast League Finals Pass
/// @notice The Season One pass: a free, numbered token. Any wallet that holds an Agent ID can mint
///         one, once. 2,000 exist at most, and minting ends on 8 December 2026. The pass shows a
///         tier that follows how many Forecast League contracts its holder has used.
/// @dev An ordinary transferable ERC-721 (OpenZeppelin). No owner, no upgrade path, no payable
///      function, no royalty, no reserve: the builder can mint one pass like anyone else and holds
///      no other. The builder gives the pass no value and promises none. Both `mint()` and
///      `mint(1)` work, because mint tools call either. Every limit is a constant.
contract FinalsPass is ERC721 {
    IPassBalance public immutable agentId;

    /// @notice Passes that can ever exist.
    uint256 public constant MAX_SUPPLY = 2000;
    /// @notice One pass per minting wallet.
    uint256 public constant MAX_PER_WALLET = 1;
    /// @notice Minting opens at 12:00 UTC on 26 November 2026.
    uint256 public constant OPENS_AT = 1_795_694_400;
    /// @notice Minting ends at 08:00 UTC on 8 December 2026.
    uint256 public constant CLOSES_AT = 1_796_716_800;

    /// @notice Tier thresholds: Forecast League contracts the holder has a token in.
    uint8 public constant SILVER_AT = 4;
    uint8 public constant GOLD_AT = 8;

    uint256 public totalSupply;
    /// @notice The number of the pass an address minted, or 0 if it has not minted. It stays set
    ///         when the pass is transferred away, so a wallet mints once.
    mapping(address => uint256) public mintedPass;

    /// @dev The Forecast League token contracts counted for the tier.
    IPassBalance[] private _league;

    error NotAgentIdHolder();
    error AlreadyMinted();
    error OnePerWallet();
    error NotOpenYet();
    error Closed();
    error SoldOut();
    error BadConstructorArgument();

    /// @param agentId_ The Agent ID registry.
    /// @param league_ The Forecast League token contracts counted for the tier. No duplicate, and
    ///        every address must answer `balanceOf`.
    constructor(address agentId_, address[] memory league_) ERC721("Forecast League Finals Pass", "FLPASS") {
        if (agentId_.code.length == 0) revert BadConstructorArgument();
        if (league_.length == 0 || league_.length > 16) revert BadConstructorArgument();
        IPassBalance(agentId_).balanceOf(address(this));
        for (uint256 i = 0; i < league_.length; i++) {
            address a = league_[i];
            if (a.code.length == 0) revert BadConstructorArgument();
            for (uint256 j = 0; j < i; j++) {
                if (league_[j] == a) revert BadConstructorArgument();
            }
            // With no owner a wrong address could never be repaired, so it must answer now.
            IPassBalance(a).balanceOf(address(this));
            _league.push(IPassBalance(a));
        }
        agentId = IPassBalance(agentId_);
    }

    // ---------------------------------------------------------------- actions

    /// @notice Mint the caller's pass. Free, no arguments. The caller must hold an Agent ID and can
    ///         mint once.
    function mint() external {
        _mintPass();
    }

    /// @notice The same as `mint()`, for tools that pass a quantity. Only 1 is accepted.
    function mint(uint256 quantity) external {
        if (quantity != MAX_PER_WALLET) revert OnePerWallet();
        _mintPass();
    }

    function _mintPass() private {
        if (block.timestamp < OPENS_AT) revert NotOpenYet();
        if (block.timestamp >= CLOSES_AT) revert Closed();
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (mintedPass[msg.sender] != 0) revert AlreadyMinted();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();

        uint256 tokenId = ++totalSupply;
        mintedPass[msg.sender] = tokenId;
        // _mint, not _safeMint: no call into the receiver, so nothing can re-enter.
        _mint(msg.sender, tokenId);
    }

    // ------------------------------------------------------------------ views

    /// @notice What stands between an address and its pass.
    /// @return code 0 nothing: `mint()` would succeed now. 1 no Agent ID. 3 already minted.
    ///         4 not open yet. 5 closed. 6 sold out. (2 is not used.)
    function missing(address agent) public view returns (uint8 code) {
        if (block.timestamp >= CLOSES_AT) return 5;
        if (totalSupply >= MAX_SUPPLY) return 6;
        if (mintedPass[agent] != 0) return 3;
        if (!_holds(agentId, agent)) return 1;
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

    /// @notice The tier a pass shows for its holder now: 1 bronze, 2 silver, 3 gold. It follows
    ///         `contractsUsed`, so it can rise after the mint and it follows the pass to a new holder.
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

    /// @notice True if the address has already minted its pass.
    function hasMinted(address agent) external view returns (bool) {
        return mintedPass[agent] != 0;
    }

    // ------------------------------------------------------------- metadata

    /// @notice Pass metadata and image, built on-chain from fixed text and numbers only. The tier
    ///         is read live from the current holder's Forecast League tokens.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address holder = _requireOwned(tokenId);
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
            ' / 2000</text><text x="200" y="298" fill="',
            colour,
            '" font-size="18" letter-spacing="5">',
            label,
            '</text><text x="200" y="364" fill="#9aa0b4" font-size="13" letter-spacing="3">SEASON ONE</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"Finals Pass #',
            id,
            '","description":"Season One pass of Forecast League, number ',
            id,
            ' of at most 2000. Free, one per Agent ID wallet. The tier follows how many Forecast League contracts the holder has used. The builder gives it no value and promises none.","image":"data:image/svg+xml;base64,',
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

    /// @notice Collection text for marketplaces. No fee recipient and no royalty.
    function contractURI() external pure returns (string memory) {
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    '{"name":"Forecast League Finals Pass","description":"Season One pass of Forecast League, a free prediction league for Binance Agent ID wallets on BNB Chain. 2000 at most, one per Agent ID wallet, free mint until 8 December 2026. No owner, no royalty, no reserve. The builder gives it no value and promises none.","external_link":"https://mycyi1994-hash.github.io/forecast-league/"}'
                )
            )
        );
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
