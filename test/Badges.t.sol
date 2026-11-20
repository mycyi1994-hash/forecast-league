// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Badges} from "../src/Badges.sol";

contract MockCount {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 n) external {
        balanceOf[a] = n;
    }
}

contract BadgesTest is Test {
    MockCount registry;
    MockCount m0;
    MockCount m1;
    Badges badges;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        registry = new MockCount();
        m0 = new MockCount();
        m1 = new MockCount();
        badges = new Badges(address(registry), address(m0), address(m1), address(0));
        registry.set(alice, 1);
    }

    function test_noBadgeBelowThreeTickets() public {
        m0.set(alice, 2);
        vm.prank(alice);
        vm.expectRevert(Badges.NothingToClaim.selector);
        badges.claim();
        (uint32 tickets, uint8 held, bool canClaim, uint8 next, uint32 needed) = badges.todo(alice);
        assertEq(tickets, 2);
        assertEq(held, 0);
        assertFalse(canClaim);
        assertEq(next, 1);
        assertEq(needed, 1);
        assertTrue(badges.hasMinted(alice));
    }

    function test_ticketsAreCountedOverTheMarkets() public {
        m0.set(alice, 2);
        m1.set(alice, 1);
        assertEq(badges.ticketsOf(alice), 3);
        assertFalse(badges.hasMinted(alice));
        vm.prank(alice);
        badges.mint();
        assertEq(badges.tierOf(alice), 1);
        assertEq(badges.balanceOf(alice), 1);
        assertEq(badges.ownerOf(1), alice);
        (address holder, uint8 tier, uint32 tickets) = badges.badge(1);
        assertEq(holder, alice);
        assertEq(tier, 1);
        assertEq(tickets, 3);
    }

    function test_oneBadgePerTierInOrder() public {
        m0.set(alice, 35);
        vm.startPrank(alice);
        badges.claim();
        badges.claim();
        badges.claim();
        vm.expectRevert(Badges.NothingToClaim.selector);
        badges.claim();
        vm.stopPrank();
        assertEq(badges.tierOf(alice), 3);
        assertEq(badges.balanceOf(alice), 3);
        assertEq(badges.totalSupply(), 3);
        (,, bool canClaim, uint8 next,) = badges.todo(alice);
        assertFalse(canClaim);
        assertEq(next, 0);
        assertTrue(badges.hasMinted(alice));
    }

    function test_secondBadgeNeedsTenTickets() public {
        m0.set(alice, 9);
        vm.startPrank(alice);
        badges.claim();
        vm.expectRevert(Badges.NothingToClaim.selector);
        badges.claim();
        vm.stopPrank();
        m1.set(alice, 1);
        vm.prank(alice);
        badges.claim();
        assertEq(badges.tierOf(alice), 2);
    }

    function test_needsAnAgentId() public {
        m0.set(bob, 5);
        vm.prank(bob);
        vm.expectRevert(Badges.NotAgentIdHolder.selector);
        badges.claim();
        (,, bool canClaim,,) = badges.todo(bob);
        assertFalse(canClaim);
    }

    function test_cannotBeMoved() public {
        m0.set(alice, 3);
        vm.startPrank(alice);
        badges.claim();
        vm.expectRevert(Badges.NonTransferable.selector);
        badges.transferFrom(alice, bob, 1);
        vm.expectRevert(Badges.NonTransferable.selector);
        badges.approve(bob, 1);
        vm.expectRevert(Badges.NonTransferable.selector);
        badges.setApprovalForAll(bob, true);
        vm.stopPrank();
        assertTrue(badges.locked(1));
    }

    function test_commonReadsAndMetadata() public {
        assertEq(badges.owner(), address(0));
        assertEq(badges.price(), 0);
        assertEq(badges.mintPrice(), 0);
        assertEq(badges.maxSupply(), type(uint256).max);
        m0.set(alice, 3);
        vm.prank(alice);
        badges.claim();
        assertEq(badges.totalMinted(), 1);
        string memory uri = badges.tokenURI(1);
        assertEq(bytes(uri).length > 200, true);
        vm.expectRevert(Badges.NonexistentToken.selector);
        badges.tokenURI(2);
        assertTrue(badges.supportsInterface(0x80ac58cd));
    }

    function test_rejectsTheSameMarketTwiceAndAddressesWithoutBalanceOf() public {
        vm.expectRevert(Badges.BadConstructorArgument.selector);
        new Badges(address(registry), address(m0), address(m0), address(0));
        vm.expectRevert(Badges.BadConstructorArgument.selector);
        new Badges(address(registry), address(m0), address(m1), address(m1));
        vm.expectRevert();
        new Badges(address(registry), address(this), address(0), address(0));
    }

    function test_hasMintedIsTrueWithoutAnAgentId() public {
        m0.set(bob, 5);
        assertTrue(badges.hasMinted(bob));
    }

    function test_rejectsBadConstructorArguments() public {
        vm.expectRevert(Badges.BadConstructorArgument.selector);
        new Badges(address(0x1234), address(m0), address(0), address(0));
        vm.expectRevert(Badges.BadConstructorArgument.selector);
        new Badges(address(registry), address(m0), address(0x1234), address(0));
    }
}
