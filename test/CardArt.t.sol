// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CardArt} from "../src/CardArt.sol";
import {CardArtData} from "../src/CardArtData.sol";
import {CardTestUtils} from "./utils/CardTestUtils.sol";

/// @notice Checks the on-chain card art against the reference implementation in art/card.cjs.
///         The expected strings are in test/fixtures/cards.json, written by art/fixtures.cjs.
contract CardArtTest is CardTestUtils {
    CardArtData data;
    CardArt art;

    function setUp() public {
        data = new CardArtData();
        art = new CardArt(address(data));
    }

    function test_constructorNeedsTheDataContract() public {
        vm.expectRevert(CardArt.BadConstructorArgument.selector);
        new CardArt(address(0x1234)); // no contract there
        vm.expectRevert(); // a contract, but not CardArtData
        new CardArt(address(this));
        assertEq(address(art.data()), address(data));
    }

    function test_tierOf() public view {
        assertEq(art.tierOf(0), 0);
        assertEq(art.tierOf(2), 0);
        assertEq(art.tierOf(3), 1);
        assertEq(art.tierOf(7), 1);
        assertEq(art.tierOf(8), 2);
        assertEq(art.tierOf(14), 2);
        assertEq(art.tierOf(15), 3);
        assertEq(art.tierOf(type(uint32).max), 3);
    }

    /// @dev Field order follows the alphabetical order of the JSON keys: address, count, handle, id, svg.
    struct Fixture {
        address holder;
        uint256 count;
        string handle;
        uint256 id;
        string svg;
    }

    /// Every fixture must come out byte for byte the same as the reference.
    function test_matchesTheReferenceForEveryFixture() public view {
        Fixture[] memory fx = abi.decode(vm.parseJson(vm.readFile("test/fixtures/cards.json")), (Fixture[]));
        assertGe(fx.length, 81, "fixtures present");

        bool[8] memory palettes;
        bool[4] memory tiers;
        for (uint256 i = 0; i < fx.length; i++) {
            string memory got = art.svg(fx[i].holder, fx[i].id, fx[i].handle, uint32(fx[i].count));
            assertEq(
                keccak256(bytes(got)),
                keccak256(bytes(fx[i].svg)),
                string.concat("fixture ", vm.toString(i), " differs from the reference")
            );
            palettes[uint160(fx[i].holder) % 8] = true;
            tiers[art.tierOf(uint32(fx[i].count))] = true;
        }
        for (uint256 i = 0; i < 8; i++) {
            assertTrue(palettes[i], "every palette is covered");
        }
        for (uint256 i = 0; i < 4; i++) {
            assertTrue(tiers[i], "every tier is covered");
        }
    }

    /// The picture is well formed for any input the league can produce.
    function testFuzz_alwaysProducesAnSvg(address holder, uint256 id, uint32 count) public view {
        string memory s = art.svg(holder, id, "", count);
        bytes memory b = bytes(s);
        assertEq(_indexOf(b, bytes("<svg xmlns"), 0), 0);
        assertEq(_indexOf(b, bytes("</svg>"), 0), b.length - 6);
        assertTrue(_contains(s, "AGENT #"));
    }

    function test_longestHandleFits() public view {
        string memory s = art.svg(address(0xA11CE), 7, "abcdefghijklmnopqrstuvwxyz012345", 1); // 32 characters
        assertTrue(_contains(s, 'font-size="24">abcdefghijklmnopqrstuvwxyz012345<tspan'));
    }

    /// A record, not a limit: gas of drawing one card per tier.
    function test_gas_svg_perTier() public {
        uint32[4] memory counts = [uint32(1), 3, 8, 15];
        string[4] memory names = ["ROOKIE", "ANALYST", "STRATEGIST", "ORACLE"];
        for (uint256 i = 0; i < 4; i++) {
            uint256 before = gasleft();
            string memory s = art.svg(0x2a2F48145780639dbD91e748dF157F35283165Da, 1, "dopaminekr", counts[i]);
            uint256 used = before - gasleft();
            emit log_named_uint(string.concat("svg gas, ", names[i]), used);
            emit log_named_uint("  svg bytes", bytes(s).length);
            assertTrue(_contains(s, string.concat(">", names[i], "</text>")));
        }
    }
}
