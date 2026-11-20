// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Soulbound} from "./Soulbound.sol";

/// @title Forecast League Stamps
/// @notice A free, non-transferable daily stamp for Agent ID holders: one per wallet per UTC day,
///         one call with no arguments. Stamps on consecutive days build a streak.
/// @dev No owner, no payable function, no token movement. A stamp has no monetary value.
contract Stamps is Soulbound {
    string public constant name = "Forecast League Stamp";
    string public constant symbol = "FLSTAMP";

    struct Stamp {
        uint32 day; // UTC day number: timestamp / 86400
        uint32 streak; // the holder's streak with this stamp
    }

    struct Record {
        uint32 lastDay;
        uint32 stamps;
        uint32 streak;
        uint32 bestStreak;
    }

    mapping(uint256 => Stamp) private _stamps;
    mapping(address => Record) private _records;
    /// @notice Stamps minted on a UTC day.
    mapping(uint32 => uint32) public dayMinted;

    event Stamped(address indexed agent, uint256 indexed tokenId, uint32 day, uint32 streak);

    error AlreadyStamped();

    constructor(address agentId_) Soulbound(agentId_) {}

    /// @notice Mint today's stamp.
    function checkIn() external {
        _stamp();
    }

    /// @notice The same as `checkIn()`, under the name mint tools look for.
    function mint() external {
        _stamp();
    }

    /// @notice The same as `checkIn()`.
    function claim() external {
        _stamp();
    }

    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Everything an agent needs to decide its next call, in one read.
    /// @return day           The UTC day number now.
    /// @return canMint       True if `agent` holds an Agent ID and has no stamp today.
    /// @return streak        Its streak if it stamps today (the running streak if it already did).
    /// @return secondsToNext Seconds until the next UTC day.
    /// @return minted        Stamps minted today so far.
    function todo(address agent)
        external
        view
        returns (uint32 day, bool canMint, uint32 streak, uint256 secondsToNext, uint32 minted)
    {
        day = today();
        Record memory rec = _records[agent];
        bool done = rec.stamps != 0 && rec.lastDay == day;
        canMint = !done && _holdsAgentId(agent);
        streak = done ? rec.streak : (rec.stamps != 0 && rec.lastDay + 1 == day ? rec.streak + 1 : 1);
        secondsToNext = (uint256(day) + 1) * 1 days - block.timestamp;
        minted = dayMinted[day];
    }

    /// @notice An address's record: stamps, running streak (0 if it missed yesterday and today),
    ///         best streak and the day of its last stamp.
    function recordOf(address agent) external view returns (uint32 stamps, uint32 streak, uint32 bestStreak, uint32 lastDay) {
        Record memory rec = _records[agent];
        uint32 day = today();
        bool alive = rec.stamps != 0 && (rec.lastDay == day || rec.lastDay + 1 == day);
        return (rec.stamps, alive ? rec.streak : 0, rec.bestStreak, rec.lastDay);
    }

    /// @notice True if the address already has today's stamp.
    function hasMinted(address agent) external view returns (bool) {
        Record memory rec = _records[agent];
        return rec.stamps != 0 && rec.lastDay == today();
    }

    function stamp(uint256 tokenId) external view returns (address holder, uint32 day, uint32 streak) {
        holder = ownerOf(tokenId);
        Stamp memory s = _stamps[tokenId];
        return (holder, s.day, s.streak);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        Stamp memory s = _stamps[tokenId];
        string memory day = Strings.toString(s.day);
        string memory streak = Strings.toString(s.streak);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#0b0c12"/>',
            '<rect x="60" y="60" width="280" height="280" rx="18" fill="none" stroke="#b6f36a" stroke-width="6" stroke-dasharray="14 8"/>',
            '<g font-family="monospace" text-anchor="middle"><text x="200" y="150" fill="#9aa0b4" font-size="18" letter-spacing="3">DAY ',
            day,
            '</text><text x="200" y="225" fill="#b6f36a" font-size="64">',
            streak,
            '</text><text x="200" y="262" fill="#9aa0b4" font-size="16" letter-spacing="3">DAY STREAK</text><text x="200" y="312" fill="#eef0f6" font-size="14" letter-spacing="3">FORECAST LEAGUE</text></g></svg>'
        );
        string memory json = string.concat(
            '{"name":"Stamp #',
            Strings.toString(tokenId),
            '","description":"Non-transferable daily stamp of Forecast League. It has no monetary value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Day","value":',
            day,
            '},{"trait_type":"Streak","value":',
            streak,
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _stamp() private {
        _requireAgentId(msg.sender);
        uint32 day = today();
        Record storage rec = _records[msg.sender];
        if (rec.stamps != 0 && rec.lastDay == day) revert AlreadyStamped();
        uint32 streak = rec.stamps != 0 && rec.lastDay + 1 == day ? rec.streak + 1 : 1;
        rec.lastDay = day;
        rec.stamps += 1;
        rec.streak = streak;
        if (streak > rec.bestStreak) rec.bestStreak = streak;
        dayMinted[day] += 1;
        uint256 tokenId = _mintTo(msg.sender);
        _stamps[tokenId] = Stamp(day, streak);
        emit Stamped(msg.sender, tokenId, day, streak);
    }
}
