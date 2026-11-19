// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @notice Helpers for reading the on-chain card metadata in tests.
abstract contract CardTestUtils is Test {
    function _b64val(bytes1 c) internal pure returns (uint8) {
        if (c >= "A" && c <= "Z") return uint8(c) - 65;
        if (c >= "a" && c <= "z") return uint8(c) - 71;
        if (c >= "0" && c <= "9") return uint8(c) + 4;
        if (c == "+") return 62;
        if (c == "/") return 63;
        return 0; // padding
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory out) {
        require(data.length % 4 == 0, "b64 length");
        uint256 pad = 0;
        if (data.length > 0 && data[data.length - 1] == "=") pad++;
        if (data.length > 1 && data[data.length - 2] == "=") pad++;
        out = new bytes((data.length / 4) * 3 - pad);
        uint256 o = 0;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint24 chunk = (uint24(_b64val(data[i])) << 18) | (uint24(_b64val(data[i + 1])) << 12)
                | (uint24(_b64val(data[i + 2])) << 6) | uint24(_b64val(data[i + 3]));
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(chunk));
        }
    }

    /// @dev Position of the first occurrence of `needle` at or after `from`, or type(uint256).max.
    function _indexOf(bytes memory h, bytes memory n, uint256 from) internal pure returns (uint256) {
        if (n.length == 0 || n.length > h.length) return type(uint256).max;
        for (uint256 i = from; i + n.length <= h.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return i;
        }
        return type(uint256).max;
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        return _indexOf(bytes(hay), bytes(needle), 0) != type(uint256).max;
    }

    function _slice(bytes memory data, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[start + i];
        }
    }

    /// @dev Decodes a `data:application/json;base64,...` token URI into its JSON text.
    function _jsonOf(string memory uri) internal pure returns (string memory) {
        bytes memory u = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        require(_indexOf(u, prefix, 0) == 0, "not a json data uri");
        return string(_b64decode(_slice(u, prefix.length, u.length)));
    }

    /// @dev Extracts and decodes the SVG image embedded in card metadata JSON.
    function _svgOf(string memory json) internal pure returns (string memory) {
        bytes memory j = bytes(json);
        bytes memory marker = bytes('"image":"data:image/svg+xml;base64,');
        uint256 at = _indexOf(j, marker, 0);
        require(at != type(uint256).max, "no image");
        uint256 start = at + marker.length;
        uint256 end = _indexOf(j, bytes('"'), start);
        return string(_b64decode(_slice(j, start, end)));
    }
}
