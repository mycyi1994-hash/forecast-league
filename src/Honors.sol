// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Soulbound} from "./Soulbound.sol";

/// @notice The function of the Forecast League player card that this contract reads.
interface IHonorCard {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice The function of a Forecast League ticket market that this contract reads.
interface IHonorMarket {
    function recordOf(address agent)
        external
        view
        returns (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak, uint32 unclaimed);
}

/// @title Forecast League Honors
/// @notice Free, non-transferable honors for Agent ID holders. One call with no arguments mints
///         every honor the caller has earned and does not hold yet:
///           0 SEASON ONE   any Agent ID holder, until the season ends
///           1 CARD HOLDER  holds the Forecast League player card
///           2 FIRST WIN    1 ticket win written into its record, over the markets
///           3 FIVE WINS    5 wins
///           4 STREAK 3     a best streak of 3 in one market
///           5 STREAK 5     a best streak of 5 in one market
/// @dev No owner, no payable function, no token movement. An honor has no monetary value.
contract Honors is Soulbound {
    string public constant name = "Forecast League Honor";
    string public constant symbol = "FLHONOR";

    uint8 public constant KINDS = 6;
    /// @notice The SEASON ONE honor can be minted until this time (9 December 2026, 08:00 UTC).
    uint256 public constant SEASON_END = 1796803200;

    IHonorCard public immutable card;
    IHonorMarket public immutable market0;
    IHonorMarket public immutable market1;
    IHonorMarket public immutable market2;

    /// @notice The kind of a token.
    mapping(uint256 => uint8) public kindOf;
    /// @notice The token an address holds of a kind (0 if none).
    mapping(address => mapping(uint8 => uint256)) public honorOf;
    /// @notice Honors minted of a kind.
    mapping(uint8 => uint32) public kindMinted;

    event Honored(address indexed agent, uint256 indexed tokenId, uint8 kind);

    constructor(address agentId_, address card_, address market0_, address market1_, address market2_)
        Soulbound(agentId_)
    {
        if (card_.code.length == 0 || market0_.code.length == 0) revert BadConstructorArgument();
        if (market1_ != address(0) && market1_.code.length == 0) revert BadConstructorArgument();
        if (market2_ != address(0) && market2_.code.length == 0) revert BadConstructorArgument();
        if (market1_ == market0_ || market2_ == market0_ || (market1_ != address(0) && market1_ == market2_)) {
            revert BadConstructorArgument();
        }
        card = IHonorCard(card_);
        market0 = IHonorMarket(market0_);
        market1 = IHonorMarket(market1_);
        market2 = IHonorMarket(market2_);
        IHonorCard(card_).balanceOf(address(this));
        IHonorMarket(market0_).recordOf(address(this));
        if (market1_ != address(0)) IHonorMarket(market1_).recordOf(address(this));
        if (market2_ != address(0)) IHonorMarket(market2_).recordOf(address(this));
    }

    /// @notice Mint every honor the caller has earned and does not hold yet. Reverts with
    ///         NothingToClaim if there is none.
    function claim() external {
        _claim();
    }

    /// @notice The same as `claim()`, under the name mint tools look for.
    function mint() external {
        _claim();
    }

    function kindName(uint8 kind) public pure returns (string memory) {
        if (kind == 0) return "SEASON ONE";
        if (kind == 1) return "CARD HOLDER";
        if (kind == 2) return "FIRST WIN";
        if (kind == 3) return "FIVE WINS";
        if (kind == 4) return "STREAK 3";
        return "STREAK 5";
    }

    /// @notice Whether an address meets the condition of a kind now (whether or not it holds it).
    function earned(address agent, uint8 kind) public view returns (bool) {
        if (kind == 0) return block.timestamp <= SEASON_END;
        if (kind == 1) return card.balanceOf(agent) != 0;
        (uint32 wins, uint32 best) = _winsAndBest(agent);
        if (kind == 2) return wins >= 1;
        if (kind == 3) return wins >= 5;
        if (kind == 4) return best >= 3;
        if (kind == 5) return best >= 5;
        return false;
    }

    /// @notice One read for an agent: how many honors `claim()` would mint now and which
    ///         (bit k set for kind k), and which it already holds.
    function todo(address agent) public view returns (uint8 claimable, uint8 claimableMask, uint8 heldMask) {
        bool holder = agent != address(0) && _holdsAgentId(agent);
        for (uint8 k = 0; k < KINDS; k++) {
            if (honorOf[agent][k] != 0) {
                heldMask |= uint8(1 << k);
            } else if (holder && earned(agent, k)) {
                claimable += 1;
                claimableMask |= uint8(1 << k);
            }
        }
    }

    /// @notice True if `claim()` would mint nothing for the address now.
    function hasMinted(address agent) external view returns (bool) {
        (uint8 claimable,,) = todo(agent);
        return claimable == 0;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        uint8 kind = kindOf[tokenId];
        string memory label = kindName(kind);
        string memory colour = kind == 0 ? "#b6f36a" : kind == 1 ? "#4aa3ff" : kind < 4 ? "#f2c84b" : "#ff7a45";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#0b0c12"/>',
            '<polygon points="200,60 236,150 332,156 258,216 282,310 200,258 118,310 142,216 68,156 164,150" fill="none" stroke="',
            colour,
            '" stroke-width="8"/><g font-family="monospace" text-anchor="middle"><text x="200" y="352" fill="',
            colour,
            '" font-size="26" letter-spacing="3">',
            label,
            '</text><text x="200" y="382" fill="#9aa0b4" font-size="13" letter-spacing="3">FORECAST LEAGUE HONOR</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"',
            label,
            " #",
            Strings.toString(tokenId),
            '","description":"Non-transferable honor of Forecast League. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Honor","value":"',
            label,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _winsAndBest(address agent) private view returns (uint32 wins, uint32 best) {
        (, uint32 w,,, uint32 b,) = market0.recordOf(agent);
        wins = w;
        best = b;
        if (address(market1) != address(0)) {
            (, w,,, b,) = market1.recordOf(agent);
            wins += w;
            if (b > best) best = b;
        }
        if (address(market2) != address(0)) {
            (, w,,, b,) = market2.recordOf(agent);
            wins += w;
            if (b > best) best = b;
        }
    }

    function _claim() private {
        _requireAgentId(msg.sender);
        uint256 minted;
        for (uint8 k = 0; k < KINDS; k++) {
            if (honorOf[msg.sender][k] != 0 || !earned(msg.sender, k)) continue;
            uint256 tokenId = _mintTo(msg.sender);
            kindOf[tokenId] = k;
            honorOf[msg.sender][k] = tokenId;
            kindMinted[k] += 1;
            minted += 1;
            emit Honored(msg.sender, tokenId, k);
        }
        if (minted == 0) revert NothingToClaim();
    }
}
