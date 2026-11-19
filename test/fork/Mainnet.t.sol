// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LeagueCore} from "../../src/LeagueCore.sol";
import {Scorer, IPriceFeed} from "../../src/Scorer.sol";
import {CardArt} from "../../src/CardArt.sol";
import {CardArtData} from "../../src/CardArtData.sol";
import {CardTestUtils} from "../utils/CardTestUtils.sol";

interface IFeedLatest {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Runs against a fork of BNB Chain mainnet with the real Agent ID registry and price feeds.
///         Run with: FOUNDRY_PROFILE=fork forge test
contract MainnetForkTest is CardTestUtils {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant FEED_BTC = 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
    address constant FEED_ETH = 0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e;
    address constant FEED_BNB = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    /// A real Agentic Wallet address that holds an Agent ID (handle "dopaminekr").
    address constant HOLDER = 0x2a2F48145780639dbD91e748dF157F35283165Da;

    LeagueCore core;
    Scorer scorer;
    uint256 nowTs;

    function setUp() public {
        vm.createSelectFork("bsc");
        nowTs = block.timestamp;
        CardArt art = new CardArt(address(new CardArtData()));
        core = new LeagueCore(AGENT_ID, "Forecast League", "FCL", address(art));
        scorer = new Scorer(address(core), FEED_BTC, FEED_ETH, FEED_BNB, 6 hours);
    }

    /// Last feed round updated at or before `t`, found by binary search inside the current phase.
    function _roundAt(address feed, uint256 t) internal view returns (uint80) {
        (uint80 latest,,,,) = IFeedLatest(feed).latestRoundData();
        uint80 lo = latest - 8000;
        uint80 hi = latest;
        while (lo < hi) {
            uint80 mid = lo + (hi - lo + 1) / 2;
            (,,, uint256 updatedAt,) = IFeedLatest(feed).getRoundData(mid);
            if (updatedAt <= t) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function test_realRegistry_gatesSubmission() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(LeagueCore.NotAgentIdHolder.selector);
        core.submit([uint64(1), 0, 0], false, uint32(block.timestamp / 1 days));

        vm.prank(address(0xBEEF));
        vm.expectRevert(LeagueCore.NotAgentIdHolder.selector);
        core.mint();

        vm.prank(HOLDER);
        core.mint();
        assertEq(core.cardOf(HOLDER), 1);

        vm.prank(HOLDER);
        core.submit([uint64(6_380_000_000_000), 180_000_000_000, 59_000_000_000], true, uint32(block.timestamp / 1 days));
        assertEq(core.cardOf(HOLDER), 1);
        assertEq(core.totalCards(), 1);
    }

    function test_realFeeds_fullRound() public {
        // Pick the most recent epoch whose target time is already in the past.
        uint32 epoch = uint32(nowTs / 1 days) - 1;
        if (scorer.lockTime(epoch) + 6 hours > nowTs) epoch -= 1;
        uint256 lockAt = scorer.lockTime(epoch);
        uint256 targetAt = lockAt + 6 hours;

        // Submit four hours before the lock, as a real user would.
        vm.warp(lockAt - 4 hours);
        vm.prank(HOLDER);
        core.submit([uint64(6_380_000_000_000), 180_000_000_000, 59_000_000_000], true, epoch);
        vm.warp(nowTs);

        address[3] memory feeds = [FEED_BTC, FEED_ETH, FEED_BNB];
        for (uint8 i = 0; i < 3; i++) {
            uint80 r0 = _roundAt(feeds[i], lockAt);
            uint80 r1 = _roundAt(feeds[i], targetAt);

            // Older rounds are refused: only the latest round at or before each time is accepted.
            vm.expectRevert(Scorer.NotLatestRound.selector);
            scorer.settle(epoch, i, r0 - 1, r1);
            vm.expectRevert(Scorer.NotLatestRound.selector);
            scorer.settle(epoch, i, r0, r1 - 5);
            // The round after the latest one was updated after the reference time.
            vm.expectRevert(Scorer.BadFeedRound.selector);
            scorer.settle(epoch, i, r0 + 1, r1);
            scorer.settle(epoch, i, r0, r1);

            (Scorer.Round memory r,) = scorer.roundOf(epoch, i);
            assertLe(r.t0, lockAt);
            assertLe(lockAt - r.t0, 5 minutes);
            assertLe(r.t1, targetAt);
            assertLe(targetAt - r.t1, 5 minutes);
            emit log_named_decimal_uint("P0", r.p0, 8);
            emit log_named_decimal_uint("P1", r.p1, 8);
        }

        vm.warp(nowTs + 30 minutes);
        scorer.score(HOLDER, epoch);
        (uint32 epochs, uint32 forecasts,, int64 total) = scorer.statsOf(HOLDER);
        assertEq(epochs, 1);
        assertEq(forecasts, 3);
        assertGe(total, -300);
        assertLe(total, 300);
        emit log_named_int("total score", total);

        // The card shows the real Agent ID name, read from the registry, because the holder agreed.
        string memory json = _jsonOf(core.tokenURI(1));
        assertTrue(_contains(json, '{"trait_type":"Agent ID","value":"dopaminekr.ai"}'));
        assertTrue(_contains(json, '{"trait_type":"Tier","value":"ROOKIE"}'));
        string memory svg = _svgOf(json);
        assertTrue(_contains(svg, ">dopaminekr.ai</text>"));
        assertTrue(_contains(svg, 'dopaminekr<tspan fill="#'));
        assertEq(scorer.MAX_LAG(), 30 minutes);

        // Opting out removes the name from the metadata and from the picture.
        vm.prank(HOLDER);
        core.setShowName(false);
        json = _jsonOf(core.tokenURI(1));
        assertFalse(_contains(json, "dopaminekr"));
        assertFalse(_contains(_svgOf(json), "dopaminekr"));
        assertTrue(_contains(_svgOf(json), ">AGENT #0001</text>"));
    }
}
