// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Soulbound} from "./Soulbound.sol";

/// @notice The function of a Forecast League ticket market that this contract reads.
interface IHouseMarket {
    function recordOf(address agent)
        external
        view
        returns (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak, uint32 unclaimed);
}

/// @title Forecast League Houses
/// @notice One call with no arguments puts an Agent ID holder into one of four houses and mints a
///         free, non-transferable house card. The house is fixed by the address, so nobody
///         chooses and nobody types a name. A house's score is read from its members' ticket
///         records in the markets this contract was deployed with.
/// @dev No owner, no payable function, no token movement. A house card has no monetary value.
contract Houses is Soulbound {
    string public constant name = "Forecast League House";
    string public constant symbol = "FLHOUSE";

    uint8 public constant HOUSES = 4;

    IHouseMarket public immutable market0;
    IHouseMarket public immutable market1;
    IHouseMarket public immutable market2;

    /// @notice The house card of an address (0 if it has none).
    mapping(address => uint256) public cardOf;
    /// @notice Members of a house (0 to 3).
    mapping(uint8 => uint32) public members;
    mapping(uint8 => address[]) private _roster;

    event Joined(address indexed agent, uint256 indexed tokenId, uint8 house);

    error AlreadyJoined();

    constructor(address agentId_, address market0_, address market1_, address market2_) Soulbound(agentId_) {
        if (market0_.code.length == 0) revert BadConstructorArgument();
        if (market1_ != address(0) && market1_.code.length == 0) revert BadConstructorArgument();
        if (market2_ != address(0) && market2_.code.length == 0) revert BadConstructorArgument();
        if (market1_ == market0_ || market2_ == market0_ || (market1_ != address(0) && market1_ == market2_)) {
            revert BadConstructorArgument();
        }
        market0 = IHouseMarket(market0_);
        market1 = IHouseMarket(market1_);
        market2 = IHouseMarket(market2_);
        IHouseMarket(market0_).recordOf(address(this));
        if (market1_ != address(0)) IHouseMarket(market1_).recordOf(address(this));
        if (market2_ != address(0)) IHouseMarket(market2_).recordOf(address(this));
    }

    /// @notice Join the house your address belongs to.
    function join() external {
        _join();
    }

    /// @notice The same as `join()`, under the name mint tools look for.
    function mint() external {
        _join();
    }

    /// @notice The same as `join()`.
    function claim() external {
        _join();
    }

    /// @notice The house of an address, 0 to 3, fixed by the address whether it joined or not.
    function houseOf(address agent) public pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encode(agent))) % HOUSES);
    }

    function houseName(uint8 house) public pure returns (string memory) {
        return house == 0 ? "EMBER" : house == 1 ? "TIDE" : house == 2 ? "GALE" : "STONE";
    }

    /// @notice True if the address already joined.
    function hasMinted(address agent) external view returns (bool) {
        return cardOf[agent] != 0;
    }

    /// @return house   The house of `agent`.
    /// @return canMint True if it holds an Agent ID and has not joined yet.
    /// @return size    Members of that house now.
    function todo(address agent) external view returns (uint8 house, bool canMint, uint32 size) {
        house = houseOf(agent);
        canMint = cardOf[agent] == 0 && _holdsAgentId(agent);
        size = members[house];
    }

    /// @notice A member's wins and losses over the markets.
    function scoreOf(address agent) public view returns (uint32 wins, uint32 losses) {
        (, uint32 w, uint32 l,,,) = market0.recordOf(agent);
        wins = w;
        losses = l;
        if (address(market1) != address(0)) {
            (, w, l,,,) = market1.recordOf(agent);
            wins += w;
            losses += l;
        }
        if (address(market2) != address(0)) {
            (, w, l,,,) = market2.recordOf(agent);
            wins += w;
            losses += l;
        }
    }

    /// @notice Wins and losses of a slice of a house's members, in joining order. A read for
    ///         standings; the caller pages through `members[house]`.
    function houseScore(uint8 house, uint256 from, uint256 count) external view returns (uint32 wins, uint32 losses) {
        address[] storage roster = _roster[house];
        uint256 end = from + count > roster.length ? roster.length : from + count;
        for (uint256 i = from; i < end; i++) {
            (uint32 w, uint32 l) = scoreOf(roster[i]);
            wins += w;
            losses += l;
        }
    }

    function memberAt(uint8 house, uint256 index) external view returns (address) {
        return _roster[house][index];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        address holder = ownerOf(tokenId);
        uint8 house = houseOf(holder);
        string memory label = houseName(house);
        string memory colour = house == 0 ? "#ff7a45" : house == 1 ? "#4aa3ff" : house == 2 ? "#b6f36a" : "#c9ced8";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#0b0c12"/>',
            '<path d="M200 60 L320 120 V230 C320 290 262 330 200 350 C138 330 80 290 80 230 V120 Z" fill="none" stroke="',
            colour,
            '" stroke-width="8"/><g font-family="monospace" text-anchor="middle"><text x="200" y="215" fill="',
            colour,
            '" font-size="40" letter-spacing="4">',
            label,
            '</text><text x="200" y="382" fill="#9aa0b4" font-size="14" letter-spacing="3">FORECAST LEAGUE HOUSE</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"House ',
            label,
            " #",
            Strings.toString(tokenId),
            '","description":"Non-transferable house card of Forecast League. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"House","value":"',
            label,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _join() private {
        _requireAgentId(msg.sender);
        if (cardOf[msg.sender] != 0) revert AlreadyJoined();
        uint8 house = houseOf(msg.sender);
        uint256 tokenId = _mintTo(msg.sender);
        cardOf[msg.sender] = tokenId;
        members[house] += 1;
        _roster[house].push(msg.sender);
        emit Joined(msg.sender, tokenId, house);
    }
}
