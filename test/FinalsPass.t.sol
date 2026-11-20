// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
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

/// A contract wallet with no ERC-721 receiver hook, like a plain smart account.
contract BareWallet {
    function mintPass(FinalsPass pass) external {
        pass.mint();
    }
}

contract FinalsPassTest is Test {
    using stdStorage for StdStorage;

    PassBal registry;
    PassBal[] league;
    FinalsPass pass;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    uint256 constant OPEN = 1_795_694_400; // 26 Nov 2026 12:00 UTC
    uint256 constant CLOSE = 1_796_716_800; // 8 Dec 2026 08:00 UTC

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function _league() internal view returns (address[] memory l) {
        l = new address[](league.length);
        for (uint256 i = 0; i < league.length; i++) {
            l[i] = address(league[i]);
        }
    }

    function _setSupply(uint256 n) internal {
        stdstore.target(address(pass)).sig("totalSupply()").checked_write(n);
    }

    function setUp() public {
        vm.warp(OPEN + 10);
        registry = new PassBal();
        for (uint256 i = 0; i < 12; i++) {
            league.push(new PassBal());
        }
        pass = new FinalsPass(address(registry), _league());
        registry.set(alice, 1);
    }

    // ------------------------------------------------------------ mint

    function test_mintsOnePassWithItsNumber() public {
        vm.expectEmit(true, true, true, true);
        emit Transfer(address(0), alice, 1);
        vm.prank(alice);
        pass.mint();
        assertEq(pass.totalSupply(), 1);
        assertEq(pass.mintedPass(alice), 1);
        assertEq(pass.ownerOf(1), alice);
        assertEq(pass.balanceOf(alice), 1);
        assertTrue(pass.hasMinted(alice));
    }

    function test_mintWithQuantityOneIsTheSameCall() public {
        vm.prank(alice);
        pass.mint(1);
        assertEq(pass.ownerOf(1), alice);
        assertEq(pass.mintedPass(alice), 1);
    }

    function test_mintWithAnyOtherQuantityReverts() public {
        vm.startPrank(alice);
        vm.expectRevert(FinalsPass.OnePerWallet.selector);
        pass.mint(0);
        vm.expectRevert(FinalsPass.OnePerWallet.selector);
        pass.mint(2);
        vm.stopPrank();
        assertEq(pass.totalSupply(), 0);
    }

    function test_secondMintReverts() public {
        vm.startPrank(alice);
        pass.mint();
        vm.expectRevert(FinalsPass.AlreadyMinted.selector);
        pass.mint();
        vm.expectRevert(FinalsPass.AlreadyMinted.selector);
        pass.mint(1);
        vm.stopPrank();
    }

    function test_needsAgentId() public {
        vm.prank(bob);
        vm.expectRevert(FinalsPass.NotAgentIdHolder.selector);
        pass.mint();
        assertEq(pass.missing(bob), 1);
    }

    function test_agentIdAloneIsEnough() public {
        // No Forecast League token is needed to mint: the pass is open to every Agent ID wallet.
        registry.set(bob, 1);
        assertEq(pass.contractsUsed(bob), 0);
        assertEq(pass.missing(bob), 0);
        vm.prank(bob);
        pass.mint();
        assertEq(pass.ownerOf(1), bob);
    }

    function test_aContractWalletWithoutReceiverHookCanMint() public {
        BareWallet w = new BareWallet();
        registry.set(address(w), 1);
        w.mintPass(pass);
        assertEq(pass.ownerOf(1), address(w));
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
        vm.warp(CLOSE);
        vm.prank(bob);
        vm.expectRevert(FinalsPass.Closed.selector);
        pass.mint();
        assertEq(pass.missing(bob), 5);
    }

    function test_capIsEnforced() public {
        _setSupply(2000);
        assertEq(pass.totalSupply(), 2000);
        vm.prank(alice);
        vm.expectRevert(FinalsPass.SoldOut.selector);
        pass.mint();
        assertEq(pass.missing(alice), 6);
    }

    function test_lastPassIsNumber2000() public {
        _setSupply(1999);
        vm.prank(alice);
        pass.mint();
        assertEq(pass.mintedPass(alice), 2000);
        assertEq(pass.ownerOf(2000), alice);
        assertEq(pass.totalSupply(), pass.MAX_SUPPLY());
        registry.set(bob, 1);
        vm.prank(bob);
        vm.expectRevert(FinalsPass.SoldOut.selector);
        pass.mint();
    }

    function test_noValueAccepted() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        (bool ok,) = address(pass).call{value: 1}(abi.encodeWithSignature("mint()"));
        assertFalse(ok);
        (ok,) = address(pass).call{value: 1}(abi.encodeWithSignature("mint(uint256)", 1));
        assertFalse(ok);
        (ok,) = address(pass).call{value: 1}("");
        assertFalse(ok);
        vm.stopPrank();
        assertEq(address(pass).balance, 0);
    }

    // ------------------------------------------------------------ todo and missing

    function test_todoBeforeOpening() public {
        vm.warp(OPEN - 3600);
        (bool canMint, uint8 code, uint256 left, uint256 toOpen, uint256 toClose) = pass.todo(alice);
        assertFalse(canMint);
        assertEq(code, 4);
        assertEq(left, 2000);
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
        assertEq(left, 1999);
    }

    function test_missingCodes() public {
        assertEq(pass.missing(bob), 1);
        assertEq(pass.missing(address(0)), 1);
        registry.set(bob, 1);
        assertEq(pass.missing(bob), 0);
    }

    function testFuzz_missingZeroMeansMintSucceeds(bool hasId, uint32 dt, uint16 supply) public {
        address who = address(0xC0FFEE);
        registry.set(who, hasId ? 1 : 0);
        _setSupply(uint256(supply) % 2001);
        vm.warp(OPEN - 1000 + (uint256(dt) % (CLOSE - OPEN + 2000)));
        uint8 code = pass.missing(who);
        vm.prank(who);
        if (code == 0) {
            pass.mint();
            assertEq(pass.ownerOf(pass.mintedPass(who)), who);
        } else {
            vm.expectRevert();
            pass.mint();
        }
    }

    // ------------------------------------------------------------ transfers

    function test_passCanBeTransferred() public {
        vm.prank(alice);
        pass.mint();
        vm.prank(alice);
        pass.transferFrom(alice, bob, 1);
        assertEq(pass.ownerOf(1), bob);
        assertEq(pass.balanceOf(alice), 0);
        assertEq(pass.balanceOf(bob), 1);
    }

    function test_onlyHolderOrApprovedCanMoveIt() public {
        vm.prank(alice);
        pass.mint();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, bob, 1));
        pass.transferFrom(alice, bob, 1);
        vm.prank(alice);
        pass.approve(bob, 1);
        vm.prank(bob);
        pass.transferFrom(alice, carol, 1);
        assertEq(pass.ownerOf(1), carol);
    }

    function test_aWalletMintsOnceEvenAfterSendingItsPassAway() public {
        vm.startPrank(alice);
        pass.mint();
        pass.transferFrom(alice, bob, 1);
        assertEq(pass.mintedPass(alice), 1);
        assertTrue(pass.hasMinted(alice));
        assertEq(pass.missing(alice), 3);
        vm.expectRevert(FinalsPass.AlreadyMinted.selector);
        pass.mint();
        vm.stopPrank();
    }

    function test_receivingAPassDoesNotUseUpTheMint() public {
        registry.set(bob, 1);
        vm.prank(alice);
        pass.mint();
        vm.prank(alice);
        pass.transferFrom(alice, bob, 1);
        assertFalse(pass.hasMinted(bob));
        vm.prank(bob);
        pass.mint();
        assertEq(pass.balanceOf(bob), 2);
        assertEq(pass.mintedPass(bob), 2);
    }

    // ------------------------------------------------------------ tier

    function test_tierFollowsContractsUsed() public {
        vm.prank(alice);
        pass.mint();
        assertEq(pass.contractsUsed(alice), 0);
        assertEq(pass.tierOf(alice), 1);
        for (uint256 i = 0; i < 4; i++) {
            league[i].set(alice, 1);
        }
        assertEq(pass.contractsUsed(alice), 4);
        assertEq(pass.tierOf(alice), 2);
        for (uint256 i = 4; i < 8; i++) {
            league[i].set(alice, 2);
        }
        assertEq(pass.contractsUsed(alice), 8);
        assertEq(pass.tierOf(alice), 3);
        assertEq(pass.contractsUsed(address(0)), 0);
    }

    function test_tierFollowsThePassToItsNewHolder() public {
        for (uint256 i = 0; i < 8; i++) {
            league[i].set(alice, 1);
        }
        vm.prank(alice);
        pass.mint();
        string memory gold = pass.tokenURI(1);
        vm.prank(alice);
        pass.transferFrom(alice, bob, 1);
        string memory bronze = pass.tokenURI(1);
        assertTrue(keccak256(bytes(gold)) != keccak256(bytes(bronze)));
        assertEq(pass.tierOf(bob), 1);
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
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        pass.tokenURI(2);
    }

    function test_contractURIIsOnChainJson() public view {
        bytes memory uri = bytes(pass.contractURI());
        bytes memory prefix = bytes("data:application/json;base64,");
        assertGt(uri.length, 200);
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(uri[i], prefix[i]);
        }
    }

    // ------------------------------------------------------------ getters

    function test_mintToolGetters() public view {
        assertEq(pass.owner(), address(0));
        assertEq(pass.price(), 0);
        assertEq(pass.mintPrice(), 0);
        assertEq(pass.maxSupply(), 2000);
        assertEq(pass.MAX_SUPPLY(), 2000);
        assertEq(pass.MAX_PER_WALLET(), 1);
        assertEq(pass.totalMinted(), 0);
        assertEq(pass.leagueSize(), 12);
        assertEq(pass.leagueAt(0), address(league[0]));
        assertEq(pass.name(), "Forecast League Finals Pass");
        assertEq(pass.symbol(), "FLPASS");
        assertTrue(pass.supportsInterface(0x01ffc9a7));
        assertTrue(pass.supportsInterface(0x80ac58cd));
        assertTrue(pass.supportsInterface(0x5b5e139f));
        assertFalse(pass.supportsInterface(0xb45a3c0e)); // not ERC-5192: the pass is not locked
        assertFalse(pass.supportsInterface(0xffffffff));
        assertEq(pass.OPENS_AT(), OPEN);
        assertEq(pass.CLOSES_AT(), CLOSE);
    }

    function test_selectorsMintToolsUse() public pure {
        assertEq(bytes4(keccak256("mint()")), bytes4(0x1249c58b));
        assertEq(bytes4(keccak256("mint(uint256)")), bytes4(0xa0712d68));
    }

    // ------------------------------------------------------------ constructor

    function test_constructorRejectsBadInput() public {
        address[] memory l = _league();
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(0xdead), l);

        // no duplicates
        address[] memory dup = new address[](3);
        dup[0] = address(league[0]);
        dup[1] = address(league[1]);
        dup[2] = address(league[1]);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), dup);

        // an empty list, a list that is too long, and an address without code
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), new address[](0));
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), new address[](17));
        address[] memory noCode = new address[](2);
        noCode[0] = address(league[0]);
        noCode[1] = address(0xbeef);
        vm.expectRevert(FinalsPass.BadConstructorArgument.selector);
        new FinalsPass(address(registry), noCode);
    }

    function test_constructorRejectsATokenThatDoesNotAnswer() public {
        PassBalReverts bad = new PassBalReverts();
        address[] memory l = new address[](2);
        l[0] = address(league[0]);
        l[1] = address(bad);
        vm.expectRevert();
        new FinalsPass(address(registry), l);
        vm.expectRevert();
        new FinalsPass(address(bad), _league());
    }

    function test_aRevertingLeagueTokenReadsAsNotHolding() public {
        // contractsUsed must never revert because of one token: a view used by tokenURI.
        league[1].set(alice, 1);
        vm.prank(alice);
        pass.mint();
        vm.mockCallRevert(address(league[0]), abi.encodeWithSignature("balanceOf(address)", alice), "x");
        assertEq(pass.contractsUsed(alice), 1);
        assertEq(bytes(pass.tokenURI(1)).length > 100, true);
    }
}
