// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Blitz} from "../../src/Blitz.sol";

interface IFeed {
    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @dev Runs against BNB Chain mainnet: the real Agent ID registry and the real BTC/USD feed.
contract BlitzForkTest is Test {
    address constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant BTC_USD = 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
    address constant HOLDER = 0x2a2F48145780639dbD91e748dF157F35283165Da; // holds dopaminekr.ai
    // Lock 2026-11-19 00:00 UTC, target 06:00 UTC. The two feed rounds were found off-chain
    // by keeper/keeper.mjs for the same times.
    uint32 constant ROUND = 83103;
    uint80 constant LOCK_FEED_ROUND = 55340232221129798731;
    uint80 constant TARGET_FEED_ROUND = 55340232221129799083;

    Blitz blitz;

    function setUp() public {
        vm.createSelectFork("bsc");
        blitz = new Blitz(REGISTRY, BTC_USD);
    }

    function test_settlesAPastRoundWithTheSameFeedRoundsAsTheOffChainSearch() public {
        assertEq(blitz.lockTime(ROUND), 1795046400);
        uint256 gasBefore = gasleft();
        blitz.settle(ROUND);
        emit log_named_uint("settle gas", gasBefore - gasleft());
        (uint64 p0, uint64 p1, uint8 outcome) = blitz.resultOf(ROUND);
        (, int256 a0,,,) = IFeed(BTC_USD).getRoundData(LOCK_FEED_ROUND);
        (, int256 a1,,,) = IFeed(BTC_USD).getRoundData(TARGET_FEED_ROUND);
        assertEq(p0, uint64(uint256(a0)));
        assertEq(p1, uint64(uint256(a1)));
        assertEq(outcome, a1 > a0 ? 1 : a1 < a0 ? 2 : 3);
    }

    function test_aRealHolderPlaysARound() public {
        (uint32 round, bool canPick,,) = blitz.todo(HOLDER);
        assertTrue(canPick);
        vm.prank(HOLDER);
        blitz.up();
        vm.prank(address(0xdead));
        vm.expectRevert(Blitz.NotAgentIdHolder.selector);
        blitz.up();
        assertEq(blitz.pickOf(HOLDER, round), 1);
    }
}
