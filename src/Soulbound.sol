// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The function of the official Agent ID registry that these contracts read.
interface IAgentIdRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Soulbound
/// @notice The shared read side of a free, non-transferable ERC-721 token with no owner, no price
///         and no cap, plus the reads mint tools look for. A contract that inherits this mints
///         with `_mintTo` and supplies `tokenURI`.
abstract contract Soulbound {
    IAgentIdRegistry public immutable agentId;

    uint256 public totalSupply;
    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) internal _balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    /// @notice ERC-5192: the token is locked from the moment it exists.
    event Locked(uint256 tokenId);

    error NotAgentIdHolder();
    error NothingToClaim();
    error ZeroAddress();
    error NonexistentToken();
    error NonTransferable();
    error BadConstructorArgument();

    constructor(address agentId_) {
        if (agentId_.code.length == 0) revert BadConstructorArgument();
        agentId = IAgentIdRegistry(agentId_);
        // With no owner a wrong address could never be repaired, so it must answer now.
        IAgentIdRegistry(agentId_).balanceOf(address(this));
    }

    function _requireAgentId(address agent) internal view {
        if (agentId.balanceOf(agent) == 0) revert NotAgentIdHolder();
    }

    function _holdsAgentId(address agent) internal view returns (bool) {
        try agentId.balanceOf(agent) returns (uint256 balance) {
            return balance != 0;
        } catch {
            return false;
        }
    }

    function _mintTo(address to) internal returns (uint256 tokenId) {
        tokenId = ++totalSupply;
        _ownerOf[tokenId] = to;
        _balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
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

    /// @notice Tokens ever minted. The same as `totalSupply`; there is no cap.
    function totalMinted() external view returns (uint256) {
        return totalSupply;
    }

    /// @notice There is no cap, returned as the largest number.
    function maxSupply() external pure returns (uint256) {
        return type(uint256).max;
    }

    // ------------------------------------------------ non-transferable ERC-721 read side

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balanceOf[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _ownerOf[tokenId];
        if (holder == address(0)) revert NonexistentToken();
    }

    /// @notice ERC-5192: every token is permanently locked.
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
}
