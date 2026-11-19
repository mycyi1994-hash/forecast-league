// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Blitz} from "../src/Blitz.sol";
import {CardTestUtils} from "./utils/CardTestUtils.sol";

contract BlitzAgentID {
    mapping(address => uint256) public balanceOf;

    function give(address a) external {
        balanceOf[a] = 1;
    }

    function take(address a) external {
        balanceOf[a] = 0;
    }
}

/// @dev A feed with one phase and consecutive rounds 1..n, like a Chainlink aggregator.
contract BlitzFeedMock {
    uint256 public phase = 3;
    uint256[] private _at;
    int256[] private _answer;
    bool public latestReverts;

    function push(uint256 at, int256 answer) external {
        _at.push(at);
        _answer.push(answer);
    }

    function count() external view returns (uint256) {
        return _at.length;
    }

    function setLatestReverts(bool v) external {
        latestReverts = v;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!latestReverts, "down");
        uint256 n = _at.length;
        require(n != 0, "No data present");
        uint80 id = uint80((phase << 64) | n);
        return (id, _answer[n - 1], _at[n - 1], _at[n - 1], id);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(uint256(id) >> 64 == phase, "No data present");
        uint256 n = uint64(id);
        require(n != 0 && n <= _at.length, "No data present");
        return (id, _answer[n - 1], _at[n - 1], _at[n - 1], id);
    }
}

contract BlitzTest is CardTestUtils {
    BlitzAgentID aid;
    BlitzFeedMock feed;
    Blitz blitz;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0x5712);

    uint256 constant ROUND = 6 hours;
    uint256 constant T0 = 1_795_046_400; // a round boundary (multiple of 6 hours)
    uint32 constant R0 = uint32(T0 / ROUND); // the round that opens at T0

    function setUp() public {
        assertEq(T0 % ROUND, 0);
        aid = new BlitzAgentID();
        feed = new BlitzFeedMock();
        blitz = new Blitz(address(aid), address(feed));
        aid.give(alice);
        aid.give(bob);
        vm.warp(T0 + 1 hours);
    }

    /// @dev Feed updates every 60 seconds from `from` to `to`, with the price given by `priceAt`.
    function _fill(uint256 from, uint256 to, int256 base, int256 stepPerUpdate) internal {
        int256 p = base;
        for (uint256 t = from; t <= to; t += 60) {
            feed.push(t, p);
            p += stepPerUpdate;
        }
    }

    function _lock(uint32 r) internal pure returns (uint256) {
        return (uint256(r) + 1) * ROUND;
    }

    function _target(uint32 r) internal pure returns (uint256) {
        return (uint256(r) + 2) * ROUND;
    }

    // ------------------------------------------------------------------ picks

    function test_onlyAgentIdHoldersCanPick() public {
        vm.prank(stranger);
        vm.expectRevert(Blitz.NotAgentIdHolder.selector);
        blitz.up();
        vm.prank(stranger);
        vm.expectRevert(Blitz.NotAgentIdHolder.selector);
        blitz.down();
    }

    function test_onePickPerRound() public {
        vm.prank(alice);
        blitz.up();
        vm.prank(alice);
        vm.expectRevert(Blitz.AlreadyPicked.selector);
        blitz.down();
        assertEq(blitz.pickOf(alice, R0), 1);
        assertEq(blitz.totalSupply(), 1);
        assertEq(blitz.totalPlayers(), 1);
        assertEq(blitz.ownerOf(1), alice);
        assertEq(blitz.balanceOf(alice), 1);

        vm.warp(T0 + ROUND + 1);
        vm.prank(alice);
        blitz.down();
        assertEq(blitz.pickOf(alice, R0 + 1), 2);
        assertEq(blitz.totalSupply(), 2);
        assertEq(blitz.totalPlayers(), 1);
        assertEq(blitz.balanceOf(alice), 2);
        assertEq(blitz.tokenOfOwnerByIndex(alice, 1), 2);
    }

    function test_todo() public {
        (uint32 round, bool canPick, uint32 claimable, uint256 secs, uint32 minted, uint32 earlyLeft) = blitz.todo(alice);
        assertEq(round, R0);
        assertTrue(canPick);
        assertEq(claimable, 0);
        assertEq(secs, 5 hours);
        assertEq(minted, 0);
        assertEq(earlyLeft, 100);
        (, bool strangerCan,,,,) = blitz.todo(stranger);
        assertFalse(strangerCan);

        vm.prank(alice);
        blitz.up();
        (, canPick, claimable,, minted, earlyLeft) = blitz.todo(alice);
        assertFalse(canPick);
        assertEq(claimable, 0);
        assertEq(minted, 1);
        assertEq(earlyLeft, 99);

        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        (round, canPick, claimable,,,) = blitz.todo(alice);
        assertEq(round, R0 + 2);
        assertTrue(canPick);
        assertEq(claimable, 1);
    }

    // ------------------------------------------------------------------ claim

    function test_claimBeforeTheTargetTimeReverts() public {
        vm.prank(alice);
        blitz.up();
        vm.prank(alice);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();
        vm.warp(_target(R0)); // exactly at the target time is still too early
        vm.prank(alice);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();
    }

    function test_claimWithNoPicksReverts() public {
        vm.prank(bob);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();
    }

    function test_winAndLoss() public {
        vm.prank(alice);
        blitz.up();
        vm.prank(bob);
        blitz.down();
        _fill(T0, _target(R0) + 600, 60_000e8, 1e8); // rising
        vm.warp(_target(R0) + 600);

        vm.prank(alice);
        blitz.claim();
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 1);
        assertEq(p0, uint64(uint256(60_000e8 + int256((_lock(R0) - T0) / 60) * 1e8)));
        assertEq(p1, uint64(uint256(60_000e8 + int256((_target(R0) - T0) / 60) * 1e8)));

        (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 best, uint32 pending) = blitz.recordOf(alice);
        assertEq(picks, 1);
        assertEq(wins, 1);
        assertEq(losses, 0);
        assertEq(streak, 1);
        assertEq(best, 1);
        assertEq(pending, 0);

        vm.prank(bob);
        blitz.claim(); // the round is already settled
        (, wins, losses, streak,,) = blitz.recordOf(bob);
        assertEq(wins, 0);
        assertEq(losses, 1);
        assertEq(streak, 0);

        vm.prank(alice);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();
    }

    function test_pushChangesNothing() public {
        vm.prank(alice);
        blitz.up();
        _fill(T0, _target(R0) + 600, 60_000e8, 0); // flat
        vm.warp(_target(R0) + 600);
        vm.prank(alice);
        blitz.claim();
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 3);
        (uint32 picks, uint32 wins, uint32 losses, uint32 streak,, uint32 pending) = blitz.recordOf(alice);
        assertEq(picks, 1);
        assertEq(wins + losses + streak + pending, 0);
    }

    function test_streakAndBestStreak() public {
        // Rising for three rounds, then falling.
        for (uint256 k = 0; k < 4; k++) {
            vm.warp(T0 + k * ROUND + 100);
            vm.prank(alice);
            blitz.up();
        }
        uint256 turn = T0 + 4 * ROUND; // the lock time of the fourth round
        _fill(T0, turn, 60_000e8, 1e8);
        _fill(turn + 60, turn + ROUND + 600, 60_000e8 + int256((turn - T0) / 60) * 1e8 - 5e8, -1e8);
        vm.warp(turn + ROUND + 600);
        vm.prank(alice);
        blitz.claim();
        (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 best, uint32 pending) = blitz.recordOf(alice);
        assertEq(picks, 4);
        assertEq(wins, 3);
        assertEq(losses, 1);
        assertEq(streak, 0);
        assertEq(best, 3);
        assertEq(pending, 0);
    }

    function test_claimStopsAtAnUnfinishedRoundAndAtTheCap() public {
        uint256 n = 14;
        for (uint256 k = 0; k < n; k++) {
            vm.warp(T0 + k * ROUND + 100);
            vm.prank(alice);
            blitz.up();
        }
        // Now is inside round R0 + 13: rounds R0 .. R0 + 11 are finished, R0 + 12 and R0 + 13 are not.
        _fill(T0, T0 + n * ROUND, 60_000e8, 1e8);
        vm.warp(T0 + (n - 1) * ROUND + 200);
        (,, uint32 claimable,,,) = blitz.todo(alice);
        assertEq(claimable, 12);
        vm.prank(alice);
        blitz.claim();
        (, uint32 wins,,,, uint32 pending) = blitz.recordOf(alice);
        assertEq(wins, 12);
        assertEq(pending, 2);
        vm.prank(alice);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();

        // Later all 14 are finished; one more claim takes the remaining two.
        _fill(T0 + n * ROUND + 60, T0 + (n + 2) * ROUND, 70_000e8, 1e8);
        vm.warp(T0 + (n + 2) * ROUND);
        vm.prank(alice);
        blitz.claim();
        (, wins,,,, pending) = blitz.recordOf(alice);
        assertEq(wins, 14);
        assertEq(pending, 0);
    }

    function test_capOfTwelvePerClaim() public {
        uint256 n = 15;
        for (uint256 k = 0; k < n; k++) {
            vm.warp(T0 + k * ROUND + 100);
            vm.prank(alice);
            blitz.up();
        }
        _fill(T0, T0 + (n + 2) * ROUND, 60_000e8, 1e8);
        vm.warp(T0 + (n + 2) * ROUND);
        vm.prank(alice);
        blitz.claim();
        (, uint32 wins,,,, uint32 pending) = blitz.recordOf(alice);
        assertEq(wins, 12);
        assertEq(pending, 3);
        vm.prank(alice);
        blitz.claim();
        (, wins,,,, pending) = blitz.recordOf(alice);
        assertEq(wins, 15);
        assertEq(pending, 0);
    }

    // ----------------------------------------------------------------- settle

    function test_settleByAnyoneOnceAndOnlyAfterTheTarget() public {
        vm.prank(alice);
        blitz.down();
        _fill(T0, _target(R0) + 600, 60_000e8, -1e8);
        vm.warp(_target(R0));
        vm.expectRevert(Blitz.TooEarly.selector);
        blitz.settle(R0);
        vm.warp(_target(R0) + 1);
        vm.prank(stranger);
        blitz.settle(R0);
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 2);
        vm.expectRevert(Blitz.AlreadySettled.selector);
        blitz.settle(R0);
        vm.prank(alice);
        blitz.claim();
        (, uint32 wins,,,,) = blitz.recordOf(alice);
        assertEq(wins, 1);
    }

    function test_usesTheLatestFeedRoundAtOrBeforeEachTime() public {
        // Updates straddle both reference times: the one just after must not be used.
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 1200, 100e8);
        feed.push(lock - 7, 111e8); // the lock price
        feed.push(lock + 5, 999e8);
        feed.push(target - 900, 500e8);
        feed.push(target, 222e8); // exactly at the target time counts
        feed.push(target + 1, 1e8);
        vm.warp(target + 100);
        blitz.settle(R0);
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(p0, 111e8);
        assertEq(p1, 222e8);
        assertEq(outcome, 1);
    }

    function test_latestRoundIsUsedWhenItIsBeforeTheTime() public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, 100e8);
        feed.push(target - 120, 90e8); // nothing newer exists
        vm.warp(target + 50);
        blitz.settle(R0);
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(p0, 100e8);
        assertEq(p1, 90e8);
        assertEq(outcome, 2);
    }

    function test_voidWhenTheFeedWasStale() public {
        vm.prank(alice);
        blitz.up();
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 31 minutes, 100e8); // too old for the lock time
        feed.push(target - 60, 120e8);
        feed.push(target + 60, 121e8);
        vm.warp(target + 100);
        vm.prank(alice);
        blitz.claim();
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);
        (uint32 picks, uint32 wins, uint32 losses,,, uint32 pending) = blitz.recordOf(alice);
        assertEq(picks, 1);
        assertEq(wins + losses + pending, 0);
    }

    function test_voidWhenTheFeedCannotBeRead() public {
        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        feed.setLatestReverts(true);
        blitz.settle(R0);
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    function test_voidWhenTheFeedHasNoRoundBeforeTheTime() public {
        uint256 target = _target(R0);
        feed.push(target + 10, 100e8);
        feed.push(target + 70, 101e8);
        vm.warp(target + 100);
        blitz.settle(R0);
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    function test_rejectsBadPrices() public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, 0);
        feed.push(target - 60, 100e8);
        vm.warp(target + 1);
        blitz.settle(R0);
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    /// @dev The on-chain search must agree with a plain scan for any update pattern and time.
    function testFuzz_searchMatchesAPlainScan(uint256 seed, uint256 lockOffset) public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        uint256 t = T0;
        uint256 n;
        uint256 lockAt;
        int256 lockPrice;
        uint256 targetAt;
        int256 targetPrice;
        lockOffset = bound(lockOffset, 0, 3);
        // Irregular updates, 20 to 1500 seconds apart, until past the target time.
        while (t <= target + 2000 && n < 2000) {
            seed = uint256(keccak256(abi.encode(seed)));
            int256 price = int256(50_000e8 + (seed % 20_000e8));
            // Sometimes land exactly on a reference time.
            uint256 at = t;
            if (lockOffset == 1 && at < lock && at + 1500 > lock) at = lock;
            if (lockOffset == 2 && at < target && at + 1500 > target) at = target;
            feed.push(at, price);
            n++;
            if (at <= lock) (lockAt, lockPrice) = (at, price);
            if (at <= target) (targetAt, targetPrice) = (at, price);
            t = at + 20 + ((seed >> 64) % 1481);
        }
        vm.warp(t + 5);
        blitz.settle(R0);
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        bool ok = lockAt != 0 && lock - lockAt <= 30 minutes && targetAt != 0 && target - targetAt <= 30 minutes;
        if (!ok) {
            assertEq(outcome, 4);
        } else {
            assertEq(p0, uint64(uint256(lockPrice)));
            assertEq(p1, uint64(uint256(targetPrice)));
            assertEq(outcome, targetPrice > lockPrice ? 1 : targetPrice < lockPrice ? 2 : 3);
        }
    }

    function test_anOldRoundStillSettlesHoweverLateItIsClaimed() public {
        // A loss cannot be turned into a void by waiting: the search covers the whole phase.
        vm.prank(alice);
        blitz.up();
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, 110e8);
        feed.push(target - 60, 100e8); // down: alice loses
        uint256 t = target + 60;
        for (uint256 i = 0; i < 20_000; i++) {
            feed.push(t, 120e8);
            t += 60;
        }
        vm.warp(t);
        vm.prank(alice);
        blitz.claim();
        (uint64 p0, uint64 p1, uint8 outcome, bool finished) = blitz.resultOf(R0);
        assertEq(p0, 110e8);
        assertEq(p1, 100e8);
        assertEq(outcome, 2);
        assertTrue(finished);
        (, uint32 wins, uint32 losses,,,) = blitz.recordOf(alice);
        assertEq(wins, 0);
        assertEq(losses, 1);
    }

    function test_voidWhenTheFeedPhaseStartedAfterTheTime() public {
        uint256 target = _target(R0);
        feed.push(target + 10, 100e8); // round 1 of the phase is already too late
        feed.push(target + 70, 101e8);
        feed.push(target + 130, 102e8);
        vm.warp(target + 200);
        blitz.settle(R0);
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);
        assertEq(p0, 0);
        assertEq(p1, 0);
    }

    function test_equalTimestampsUseTheLastRound() public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 30, 100e8);
        feed.push(lock - 30, 105e8); // same second: the later round is the latest one
        feed.push(target - 30, 105e8);
        feed.push(target + 30, 1e8);
        vm.warp(target + 100);
        blitz.settle(R0);
        (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(p0, 105e8);
        assertEq(p1, 105e8);
        assertEq(outcome, 3);
    }

    function test_negativeAndOversizeAnswersAreVoid() public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, -5);
        feed.push(target - 60, 100e8);
        vm.warp(target + 1);
        blitz.settle(R0);
        (,, uint8 outcome,) = blitz.resultOf(R0);
        assertEq(outcome, 4);

        feed.push(_lock(R0 + 1) - 60, int256(uint256(type(uint64).max)) + 1);
        feed.push(_target(R0 + 1) - 60, 100e8);
        vm.warp(_target(R0 + 1) + 1);
        blitz.settle(R0 + 1);
        (,, outcome,) = blitz.resultOf(R0 + 1);
        assertEq(outcome, 4);
    }

    function test_voidAndPushLeaveTheStreakAlone() public {
        // Win, void, push, win: the streak ends at 2.
        for (uint256 k = 0; k < 4; k++) {
            vm.warp(T0 + k * ROUND + 100);
            vm.prank(alice);
            blitz.up();
        }
        // Round R0: lock T0+6h, target T0+12h: rising.
        feed.push(T0 + ROUND - 60, 100e8);
        feed.push(T0 + 2 * ROUND - 60, 110e8); // R0 target and R0+1 lock: R0 up
        // R0+1: target T0+18h has no update within 30 minutes: void. This also voids nothing else,
        // because R0+2 locks at T0+18h too, so R0+2 is void as well; use a stale gap only there.
        feed.push(T0 + 3 * ROUND - 3600, 120e8); // stale for T0+18h
        feed.push(T0 + 4 * ROUND - 60, 120e8); // R0+2 target, R0+3 lock
        feed.push(T0 + 5 * ROUND - 60, 130e8); // R0+3 target: up
        feed.push(T0 + 5 * ROUND + 60, 131e8);
        vm.warp(T0 + 5 * ROUND + 100);
        vm.prank(alice);
        blitz.claim();
        (,, uint8 o1,) = blitz.resultOf(R0 + 1);
        (,, uint8 o2,) = blitz.resultOf(R0 + 2);
        assertEq(o1, 4);
        assertEq(o2, 4);
        (uint32 picks, uint32 wins, uint32 losses, uint32 streak, uint32 best, uint32 unclaimed) = blitz.recordOf(alice);
        assertEq(picks, 4);
        assertEq(wins, 2);
        assertEq(losses, 0);
        assertEq(streak, 2);
        assertEq(best, 2);
        assertEq(unclaimed, 0);
    }

    function test_picksAtTheBoundaryBelongToTheNewRound() public {
        vm.warp(T0 + ROUND - 1);
        vm.prank(alice);
        blitz.up();
        assertEq(blitz.pickOf(alice, R0), 1);
        vm.warp(T0 + ROUND);
        vm.prank(alice);
        blitz.down();
        assertEq(blitz.pickOf(alice, R0 + 1), 2);
    }

    // ------------------------------------------------------ tickets and mint()

    function test_mintTakesTheAssignedSide() public {
        bool side = blitz.assignedSide(alice, R0);
        vm.prank(alice);
        blitz.mint();
        assertEq(blitz.pickOf(alice, R0), side ? 1 : 2);
        vm.prank(alice);
        vm.expectRevert(Blitz.AlreadyPicked.selector);
        blitz.mint();
        vm.prank(stranger);
        vm.expectRevert(Blitz.NotAgentIdHolder.selector);
        blitz.mint();
    }

    function test_assignedSideIsNotAlwaysTheSame() public view {
        uint256 ups;
        for (uint160 i = 1; i <= 200; i++) {
            if (blitz.assignedSide(address(i), R0)) ups++;
        }
        assertGt(ups, 60);
        assertLt(ups, 140);
    }

    function test_firstHundredTicketsOfARoundAreEarly() public {
        for (uint160 i = 1; i <= 101; i++) {
            address a = address(uint160(0x1000) + i);
            aid.give(a);
            vm.prank(a);
            blitz.up();
        }
        (,,, uint32 seq100,) = blitz.ticket(100);
        (,,, uint32 seq101,) = blitz.ticket(101);
        assertEq(seq100, 100);
        assertEq(seq101, 101);
        assertEq(blitz.roundMinted(R0), 101);
        (,,,, uint32 minted, uint32 earlyLeft) = blitz.todo(alice);
        assertEq(minted, 101);
        assertEq(earlyLeft, 0);
        assertTrue(_contains(_json(100), '"trait_type":"Early","value":"Yes"'));
        assertTrue(_contains(_json(101), '"trait_type":"Early","value":"No"'));
        // The next round starts its own count.
        vm.warp(T0 + ROUND + 5);
        vm.prank(alice);
        blitz.up();
        (,,, uint32 seqNext,) = blitz.ticket(102);
        assertEq(seqNext, 1);
    }

    function test_ticketMetadataFollowsTheRound() public {
        vm.prank(alice);
        blitz.up();
        vm.prank(bob);
        blitz.down();
        (address owner, uint32 round, bool isUp, uint32 seq, uint8 status) = blitz.ticket(1);
        assertEq(owner, alice);
        assertEq(round, R0);
        assertTrue(isUp);
        assertEq(seq, 1);
        assertEq(status, 0);
        string memory live = _json(1);
        assertTrue(_contains(live, '"name":"Blitz #1"'));
        assertTrue(_contains(live, '"trait_type":"Pick","value":"UP"'));
        assertTrue(_contains(live, '"trait_type":"Result","value":"LIVE"'));

        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        (,,,, status) = blitz.ticket(1);
        assertEq(status, 1); // finished, nobody settled yet
        assertTrue(_contains(_json(1), '"value":"SETTLING"'));
        vm.prank(alice);
        blitz.claim();
        (,,,, status) = blitz.ticket(1);
        assertEq(status, 2);
        assertTrue(_contains(_json(1), '"value":"WON"'));
        (,,,, status) = blitz.ticket(2);
        assertEq(status, 3); // bob has not claimed, but the round is settled
        assertTrue(_contains(_json(2), '"value":"LOST"'));
        assertTrue(_contains(_json(2), '"trait_type":"Pick","value":"DOWN"'));
    }

    function test_ticketsCannotBeMoved() public {
        vm.prank(alice);
        blitz.up();
        assertTrue(blitz.locked(1));
        assertEq(blitz.getApproved(1), address(0));
        assertFalse(blitz.isApprovedForAll(alice, bob));
        vm.startPrank(alice);
        vm.expectRevert(Blitz.NonTransferable.selector);
        blitz.transferFrom(alice, bob, 1);
        vm.expectRevert(Blitz.NonTransferable.selector);
        blitz.safeTransferFrom(alice, bob, 1);
        vm.expectRevert(Blitz.NonTransferable.selector);
        blitz.safeTransferFrom(alice, bob, 1, "");
        vm.expectRevert(Blitz.NonTransferable.selector);
        blitz.approve(bob, 1);
        vm.expectRevert(Blitz.NonTransferable.selector);
        blitz.setApprovalForAll(bob, true);
        vm.stopPrank();
        vm.expectRevert(Blitz.NonexistentToken.selector);
        blitz.ownerOf(2);
        vm.expectRevert(Blitz.NonexistentToken.selector);
        blitz.tokenURI(2);
        vm.expectRevert(Blitz.NonexistentToken.selector);
        blitz.ticket(0);
        assertTrue(blitz.supportsInterface(0x80ac58cd));
        assertTrue(blitz.supportsInterface(0x5b5e139f));
        assertTrue(blitz.supportsInterface(0xb45a3c0e));
        assertFalse(blitz.supportsInterface(0xffffffff));
    }

    function test_anyoneCanClaimForAnAddress() public {
        // Bob lost and does not claim; a stranger writes his record for him.
        vm.prank(bob);
        blitz.down();
        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        vm.prank(stranger);
        blitz.claimFor(bob);
        (, uint32 wins, uint32 losses,,, uint32 unclaimed) = blitz.recordOf(bob);
        assertEq(wins, 0);
        assertEq(losses, 1);
        assertEq(unclaimed, 0);
        vm.prank(bob);
        vm.expectRevert(Blitz.NothingToClaim.selector);
        blitz.claim();
    }

    function test_claimWorksAfterTheAgentIdIsGone() public {
        vm.prank(alice);
        blitz.up();
        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        aid.take(alice);
        vm.prank(alice);
        blitz.claim();
        (, uint32 wins,,,,) = blitz.recordOf(alice);
        assertEq(wins, 1);
        vm.prank(alice);
        vm.expectRevert(Blitz.NotAgentIdHolder.selector);
        blitz.up();
    }

    function _json(uint256 id) internal view returns (string memory) {
        return _jsonOf(blitz.tokenURI(id));
    }

    function test_constructorRejectsAddressesWithoutCode() public {
        vm.expectRevert(Blitz.BadConstructorArgument.selector);
        new Blitz(address(0x1234), address(feed));
        vm.expectRevert(Blitz.BadConstructorArgument.selector);
        new Blitz(address(aid), address(0x1234));
    }
}
