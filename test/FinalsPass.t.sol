// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FinalsPass} from "../src/FinalsPass.sol";

contract PassBal {
    mapping(address => uint256) public balanceOf;

    function set(address a, uint256 n) external {
        balanceOf[a] = n;
    }
}

contract PassBalReverts {
    function balanceOf(address) external pure returns (uint256) {
        revert("no");
    }
}

contract FinalsPassTest is Test {
    PassBal registry;
    PassBal card;
    PassBal[] others;
    FinalsPass pass;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 constant OPEN = 1_795_694_400; // 26 Nov 2026 12:00 UTC
    uint256 constant CLOSE = 1_796_716_800; // 8 Dec 2026 08:00 UTC

    function _league() internal view returns (address[] memory l) {
        l = new address[](others.length + 1);
        l[0] = address(card);
        for (uint256 i = 0; i < others.length; i++) {
            l[i + 1] = address(others[i]);
        }
    }

    function setUp() public {
        vm.warp(OPEN + 10);
        registry = new PassBal();
        card = new PassBal();
        for (uint256 i = 0; i < 10; i++) {
            others.push(new PassBal());
        }
        pass = new FinalsPass(address(registry), address(card), _league());
        registry.set(alice, 1);
        card.set(alice, 1);
    }

    // ------------------------------------------------------------ mint

    function test_mintsOnePassWithItsNumber() public {
        vm.prank(alice);
        pass.mint();
        assertEq(pass.totalSupply(), 1);
        assertEq(pass.passOf(alice), 1);
        assertEq(pass.ownerOf(1), alice);
        assertEq(pass.balanceOf(alice), 1);
        assertTrue(pass.hasMinted(alice));
        assertTrue(pass.locked(1));
    }

    function test_secondMintReverts() public {
        vm.startPrank(alice);
        pass.mint();
        vm.expectRevert(FinalsPass.AlreadyMinted.selector);
        pass.mint();
        vm.stopPrank();
    }

    function test_needsAgentId() public {
        card.set(bob, 1);
        vm.prank(bob);
        vm.expectRevert(FinalsPass.NotAgentIdHolder.selector);
        pass.mint();
    }

    function test_needsTheCardFirst() public {
        registry.set(bob, 1);
        vm.prank(bob);
        vm.expectRevert(FinalsPass.MintCardFirst.selector);
        pass.mint();
        assertEq(pass.missing(bob), 2);
        card.set(bob, 1);
        assertEq(pass.missing(bob), 0);
        vm.prank(bob);
        pass.mint();
        assertEq(pass.passOf(bob), 1);
    }

    function test_notBeforeOpening() public {
        vm.warp(OPEN - 1);
        vm.prank(alice);
        vm.expectRevert(FinalsPass.NotOpenYet.selector);
        pass.mint();
        assertEq(pass.missing(alice), 4);
        vm.warp(OPEN);
        vm.prank(alice);
        pass.mint();
    }

    function test_notAfterClosing() public {
        vm.warp(CLOSE - 1);
        vm.prank(alice);
        pass.mint();
        registry.set(bob, 1);
        card.set(bob, 1);
        vm.warp(CLOSE);
        vm.prank(bob);
        vm.expectRevert(FinalsPass.Closed.selector);
        pass.mint();
        assertEq(pass.missing(bob), 5);
    }

    function test_capIsEnforced() public {
        // Fill the supply by writing the counter, then check the next mint is refused.
        vm.store(address(pass), bytes32(uint256(0)), bytes32(uint256(5000)));
        assertEq(pass.totalSupply(), 5000);
        vm.prank(alice);
        vm.expectRevert(FinalsPass.SoldOut.selector);
        pass.mint();
        assertEq(pass.missing(alice), 6);
    }

    function test_lastPassIsNumber5000() public {
        vm.store(address(pass), bytes32(uint256(0)), bytes32(uint256(4999)));
        vm.prank(alice);
        pass.mint();
        assertEq(pass.passOf(alice), 5000);
        assertEq(pass.totalSupply(), pass.MAX_SUPPLY());
    }

    function test_noValueAccepted() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(pass).call{value: 1}(abi.encodeWithSignature("mint()"));
        assertFalse(ok);
        (ok,) = address(pass).call{value: 1}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------ todo and missing

    function test_todoBeforeOpening() public {
        vm.warp(OPEN - 3600);
        (bool canMint, uint8 code, uint256 left, uint256 toOpen, uint256 toClose) = pass.todo(alice);
        assertFalse(canMint);
        assertEq(code, 4);
        assertEq(left, 5000);
        assertEq(toOpen, 3600);
        assertEq(toClose, CLOSE - OPEN + 3600);
    }

    function test_todoWhenOpenAndAfterMint() public {
        (bool canMint, uint8 code, uint256 left, uint256 toOpen,) = pass.todo(alice);
        assertTrue(canMint);
        assertEq(code, 0);
        assertEq(toOpen, 0);
        vm.prank(alice);
        pass.mint();
        (canMint, code, left,,) = pass.todo(alice);
        assertFalse(canMint);
        assertEq(code, 3);
        assertEq(left, 4999);
    }

    function test_missingCodes() public {
        assertEq(pass.missing(bob), 1);
        registry.set(bob, 1);
        assertEq(pass.missing(bob), 2);
        assertEq(pass.missing(address(0)), 1);
    }

    function testFuzz_missingZeroMeansMintSucceeds(bool hasId, bool hasCard, uint32 dt) public {
        address who = address(0xC0FFEE);
        registry.set(who, hasId ? 1 : 0);
        card.set(who, hasCard ? 1 : 0);
        vm.warp(OPEN - 1000 + (uint256(dt) % (CLOSE - OPEN + 2000)));
        uint8 code = pass.missing(who);
        vm.prank(who);
        if (code == 0) {
            pass.mint();
            assertEq(pass.passOf(who), 1);
        } else {
            vm.expectRevert();
            pass.mint();
        }
    }

    // ------------------------------------------------------------ tier

    function test_tierFollowsContractsUsed() public {
        vm.prank(alice);
        pass.mint();
        assertEq(pass.contractsUsed(alice), 1);
        assertEq(pass.tierOf(alice), 1);
        for (uint256 i = 0; i < 3; i++) {
            others[i].set(alice, 1);
        }
        assertEq(pass.contractsUsed(alice), 4);
        assertEq(pass.tierOf(alice), 2);
        for (uint256 i = 3; i < 7; i++) {
            others[i].set(alice, 2);
        }
        assertEq(pass.contractsUsed(alice), 8);
        assertEq(pass.tierOf(alice), 3);
        assertEq(pass.contractsUsed(address(0)), 0);
    }

    function test_tokenURIShowsNumberAndTier() public {
        vm.prank(alice);
        pass.mint();
        string memory uri = pass.tokenURI(1);
        assertEq(bytes(uri).length > 200, true);
        bytes memory prefix = bytes("data:application/json;base64,");
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(bytes(uri)[i], prefix[i]);
        }
        vm.expectRevert(FinalsPass.NonexistentToken.selector);
        pass.tokenURI(2);
    }

    // ------------------------------------------------------------ soulbound and getters

    function test_cannotMoveOrApprove() public {
        vm.startPrank(alice);
        pass.mint();
        vm.expectRevert(FinalsPass.NonTransferable.selector);
        pass.transferFrom(alice, bob, 1);
        vm.expectRevert(FinalsPass.NonTransferable.selector);
        pass.safeTransferFrom(alice, bob, 1);
        vm.expectRevert(FinalsPass.NonTransferable.selector);
        pass.safeTransferFrom(alice, bob, 1, "");
        vm.expectRevert(FinalsPass.NonTransferable.selector);
        pass.approve(bob, 1);
        vm.expectRevert(FinalsPass.NonTransferable.selector);
        pass.setApprovalForAll(bob, true);
        vm.stopPrank();
        assertEq(pass.getApproved(1), address(0));
        assertFalse(pass.isApprovedForAll(alice, bob));
    }

    function test_mintToolGetters() public view {
        assertEq(pass.owner(), address(0));
        assertEq(pass.price(), 0);
        assertEq(pass.mintPrice(), 0);
        assertEq(pass.maxSupply(), 5000);
        assertEq(pass.totalMinted(), 0);
        assertEq(pass.leagueSize(), 11);
        assertEq(pass.leagueAt(0), address(card));
        assertTrue(pass.supportsInterface(0x80ac58cd));
        assertTrue(pass.supportsInterface(0xb45a3c0e));
        assertFalse(pass.supportsInterface(0xffffffff));
        assertEq(pass.OPENS_AT(), OPEN);
        assertEq(pass.CLOSES_AT(), CLOSE);
    }

    function test_balanceOfZeroAddressReverts() public {
        vm.expectRevert(FinalsPass.ZeroAddress.selector);
        pass.balanceOf(address(0));
    }

    // ------------------------------------------------------------ constructor

    function test_constructorRejectsBadInput() public {
        address[] memory l = _league();
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(0xdead), address(card), l);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), address(0xdead), l);

        // the card must be in the list
        address[] memory noCard = new address[](1);
        noCard[0] = address(others[0]);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), address(card), noCard);

        // no duplicates
        address[] memory dup = new address[](3);
        dup[0] = address(card);
        dup[1] = address(others[0]);
        dup[2] = address(others[0]);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), address(card), dup);

        // an empty list and an address without code
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), address(card), new address[](0));
        address[] memory noCode = new address[](2);
        noCode[0] = address(card);
        noCode[1] = address(0xbeef);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), address(card), noCode);
    }

    function test_constructorRejectsATokenThatDoesNotAnswer() public {
        PassBalReverts bad = new PassBalReverts();
        address[] memory l = new address[](2);
        l[0] = address(card);
        l[1] = address(bad);
        vm.expectRevert();
        new FinalsPass(address(registry), address(card), l);
    }

    function test_aRevertingRegistryReadsAsNotHolding() public {
        // contractsUsed must never revert because of one token: a view used by tokenURI.
        vm.prank(alice);
        pass.mint();
        vm.mockCallRevert(address(others[0]), abi.encodeWithSignature("balanceOf(address)", alice), "x");
        assertEq(pass.contractsUsed(alice), 1);
        assertEq(bytes(pass.tokenURI(1)).length > 100, true);
    }
}
