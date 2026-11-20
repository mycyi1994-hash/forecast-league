// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Soulbound} from "../src/Soulbound.sol";
import {Stamps} from "../src/Stamps.sol";
import {Houses} from "../src/Houses.sol";
import {Honors} from "../src/Honors.sol";

contract MockBal {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 n) external {
        balanceOf[a] = n;
    }
}

contract MockMarket {
    mapping(address => uint32) public winsOf;
    mapping(address => uint32) public lossesOf;
    mapping(address => uint32) public bestOf;

    function set(address a, uint32 w, uint32 l, uint32 b) external {
        winsOf[a] = w;
        lossesOf[a] = l;
        bestOf[a] = b;
    }

    function recordOf(address a) external view returns (uint32, uint32, uint32, uint32, uint32, uint32) {
        return (winsOf[a] + lossesOf[a], winsOf[a], lossesOf[a], 0, bestOf[a], 0);
    }
}

contract ExtrasTest is Test {
    MockBal registry;
    MockBal card;
    MockMarket m0;
    MockMarket m1;
    Stamps stamps;
    Houses houses;
    Honors honors;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 constant T0 = 1_795_132_800; // 20 Nov 2026 00:00 UTC

    function setUp() public {
        vm.warp(T0 + 100);
        registry = new MockBal();
        card = new MockBal();
        m0 = new MockMarket();
        m1 = new MockMarket();
        stamps = new Stamps(address(registry));
        houses = new Houses(address(registry), address(m0), address(m1), address(0));
        honors = new Honors(address(registry), address(card), address(m0), address(m1), address(0));
        registry.set(alice, 1);
    }

    // ------------------------------------------------------------ stamps

    function test_oneStampADayAndAStreak() public {
        vm.startPrank(alice);
        stamps.checkIn();
        vm.expectRevert(Stamps.AlreadyStamped.selector);
        stamps.mint();
        vm.warp(T0 + 1 days + 5);
        stamps.mint();
        vm.warp(T0 + 2 days + 5);
        stamps.claim();
        vm.stopPrank();
        (uint32 n, uint32 streak, uint32 best,) = stamps.recordOf(alice);
        assertEq(n, 3);
        assertEq(streak, 3);
        assertEq(best, 3);
        (, uint32 day, uint32 s) = stamps.stamp(3);
        assertEq(day, uint32((T0 + 2 days) / 1 days));
        assertEq(s, 3);
        assertEq(stamps.balanceOf(alice), 3);
        assertTrue(stamps.hasMinted(alice));
    }

    function test_aMissedDayResetsTheStreak() public {
        vm.prank(alice);
        stamps.checkIn();
        vm.warp(T0 + 2 days + 5);
        (uint32 n, uint32 streak, uint32 best,) = stamps.recordOf(alice);
        assertEq(n, 1);
        assertEq(streak, 0);
        assertEq(best, 1);
        (, bool canMint, uint32 next,,) = stamps.todo(alice);
        assertTrue(canMint);
        assertEq(next, 1);
        vm.prank(alice);
        stamps.checkIn();
        (, streak, best,) = stamps.recordOf(alice);
        assertEq(streak, 1);
        assertEq(best, 1);
    }

    function test_stampsNeedAnAgentIdAndCannotMove() public {
        vm.prank(bob);
        vm.expectRevert(Soulbound.NotAgentIdHolder.selector);
        stamps.checkIn();
        (, bool canMint,,,) = stamps.todo(bob);
        assertFalse(canMint);
        vm.startPrank(alice);
        stamps.checkIn();
        vm.expectRevert(Soulbound.NonTransferable.selector);
        stamps.transferFrom(alice, bob, 1);
        vm.stopPrank();
        assertTrue(bytes(stamps.tokenURI(1)).length > 200);
        assertEq(stamps.owner(), address(0));
        assertEq(stamps.price(), 0);
    }

    function test_todoOfStamps() public {
        (uint32 day, bool canMint, uint32 streak, uint256 left, uint32 minted) = stamps.todo(alice);
        assertEq(day, uint32(T0 / 1 days));
        assertTrue(canMint);
        assertEq(streak, 1);
        assertEq(left, 1 days - 100);
        assertEq(minted, 0);
        vm.prank(alice);
        stamps.checkIn();
        (, canMint, streak,, minted) = stamps.todo(alice);
        assertFalse(canMint);
        assertEq(streak, 1);
        assertEq(minted, 1);
    }

    // ------------------------------------------------------------ houses

    function test_joinOnceIntoTheHouseOfTheAddress() public {
        uint8 h = houses.houseOf(alice);
        assertLt(h, 4);
        (uint8 house, bool canMint, uint32 size) = houses.todo(alice);
        assertEq(house, h);
        assertTrue(canMint);
        assertEq(size, 0);
        vm.startPrank(alice);
        houses.join();
        vm.expectRevert(Houses.AlreadyJoined.selector);
        houses.mint();
        vm.stopPrank();
        assertEq(houses.cardOf(alice), 1);
        assertEq(houses.members(h), 1);
        assertEq(houses.memberAt(h, 0), alice);
        assertTrue(houses.hasMinted(alice));
        assertTrue(bytes(houses.tokenURI(1)).length > 200);
    }

    function test_houseScoreAddsMembersOverMarkets() public {
        vm.prank(alice);
        houses.join();
        m0.set(alice, 3, 1, 2);
        m1.set(alice, 2, 2, 1);
        (uint32 w, uint32 l) = houses.scoreOf(alice);
        assertEq(w, 5);
        assertEq(l, 3);
        (w, l) = houses.houseScore(houses.houseOf(alice), 0, 10);
        assertEq(w, 5);
        assertEq(l, 3);
        (w, l) = houses.houseScore(houses.houseOf(alice), 1, 10);
        assertEq(w, 0);
    }

    function test_housesNeedAnAgentId() public {
        vm.prank(bob);
        vm.expectRevert(Soulbound.NotAgentIdHolder.selector);
        houses.join();
    }

    // ------------------------------------------------------------ honors

    function test_seasonHonorForAnyAgentIdHolder() public {
        (uint8 n, uint8 mask, uint8 held) = honors.todo(alice);
        assertEq(n, 1);
        assertEq(mask, 1);
        assertEq(held, 0);
        vm.startPrank(alice);
        honors.claim();
        vm.expectRevert(Soulbound.NothingToClaim.selector);
        honors.claim();
        vm.stopPrank();
        assertEq(honors.honorOf(alice, 0), 1);
        assertEq(honors.kindOf(1), 0);
        assertTrue(honors.hasMinted(alice));
    }

    function test_allEarnedHonorsInOneCall() public {
        card.set(alice, 1);
        m0.set(alice, 3, 0, 3);
        m1.set(alice, 2, 0, 2);
        (uint8 n, uint8 mask,) = honors.todo(alice);
        assertEq(n, 5); // season, card, first win, five wins, streak 3
        assertEq(mask, 1 | 2 | 4 | 8 | 16);
        vm.prank(alice);
        honors.mint();
        assertEq(honors.balanceOf(alice), 5);
        assertEq(honors.totalSupply(), 5);
        assertEq(honors.kindMinted(3), 1);
        m0.set(alice, 6, 0, 5);
        vm.prank(alice);
        honors.claim();
        assertEq(honors.balanceOf(alice), 6);
        (, , uint8 held) = honors.todo(alice);
        assertEq(held, 63);
        assertTrue(bytes(honors.tokenURI(6)).length > 200);
    }

    function test_noSeasonHonorAfterTheSeason() public {
        vm.warp(honors.SEASON_END() + 1);
        vm.prank(alice);
        vm.expectRevert(Soulbound.NothingToClaim.selector);
        honors.claim();
    }

    function test_honorsNeedAnAgentId() public {
        vm.prank(bob);
        vm.expectRevert(Soulbound.NotAgentIdHolder.selector);
        honors.claim();
        (uint8 n,,) = honors.todo(bob);
        assertEq(n, 0);
    }

    function test_rejectBadConstructorArguments() public {
        vm.expectRevert(Soulbound.BadConstructorArgument.selector);
        new Stamps(address(0x1234));
        vm.expectRevert(Soulbound.BadConstructorArgument.selector);
        new Houses(address(registry), address(m0), address(m0), address(0));
        vm.expectRevert(Soulbound.BadConstructorArgument.selector);
        new Honors(address(registry), address(card), address(m0), address(m1), address(m1));
        vm.expectRevert();
        new Houses(address(registry), address(registry), address(0), address(0));
    }
}
