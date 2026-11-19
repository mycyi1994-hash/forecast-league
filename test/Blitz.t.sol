// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Blitz} from "../src/Blitz.sol";

contract BlitzAgentID {
    mapping(address => uint256) public balanceOf;

    function give(address a) external {
        balanceOf[a] = 1;
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

contract BlitzTest is Test {
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
        assertEq(blitz.totalPicks(), 1);
        assertEq(blitz.totalPlayers(), 1);

        vm.warp(T0 + ROUND + 1);
        vm.prank(alice);
        blitz.down();
        assertEq(blitz.pickOf(alice, R0 + 1), 2);
        assertEq(blitz.totalPicks(), 2);
        assertEq(blitz.totalPlayers(), 1);
    }

    function test_todo() public {
        (uint32 round, bool canPick, uint32 claimable, uint256 secs) = blitz.todo(alice);
        assertEq(round, R0);
        assertTrue(canPick);
        assertEq(claimable, 0);
        assertEq(secs, 5 hours);
        (, bool strangerCan,,) = blitz.todo(stranger);
        assertFalse(strangerCan);

        vm.prank(alice);
        blitz.up();
        (, canPick, claimable,) = blitz.todo(alice);
        assertFalse(canPick);
        assertEq(claimable, 0);

        _fill(T0, _target(R0) + 600, 60_000e8, 1e8);
        vm.warp(_target(R0) + 600);
        (round, canPick, claimable,) = blitz.todo(alice);
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
        (uint64 p0, uint64 p1, uint8 outcome) = blitz.resultOf(R0);
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
        (,, uint8 outcome) = blitz.resultOf(R0);
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
        (,, uint32 claimable,) = blitz.todo(alice);
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
        (,, uint8 outcome) = blitz.resultOf(R0);
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
        (uint64 p0, uint64 p1, uint8 outcome) = blitz.resultOf(R0);
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
        (uint64 p0, uint64 p1, uint8 outcome) = blitz.resultOf(R0);
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
        (,, uint8 outcome) = blitz.resultOf(R0);
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
        (,, uint8 outcome) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    function test_voidWhenTheFeedHasNoRoundBeforeTheTime() public {
        uint256 target = _target(R0);
        feed.push(target + 10, 100e8);
        feed.push(target + 70, 101e8);
        vm.warp(target + 100);
        blitz.settle(R0);
        (,, uint8 outcome) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    function test_rejectsBadPrices() public {
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, 0);
        feed.push(target - 60, 100e8);
        vm.warp(target + 1);
        blitz.settle(R0);
        (,, uint8 outcome) = blitz.resultOf(R0);
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
        (uint64 p0, uint64 p1, uint8 outcome) = blitz.resultOf(R0);
        bool ok = lockAt != 0 && lock - lockAt <= 30 minutes && targetAt != 0 && target - targetAt <= 30 minutes;
        if (!ok) {
            assertEq(outcome, 4);
        } else {
            assertEq(p0, uint64(uint256(lockPrice)));
            assertEq(p1, uint64(uint256(targetPrice)));
            assertEq(outcome, targetPrice > lockPrice ? 1 : targetPrice < lockPrice ? 2 : 3);
        }
    }

    function test_voidOutsideTheSearchWindow() public {
        // 16,500 updates after the target time push its feed round out of the window.
        uint256 lock = _lock(R0);
        uint256 target = _target(R0);
        feed.push(lock - 60, 100e8);
        feed.push(target - 60, 110e8);
        uint256 t = target + 60;
        for (uint256 i = 0; i < 16_500; i++) {
            feed.push(t, 120e8);
            t += 60;
        }
        vm.warp(t);
        blitz.settle(R0);
        (,, uint8 outcome) = blitz.resultOf(R0);
        assertEq(outcome, 4);
    }

    function test_constructorRejectsAddressesWithoutCode() public {
        vm.expectRevert(Blitz.BadConstructorArgument.selector);
        new Blitz(address(0x1234), address(feed));
        vm.expectRevert(Blitz.BadConstructorArgument.selector);
        new Blitz(address(aid), address(0x1234));
    }
}
