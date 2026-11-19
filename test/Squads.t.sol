// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Squads} from "../src/Squads.sol";

contract MockRegistry {
    mapping(address => uint256) public balanceOf;
    mapping(address => string) private _handle;
    mapping(bytes32 => address) private _owner;

    function give(address a, string memory h) external {
        balanceOf[a] = 1;
        _handle[a] = h;
        _owner[keccak256(bytes(h))] = a;
    }

    function handleOf(address a) external view returns (string memory) {
        return _handle[a];
    }

    function ownerOfHandle(string calldata h) external view returns (address) {
        return _owner[keccak256(bytes(h))];
    }
}

contract SquadsTest is Test {
    MockRegistry reg;
    Squads squads;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address dave = address(0xDA7E);
    address mallory = address(0xBAD);

    uint256 constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        reg = new MockRegistry();
        squads = new Squads(address(reg));
        reg.give(alice, "alice");
        reg.give(bob, "bob");
        reg.give(carol, "carol");
        reg.give(dave, "dave");
    }

    function test_constructorNeedsAContract() public {
        vm.expectRevert(Squads.BadConstructorArgument.selector);
        new Squads(address(0x1234));
    }

    function test_onlyHoldersCanCreateOrJoin() public {
        vm.startPrank(mallory);
        vm.expectRevert(Squads.NotAgentIdHolder.selector);
        squads.createSquad();
        vm.expectRevert(Squads.NotAgentIdHolder.selector);
        squads.joinSquad("alice");
        vm.stopPrank();
    }

    function test_createSquad_captainIsItsFirstMember() public {
        vm.expectEmit(true, false, false, true, address(squads));
        emit Squads.SquadCreated(alice);
        vm.expectEmit(true, true, true, true, address(squads));
        emit Squads.SquadJoined(alice, alice, address(0));
        vm.prank(alice);
        squads.createSquad();

        assertTrue(squads.isSquad(alice));
        assertEq(squads.totalSquads(), 1);
        assertEq(squads.memberCount(alice), 1);
        (address captain, uint40 since) = squads.squadOf(alice);
        assertEq(captain, alice);
        assertEq(since, T0);
        assertEq(squads.squadName(alice), "alice");
        assertEq(squads.squadName(bob), "");

        vm.prank(alice);
        vm.expectRevert(Squads.AlreadyCaptain.selector);
        squads.createSquad();
    }

    function test_joinByCaptainName() public {
        vm.prank(alice);
        squads.createSquad();

        vm.expectEmit(true, true, true, true, address(squads));
        emit Squads.SquadJoined(bob, alice, address(0));
        vm.prank(bob);
        squads.joinSquad("alice");

        (address captain,) = squads.squadOf(bob);
        assertEq(captain, alice);
        assertEq(squads.memberCount(alice), 2);

        vm.prank(bob);
        vm.expectRevert(Squads.AlreadyInThisSquad.selector);
        squads.joinSquad("alice");
    }

    function test_unknownNamesAreRejected() public {
        vm.prank(alice);
        squads.createSquad();

        vm.startPrank(carol);
        vm.expectRevert(Squads.UnknownSquad.selector); // nobody owns this name
        squads.joinSquad("nobody");
        vm.expectRevert(Squads.UnknownSquad.selector); // a holder who never opened a squad
        squads.joinSquad("bob");
        vm.expectRevert(Squads.UnknownSquad.selector); // the registry only knows the bare lowercase name
        squads.joinSquad("alice.ai");
        vm.expectRevert(Squads.UnknownSquad.selector);
        squads.joinSquad("");
        vm.stopPrank();
    }

    function test_captainCannotJoinAnotherSquad() public {
        vm.prank(alice);
        squads.createSquad();
        vm.prank(bob);
        squads.createSquad();

        vm.prank(alice);
        vm.expectRevert(Squads.AlreadyCaptain.selector);
        squads.joinSquad("bob");
    }

    function test_switchingNeedsTheCooldown() public {
        vm.prank(alice);
        squads.createSquad();
        vm.prank(bob);
        squads.createSquad();
        vm.prank(carol);
        squads.joinSquad("alice");

        vm.warp(T0 + 7 days - 1);
        vm.prank(carol);
        vm.expectRevert(Squads.CooldownNotOver.selector);
        squads.joinSquad("bob");

        vm.warp(T0 + 7 days);
        vm.expectEmit(true, true, true, true, address(squads));
        emit Squads.SquadJoined(carol, bob, alice);
        vm.prank(carol);
        squads.joinSquad("bob");

        assertEq(squads.memberCount(alice), 1);
        assertEq(squads.memberCount(bob), 2);
        (address captain, uint40 since) = squads.squadOf(carol);
        assertEq(captain, bob);
        assertEq(since, T0 + 7 days);
    }

    function test_memberCanOpenOwnSquadAfterCooldown() public {
        vm.prank(alice);
        squads.createSquad();
        vm.prank(dave);
        squads.joinSquad("alice");

        vm.prank(dave);
        vm.expectRevert(Squads.CooldownNotOver.selector);
        squads.createSquad();
        assertFalse(squads.isSquad(dave)); // the failed attempt left nothing behind
        assertEq(squads.totalSquads(), 1);

        vm.warp(T0 + 7 days);
        vm.prank(dave);
        squads.createSquad();
        assertTrue(squads.isSquad(dave));
        assertEq(squads.memberCount(alice), 1);
        assertEq(squads.memberCount(dave), 1);
        assertEq(squads.totalSquads(), 2);
    }
}
