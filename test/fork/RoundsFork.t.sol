// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Rounds} from "../../src/Rounds.sol";

/// @dev The same Blitz code with another Chainlink feed: does a past round settle from the real
///      ETH/USD and BNB/USD feeds on BNB Chain? Runs against a fork; deploys nothing on mainnet.
contract RoundsForkTest is Test {
    address constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant SQUADS = 0x1eAeEE5BA7582858b266920E79938203E92120D0;
    address constant HOLDER = 0x2a2F48145780639dbD91e748dF157F35283165Da;
    address constant ETH_USD = 0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e;
    address constant BNB_USD = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    address constant BTC_USD = 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
    uint256 LENGTH = 1 hours;

    function setUp() public {
        vm.createSelectFork("bsc");
    }

    function _playPastRounds(address feed, string memory label) internal {
        uint256 nowTime = block.timestamp;
        Rounds blitz = new Rounds(REGISTRY, feed, SQUADS, LENGTH);
        uint32 current = uint32(nowTime / LENGTH);
        // Three finished rounds: tickets in rounds current-4, current-3 and current-2 (results exist by now).
        for (uint32 k = 4; k >= 2; k--) {
            uint32 round = current - k;
            vm.warp(uint256(round) * LENGTH + 60);
            vm.prank(HOLDER);
            blitz.mint();
        }
        vm.warp(nowTime);
        uint256 gasBefore = gasleft();
        vm.prank(HOLDER);
        blitz.claim();
        emit log_named_uint(string.concat(label, ": gas of the claim that settles three rounds"), gasBefore - gasleft());
        for (uint32 k = 4; k >= 2; k--) {
            (uint64 p0, uint64 p1, uint8 outcome, bool finished) = blitz.resultOf(current - k);
            emit log_named_uint(string.concat(label, " lock price (8 decimals)"), p0);
            emit log_named_uint(string.concat(label, " target price"), p1);
            emit log_named_uint(string.concat(label, " outcome (1 up, 2 down, 3 push, 4 void)"), outcome);
            assertTrue(finished);
            assertTrue(outcome == 1 || outcome == 2 || outcome == 3, "a past round must settle from the real feed");
            assertGt(p0, 0);
            assertGt(p1, 0);
        }
        (uint32 picks, uint32 wins, uint32 losses,,, uint32 unclaimed) = blitz.recordOf(HOLDER);
        assertEq(picks, 3);
        assertEq(unclaimed, 0);
        assertLe(wins + losses, 3);
    }

    function test_ethUsdRoundsSettleFromTheRealFeed() public {
        _playPastRounds(ETH_USD, "ETH/USD");
    }

    function test_bnbUsdRoundsSettleFromTheRealFeed() public {
        _playPastRounds(BNB_USD, "BNB/USD");
    }

    function test_hourlyBtcRoundsSettleFromTheRealFeed() public {
        _playPastRounds(BTC_USD, "BTC/USD hourly");
    }

    function test_dailyBtcRoundsSettleFromTheRealFeed() public {
        LENGTH = 24 hours;
        _playPastRounds(BTC_USD, "BTC/USD daily");
    }
}
