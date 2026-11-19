// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The two functions of the official Agent ID registry that this contract reads.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
    function handleOf(address owner) external view returns (string memory);
}

/// @notice The contract that draws the card image.
interface ICardArt {
    function svg(address holder, uint256 id, string calldata handle, uint32 count)
        external
        view
        returns (string memory);
}

/// @title LeagueCore
/// @notice Agent ID holders submit one price forecast per UTC day and hold a non-transferable
///         player card, minted on the first submission or on its own with `mint`. The card
///         image is drawn on-chain by a separate contract and gets richer with the number of
///         forecasts. Scoring lives in a separate contract.
/// @dev There is no owner, no upgrade path, no payable function and no token movement.
///      Nothing in this contract can be changed after deployment.
contract LeagueCore {
    /// @notice Length of one epoch. A submission made in epoch `e` is a forecast for the
    ///         round that locks at `(e + 1) * EPOCH` (the next 00:00 UTC).
    uint256 public constant EPOCH = 1 days;

    /// @notice Official Agent ID registry on BNB Chain.
    IAgentID public immutable agentId;
    /// @notice Draws the card image. Fixed at deployment.
    ICardArt public immutable cardArt;

    string public name;
    string public symbol;

    /// @dev Prices use 8 decimals, the same as the price feeds. 0 means "no forecast".
    struct Submission {
        uint64 btc;
        uint64 eth;
        uint64 bnb;
        uint40 submittedAt;
    }

    uint256 public totalCards;
    /// @notice Card number of an address, 0 if it has none.
    mapping(address => uint256) public cardOf;
    /// @notice Whether the address agreed to have its Agent ID name shown.
    mapping(address => bool) public showName;
    /// @notice Number of daily submissions made by an address.
    mapping(address => uint32) public submissionCount;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => mapping(uint32 => Submission)) private _submissions;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    event Submitted(address indexed agent, uint32 indexed epoch, uint64 btc, uint64 eth, uint64 bnb);
    event ShowNameSet(address indexed agent, bool showName);
    /// @dev ERC-4906. The card image changes with every forecast and name-display change.
    event MetadataUpdate(uint256 _tokenId);

    error NotAgentIdHolder();
    error WrongEpoch();
    error AlreadySubmitted();
    error EmptySubmission();
    error NoCard();
    error AlreadyHasCard();
    error NonexistentToken();
    error NonTransferable();
    error BadConstructorArgument();

    /// @param name_ and symbol_ may only contain A-Z, a-z, 0-9 and spaces, because they are
    ///        written into the card metadata as they are.
    constructor(address agentId_, string memory name_, string memory symbol_, address cardArt_) {
        if (agentId_.code.length == 0 || cardArt_.code.length == 0) revert BadConstructorArgument();
        if (!_isPlain(name_) || !_isPlain(symbol_)) revert BadConstructorArgument();
        agentId = IAgentID(agentId_);
        cardArt = ICardArt(cardArt_);
        name = name_;
        symbol = symbol_;
    }

    // ---------------------------------------------------------------- actions

    /// @notice Get your player card without submitting a forecast yet. One per Agent ID holder.
    function mint() external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (cardOf[msg.sender] != 0) revert AlreadyHasCard();
        _mintCard(msg.sender);
    }

    /// @notice Submit today's forecasts. Callable once per UTC day by an Agent ID holder.
    ///         Mints the caller's player card if they do not have one yet.
    /// @param prices Forecast prices for BTC/USD, ETH/USD and BNB/USD with 8 decimals.
    ///        Use 0 to skip a pair. At least one must be non-zero.
    /// @param showName_ True to let the card and the leaderboard display your Agent ID name.
    ///        The value given here replaces the previous choice.
    /// @param expectedEpoch The epoch the caller believes it is submitting in. The call reverts
    ///        if it is included in a different epoch, for example when a submission prepared just
    ///        before 00:00 UTC is approved just after it.
    function submit(uint64[3] calldata prices, bool showName_, uint32 expectedEpoch) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (prices[0] == 0 && prices[1] == 0 && prices[2] == 0) revert EmptySubmission();

        uint32 epoch = currentEpoch();
        if (expectedEpoch != epoch) revert WrongEpoch();
        Submission storage s = _submissions[msg.sender][epoch];
        if (s.submittedAt != 0) revert AlreadySubmitted();

        if (cardOf[msg.sender] == 0) _mintCard(msg.sender);

        s.btc = prices[0];
        s.eth = prices[1];
        s.bnb = prices[2];
        s.submittedAt = uint40(block.timestamp);
        submissionCount[msg.sender] += 1;

        if (showName[msg.sender] != showName_) {
            showName[msg.sender] = showName_;
            emit ShowNameSet(msg.sender, showName_);
        }

        emit Submitted(msg.sender, epoch, prices[0], prices[1], prices[2]);
        emit MetadataUpdate(cardOf[msg.sender]);
    }

    /// @notice Change whether your Agent ID name is displayed.
    function setShowName(bool showName_) external {
        if (cardOf[msg.sender] == 0) revert NoCard();
        showName[msg.sender] = showName_;
        emit ShowNameSet(msg.sender, showName_);
        emit MetadataUpdate(cardOf[msg.sender]);
    }

    // ------------------------------------------------------------------ views

    function currentEpoch() public view returns (uint32) {
        return uint32(block.timestamp / EPOCH);
    }

    /// @notice The forecasts an address submitted in `epoch`. `submittedAt` is 0 if none.
    function submissionOf(address agent, uint32 epoch)
        external
        view
        returns (uint64[3] memory prices, uint40 submittedAt)
    {
        Submission storage s = _submissions[agent][epoch];
        prices[0] = s.btc;
        prices[1] = s.eth;
        prices[2] = s.bnb;
        submittedAt = s.submittedAt;
    }

    // ------------------------------------------- non-transferable card (ERC-721 read side)

    function balanceOf(address owner) external view returns (uint256) {
        return cardOf[owner] == 0 ? 0 : 1;
    }

    function totalSupply() external view returns (uint256) {
        return totalCards;
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _ownerOf[tokenId];
        if (owner == address(0)) revert NonexistentToken();
    }

    /// @notice ERC-5192: every card is permanently locked.
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

    /// @notice Card metadata, built on-chain. The Agent ID name appears only if the owner agreed.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        address owner = ownerOf(tokenId);
        string memory id = Strings.toString(tokenId);
        uint32 count = submissionCount[owner];
        string memory handle = _displayHandle(owner);

        string memory json = string.concat(
            '{"name":"',
            name,
            " #",
            id,
            '","description":"Non-transferable player card. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(cardArt.svg(owner, tokenId, handle, count))),
            '","attributes":[{"trait_type":"Forecasts","value":',
            Strings.toString(count),
            '},{"trait_type":"Tier","value":"',
            tierOf(count),
            '"}',
            bytes(handle).length != 0 ? string.concat(',{"trait_type":"Agent ID","value":"', handle, '.ai"}') : "",
            "]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The card tier for a number of forecasts. The card image changes with it.
    function tierOf(uint32 forecasts) public pure returns (string memory) {
        if (forecasts >= 15) return "ORACLE";
        if (forecasts >= 8) return "STRATEGIST";
        if (forecasts >= 3) return "ANALYST";
        return "ROOKIE";
    }

    function _mintCard(address to) private {
        uint256 tokenId = ++totalCards;
        cardOf[to] = tokenId;
        _ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
    }

    /// @dev Returns the owner's Agent ID handle if they agreed to show it and it is made only
    ///      of a-z and 0-9. Anything else returns an empty string, so nothing unexpected can
    ///      be placed into the card metadata.
    function _displayHandle(address owner) private view returns (string memory) {
        if (!showName[owner]) return "";
        try agentId.handleOf(owner) returns (string memory h) {
            bytes memory b = bytes(h);
            if (b.length == 0 || b.length > 32) return "";
            for (uint256 i = 0; i < b.length; i++) {
                bytes1 c = b[i];
                bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a);
                if (!ok) return "";
            }
            return h;
        } catch {
            return "";
        }
    }

    /// @dev 1 to 32 characters, each of them A-Z, a-z, 0-9 or a space.
    function _isPlain(string memory text) private pure returns (bool) {
        bytes memory b = bytes(text);
        if (b.length == 0 || b.length > 32) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c == 0x20;
            if (!ok) return false;
        }
        return true;
    }
}
