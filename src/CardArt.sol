// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CardArtConstants} from "./CardArtConstants.sol";
import {CardArtData} from "./CardArtData.sol";

/// @title CardArt
/// @notice Draws the Forecast League player card as an SVG, entirely on-chain.
///         The card gets richer with the number of forecasts its holder has made:
///         0+ ROOKIE (bronze), 3+ ANALYST (silver), 8+ STRATEGIST (gold), 15+ ORACLE (holographic).
///         Colours and the chart inside the orb are derived from the holder's address.
/// @dev No owner, nothing payable, and no state apart from the fixed address of CardArtData,
///      which holds the larger SVG fragments (the art does not fit into one contract).
///      `art/card.cjs` is the reference implementation; this contract returns exactly the same
///      string for the same inputs.
contract CardArt is CardArtConstants {
    CardArtData public immutable data;

    error BadConstructorArgument();

    constructor(address data_) {
        if (data_.code.length == 0) revert BadConstructorArgument();
        data = CardArtData(data_);
        // Fails right here if the address is not a CardArtData contract.
        if (bytes(data.metal(0)).length == 0) revert BadConstructorArgument();
    }

    struct P {
        string a; // palette: deep
        string b; // palette: mid
        string c; // palette: bright
        string d; // palette: accent
        uint256 ti; // tier 0..3
        uint256 r; // orb radius
        uint256 f; // frame width
        uint256 cy; // orb centre, y
        uint256 id;
        uint256 count;
        uint256 lx; // last chart point
        uint256 ly;
        string scy; // cy as text
        string line; // chart points
        string num; // "#0001"
        string plain; // "name.ai" or "AGENT #0001"
        string rich; // the same with the ".ai" part coloured
        string size; // font size of the name
    }

    /// @param holder The card owner. Picks the palette and the shape of the chart.
    /// @param id The card number.
    /// @param handle The Agent ID name without ".ai", or an empty string to show "AGENT #id".
    ///        It is written into the SVG as it is: the caller must pass only a-z and 0-9.
    ///        LeagueCore, the only intended caller, guarantees that.
    /// @param count Number of forecasts the holder has made.
    function svg(address holder, uint256 id, string calldata handle, uint32 count)
        external
        view
        returns (string memory)
    {
        P memory p = _params(holder, id, handle, count);
        return string.concat(_defs(p), _field(p), _pedestal(p), _orb(p), _text(p));
    }

    /// @notice The tier for a number of forecasts: 0 ROOKIE, 1 ANALYST, 2 STRATEGIST, 3 ORACLE.
    function tierOf(uint32 count) public pure returns (uint256) {
        if (count >= 15) return 3;
        if (count >= 8) return 2;
        if (count >= 3) return 1;
        return 0;
    }

    // ------------------------------------------------------------- parameters

    function _params(address holder, uint256 id, string calldata handle, uint32 count)
        private
        pure
        returns (P memory p)
    {
        uint256 pal = uint160(holder) % 8; // the last byte of the address, modulo 8
        p.a = _colour(pal, 0);
        p.b = _colour(pal, 1);
        p.c = _colour(pal, 2);
        p.d = _colour(pal, 3);
        p.ti = tierOf(count);
        p.r = _radius(p.ti);
        p.f = _frame(p.ti);
        p.cy = 296 - p.r;
        p.scy = _u(p.cy);
        p.id = id;
        p.count = count;
        _chart(p, holder);

        p.num = string.concat("#", _pad4(id));
        uint256 len = bytes(handle).length;
        if (len == 0) {
            p.plain = string.concat("AGENT ", p.num);
            p.rich = p.plain;
            p.size = "36";
        } else {
            p.plain = string.concat(handle, ".ai");
            p.rich = string.concat(handle, '<tspan fill="#', p.d, '">.ai</tspan>');
            p.size = len <= 9 ? "44" : len <= 13 ? "36" : len <= 17 ? "29" : "24";
        }
    }

    /// @dev Ten points of a walk seeded by the first ten bytes of the address, kept inside the orb.
    function _chart(P memory p, address holder) private pure {
        bytes20 raw = bytes20(holder);
        int256 r = int256(p.r);
        int256 y = int256(p.cy) + (r * 42) / 100;
        int256 top = int256(p.cy) - (r * 55) / 100;
        int256 bottom = int256(p.cy) + (r * 55) / 100;
        uint256 x0 = 250 - (p.r * 72) / 100;
        uint256 step = p.r / 6;
        string memory line;
        for (uint256 i = 0; i < 10; i++) {
            y -= ((int256(uint256(uint8(raw[i])) % 45) - 16) * r) / 110;
            if (y < top) y = top;
            if (y > bottom) y = bottom;
            p.lx = x0 + i * step;
            p.ly = uint256(y);
            line = string.concat(line, i == 0 ? "" : " ", _u(p.lx), ",", _u(p.ly));
        }
        p.line = line;
    }

    // ------------------------------------------------------------------ parts

    function _defs(P memory p) private view returns (string memory) {
        return string.concat(_defsMetal(p), _defsColour(p), _defsFilters(p));
    }

    function _defsMetal(P memory p) private view returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><defs>',
            '<linearGradient id="m" x1="0" y1="0" x2="1" y2="1">',
            data.metal(p.ti),
            '</linearGradient><linearGradient id="p" x1="0" y1="0" x2="1" y2="0">',
            data.metalRound(p.ti),
            "</linearGradient>",
            '<linearGradient id="v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>',
            '<linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset=".5" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>'
        );
    }

    function _defsColour(P memory p) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '<radialGradient id="o" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".16" stop-color="#',
                p.d,
                '"/><stop offset=".5" stop-color="#',
                p.b,
                '"/><stop offset="1" stop-color="#',
                p.a,
                '"/></radialGradient>',
                '<radialGradient id="s"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>'
            ),
            string.concat(
                '<radialGradient id="j" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#',
                p.d,
                '"/><stop offset="1" stop-color="#',
                p.b,
                '"/></radialGradient>',
                '<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            ),
            string.concat(
                '<linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#',
                p.c,
                '" stop-opacity=".2"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#',
                p.d,
                '" stop-opacity=".25"/></linearGradient>',
                '<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#',
                p.d,
                '"/></linearGradient>'
            )
        );
    }

    function _defsFilters(P memory p) private pure returns (string memory) {
        string memory f = _u(p.f);
        string memory w = _u(500 - 2 * p.f);
        return string.concat(
            string.concat(
                '<filter id="b1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="44"/></filter>',
                '<filter id="b2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>',
                '<filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>',
                '<clipPath id="c"><circle cx="250" cy="',
                p.scy,
                '" r="',
                _u(p.r - 3),
                '"/></clipPath>'
            ),
            string.concat(
                '<clipPath id="k"><rect x="',
                f,
                '" y="',
                f,
                '" width="',
                w,
                '" height="',
                w,
                '" rx="',
                _u(40 - (p.f * 6) / 10),
                '"/></clipPath></defs>'
            )
        );
    }

    function _field(P memory p) private view returns (string memory) {
        return string.concat(_fieldBack(p), _fieldLight(p), _fieldEdge(p));
    }

    function _fieldBack(P memory p) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '<rect width="500" height="500" rx="40" fill="url(#m)"/>',
                '<rect x="2" y="2" width="496" height="496" rx="38" fill="none" stroke="url(#v)" stroke-width="4"/>',
                '<g clip-path="url(#k)"><rect width="500" height="500" fill="#06060B"/>',
                '<g filter="url(#b1)" opacity="',
                _blobOpacity(p.ti),
                '"><circle cx="110" cy="90" r="130" fill="#',
                p.b
            ),
            string.concat(
                '"/><circle cx="420" cy="180" r="110" fill="#',
                p.c,
                '" fill-opacity=".7"/><circle cx="250" cy="480" r="150" fill="#',
                p.b,
                '" fill-opacity=".85"/>'
            ),
            p.ti == 3
                ? string.concat('<circle cx="250" cy="', p.scy, '" r="120" fill="#', p.d, '" fill-opacity=".55"/>')
                : "",
            "</g>"
        );
    }

    function _fieldLight(P memory p) private view returns (string memory) {
        string memory rays;
        if (p.ti >= 2) {
            rays = string.concat(
                '<path d="',
                data.rays(p.ti),
                '" fill="#fff" fill-opacity="',
                p.ti == 3 ? ".1" : ".06",
                '">',
                p.ti == 3
                    ? string.concat(
                        '<animateTransform attributeName="transform" type="rotate" from="0 250 ',
                        p.scy,
                        '" to="360 250 ',
                        p.scy,
                        '" dur="60s" repeatCount="indefinite"/>'
                    )
                    : "",
                "</path>"
            );
        }
        return string.concat(
            rays,
            '<rect width="500" height="500" fill="url(#s)" fill-opacity=".55"/>',
            data.sparkles(p.ti),
            "</g>"
        );
    }

    function _fieldEdge(P memory p) private pure returns (string memory) {
        string memory f = _u(p.f);
        string memory w = _u(500 - 2 * p.f);
        string memory edge = string.concat(
            '<rect x="',
            f,
            '" y="',
            f,
            '" width="',
            w,
            '" height="',
            w,
            '" rx="',
            _u(40 - (p.f * 6) / 10),
            '" fill="none" stroke="url(#w)" stroke-width="5"/>'
        );
        if (p.ti < 2) return edge;
        uint256 g = p.f / 2 + 6;
        return string.concat(
            edge, _gem(p, g, g), _gem(p, 500 - g, g), _gem(p, g, 500 - g), _gem(p, 500 - g, 500 - g)
        );
    }

    function _gem(P memory p, uint256 x, uint256 y) private pure returns (string memory) {
        return string.concat(
            '<circle cx="',
            _u(x),
            '" cy="',
            _u(y),
            '" r="',
            _u(p.ti + 5),
            '" fill="url(#j)" stroke="#000" stroke-opacity=".45"/><circle cx="',
            _u(x - 2),
            '" cy="',
            _u(y - 2),
            '" r="2" fill="#fff" fill-opacity=".9"/>'
        );
    }

    function _pedestal(P memory p) private pure returns (string memory) {
        uint256 pw = 58 + p.ti * 10;
        string memory spw = _u(pw);
        string memory h = p.ti >= 2 ? "22" : "26";
        string memory base;
        if (p.ti >= 2) {
            base = string.concat(
                '<path d="M',
                _u(232 - pw),
                " 322v10a",
                _u(pw + 18),
                " 13 0 0 0 ",
                _u(2 * pw + 36),
                ' 0v-10z" fill="url(#p)"/><ellipse cx="250" cy="322" rx="',
                _u(pw + 18),
                '" ry="13" fill="url(#m)"/>'
            );
        }
        return string.concat(
            string.concat(
                '<ellipse cx="250" cy="336" rx="',
                _u(pw + 34),
                '" ry="14" fill="#000" fill-opacity=".6" filter="url(#b2)"/>',
                base,
                '<path d="M',
                _u(250 - pw),
                " 300v",
                h,
                "a",
                spw
            ),
            string.concat(
                " 12 0 0 0 ",
                _u(2 * pw),
                " 0v-",
                h,
                'z" fill="url(#p)"/><ellipse cx="250" cy="300" rx="',
                spw,
                '" ry="12" fill="url(#m)"/><ellipse cx="250" cy="300" rx="',
                _u(pw - 12)
            ),
            string.concat(
                '" ry="8" fill="#000" fill-opacity=".45"/><ellipse cx="250" cy="300" rx="',
                _u(pw - 16),
                '" ry="6" fill="#',
                p.d,
                '" fill-opacity="',
                _pedestalGlow(p.ti),
                '" filter="url(#b3)"/>'
            )
        );
    }

    function _orb(P memory p) private view returns (string memory) {
        return string.concat(data.ringsBack(p.ti), _orbBody(p), _orbLight(p), data.ringsFront(p.ti), _halo(p));
    }

    function _orbBody(P memory p) private pure returns (string memory) {
        string memory glow;
        if (p.ti > 0) {
            glow = string.concat(
                '<circle cx="250" cy="',
                p.scy,
                '" r="',
                _u(p.r + 10 + p.ti * 4),
                '" fill="#',
                p.d,
                '" fill-opacity="',
                _glowOpacity(p.ti),
                '" filter="url(#b2)"/>'
            );
        }
        string memory sr = _u(p.r);
        return string.concat(
            string.concat(
                glow,
                '<circle cx="250" cy="',
                p.scy,
                '" r="',
                sr,
                '" fill="url(#o)"/><g clip-path="url(#c)"><polyline points="',
                p.line,
                '" fill="none" stroke="#fff" stroke-width="9" stroke-opacity=".5" stroke-linecap="round" stroke-linejoin="round" filter="url(#b3)"/><polyline points="',
                p.line
            ),
            string.concat(
                '" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><circle cx="250" cy="',
                p.scy,
                '" r="',
                sr,
                '" fill="url(#s)"/><circle cx="',
                _u(p.lx),
                '" cy="',
                _u(p.ly),
                '" r="5" fill="#fff"><animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite"/></circle>'
            )
        );
    }

    function _orbLight(P memory p) private pure returns (string memory) {
        string memory hx = _u(250 - (p.r * 34) / 100);
        string memory hy = _u(p.cy - (p.r * 54) / 100);
        string memory kx = _u(250 + (p.r * 38) / 100);
        string memory ky = _u(p.cy + (p.r * 60) / 100);
        return string.concat(
            string.concat(
                '<ellipse cx="',
                hx,
                '" cy="',
                hy,
                '" rx="',
                _u(p.r / 2),
                '" ry="',
                _u((p.r * 26) / 100),
                '" transform="rotate(-24 ',
                hx,
                " ",
                hy
            ),
            string.concat(
                ')" fill="url(#h)" fill-opacity="',
                _highlightOpacity(p.ti),
                '"/><ellipse cx="',
                kx,
                '" cy="',
                ky,
                '" rx="',
                _u((p.r * 3) / 10),
                '" ry="',
                _u((p.r * 12) / 100)
            ),
            string.concat(
                '" transform="rotate(-30 ',
                kx,
                " ",
                ky,
                ')" fill="#',
                p.d,
                '" fill-opacity=".3" filter="url(#b3)"/><circle cx="250" cy="',
                p.scy,
                '" r="',
                _u(p.r - 1),
                '" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2"/>'
            )
        );
    }

    function _halo(P memory p) private pure returns (string memory) {
        if (p.ti != 3) return "";
        string memory y = _u(p.cy - p.r - 12);
        return string.concat(
            '<ellipse cx="250" cy="',
            y,
            '" rx="42" ry="9" fill="none" stroke="#FFF2A8" stroke-width="7" filter="url(#b3)"/><ellipse cx="250" cy="',
            y,
            '" rx="42" ry="9" fill="none" stroke="#fff" stroke-width="3"/>'
        );
    }

    function _text(P memory p) private pure returns (string memory) {
        return string.concat(_textHead(p), _textName(p), _textFoot(p));
    }

    function _textHead(P memory p) private pure returns (string memory) {
        uint256 e = 500 - p.f;
        string memory left = _u(p.f + 24);
        string memory genesis;
        if (p.id <= 100) {
            genesis = string.concat(
                '<text x="',
                left,
                '" y="',
                _u(p.f + 62),
                '" fill="#FFD95A" font-size="11" letter-spacing="4">GENESIS</text>'
            );
        }
        return string.concat(
            string.concat(
                '<g font-family="Arial,Helvetica,sans-serif" font-weight="bold"><text x="',
                left,
                '" y="',
                _u(p.f + 40),
                '" fill="#fff" fill-opacity=".8" font-size="14" letter-spacing="5">FORECAST LEAGUE</text><rect x="',
                _u(e - 112),
                '" y="',
                _u(p.f + 19),
                '" width="88" height="32" rx="16" fill="#000" fill-opacity=".5"/><rect x="',
                _u(e - 112)
            ),
            string.concat(
                '" y="',
                _u(p.f + 17),
                '" width="88" height="32" rx="16" fill="url(#m)"/><rect x="',
                _u(e - 109),
                '" y="',
                _u(p.f + 19),
                '" width="82" height="13" rx="7" fill="#fff" fill-opacity=".3"/><text x="',
                _u(e - 68),
                '" y="',
                _u(p.f + 39)
            ),
            string.concat('" text-anchor="middle" fill="#14100A" font-size="16">', p.num, "</text>", genesis),
            string.concat(
                '<rect x="160" y="357" width="180" height="34" rx="17" fill="#000" fill-opacity=".55"/><rect x="162" y="354" width="176" height="34" rx="17" fill="url(#m)"/><rect x="166" y="357" width="168" height="14" rx="7" fill="#fff" fill-opacity=".32"/>',
                '<text x="250" y="377" text-anchor="middle" fill="#14100A" font-size="15" letter-spacing="4">',
                _tierName(p.ti),
                "</text>"
            )
        );
    }

    /// @dev Four darker copies underneath give the name its thickness.
    function _textName(P memory p) private pure returns (string memory) {
        return string.concat(
            _nameLayer(p, 5, p.a, ' fill-opacity=".6"'),
            _nameLayer(p, 4, p.a, ""),
            _nameLayer(p, 3, p.b, ""),
            _nameLayer(p, 2, p.b, ""),
            '<text x="250" y="438" text-anchor="middle" fill="url(#t)" font-size="',
            p.size,
            '">',
            p.rich,
            "</text>"
        );
    }

    function _nameLayer(P memory p, uint256 depth, string memory colour, string memory opacity)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<text x="250" y="',
            _u(438 + depth),
            '" text-anchor="middle" fill="#',
            colour,
            '"',
            opacity,
            ' font-size="',
            p.size,
            '">',
            p.plain,
            "</text>"
        );
    }

    function _textFoot(P memory p) private pure returns (string memory) {
        uint256 e = 500 - p.f;
        uint256 progress = 150;
        if (p.ti < 3) {
            uint256 lo = p.ti == 0 ? 0 : p.ti == 1 ? 3 : 8;
            uint256 hi = p.ti == 0 ? 3 : p.ti == 1 ? 8 : 15;
            progress = ((p.count - lo) * 150) / (hi - lo);
        }
        string memory bar;
        if (progress > 0) {
            bar = string.concat(
                '<rect x="',
                _u(e - 176),
                '" y="',
                _u(e - 27),
                '" width="',
                _u(progress),
                '" height="8" rx="4" fill="url(#m)"/>'
            );
        }
        return string.concat(
            '<text x="',
            _u(p.f + 24),
            '" y="',
            _u(e - 18),
            '" fill="#fff" fill-opacity=".7" font-size="12" letter-spacing="2">FORECASTS ',
            _u(p.count),
            '</text></g><rect x="',
            _u(e - 178),
            '" y="',
            _u(e - 29),
            '" width="154" height="12" rx="6" fill="#000" fill-opacity=".6"/>',
            bar,
            "</svg>"
        );
    }

    // ---------------------------------------------------------------- helpers

    function _u(uint256 value) private pure returns (string memory) {
        return Strings.toString(value);
    }

    /// @dev Card numbers below 1000 are padded to four digits.
    function _pad4(uint256 id) private pure returns (string memory) {
        string memory s = _u(id);
        if (id >= 1000) return s;
        if (id >= 100) return string.concat("0", s);
        if (id >= 10) return string.concat("00", s);
        return string.concat("000", s);
    }

    function _colour(uint256 palette, uint256 index) private pure returns (string memory) {
        bytes memory all = PALETTE;
        bytes memory out = new bytes(6);
        uint256 start = (palette * 4 + index) * 6;
        for (uint256 i = 0; i < 6; i++) {
            out[i] = all[start + i];
        }
        return string(out);
    }
}
