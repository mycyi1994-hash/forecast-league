// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EarlyPass} from "../../src/EarlyPass.sol";

/// Fork test against BNB Chain: the real Agent ID registry and the live Forecast League contracts.
contract EarlyPassForkTest is Test {
    address constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant CARD = 0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4;
    // Agent ID wallets seen on chain: one holds the Forecast League card, one holds tickets only.
    address constant CARD_HOLDER = 0xE6FB57b0459B9Ba51cC6F46a08AcaBaAb5EE5476;
    address constant TICKET_ONLY = 0xd792F7baa1bDDfaBA0A51A4dE0E6f35Cf7275780;
    EarlyPass pass;

    function _league() internal pure returns (address[] memory l) {
        l = new address[](12);
        l[0] = CARD;
        l[1] = 0x2fadB6739A076b236fbd44e19f64ab158ccFBa2C;
        l[2] = 0x621B9fEd6FF2f0FC73e26264A401F7d12644A0A1;
        l[3] = 0xA782Ac207fE33f6120d9c2EF9553A55C47CFbbE9;
        l[4] = 0x09A645aa6cc6b0eB320dCF3982bcaA6A22b32629;
        l[5] = 0x8b998abA2BeeebF7ceBf565bC53BC575693c07a4;
        l[6] = 0x66613fD9a2c70d4cB56D920bDd0D56bA95BD2736;
        l[7] = 0x9e521add6F67EEe0Fe5c0b8ef32cb4543f7af50E;
        l[8] = 0x30b6b8C67Ab2239185536ba3766e8cb05BFd18ae;
        l[9] = 0x8433AD00601C57cE9F144b20A32aE478EEe831AE;
        l[10] = 0xF706Aeb7E1B6A44139205dF3043bf68cCf386918;
        l[11] = 0x3e73bC0309c72EA69bD74CaDEC943668291Ca6ed;
    }

    function setUp() public {
        vm.createSelectFork("bsc");
        pass = new EarlyPass(REGISTRY, _league());
    }

    function test_fork_openInTheBlockItIsDeployed() public {
        // No warp: the fork's own time, the pass just deployed in setUp.
        if (block.timestamp < pass.CLOSES_AT()) {
            assertEq(pass.missing(CARD_HOLDER), 0);
            vm.prank(CARD_HOLDER);
            pass.mint();
            assertEq(pass.ownerOf(1), CARD_HOLDER);
        }
    }

    function test_fork_agentIdWalletMintsAfterOpening() public {
        assertEq(pass.missing(CARD_HOLDER), 0);
        vm.prank(CARD_HOLDER);
        pass.mint();
        assertEq(pass.mintedPass(CARD_HOLDER), 1);
        assertEq(pass.ownerOf(1), CARD_HOLDER);
        assertGe(pass.contractsUsed(CARD_HOLDER), 1);
        assertGt(bytes(pass.tokenURI(1)).length, 200);
    }

    function test_fork_walletWithoutTheCardMintsToo() public {
        assertEq(pass.missing(TICKET_ONLY), 0);
        vm.prank(TICKET_ONLY);
        pass.mint(1);
        assertEq(pass.ownerOf(1), TICKET_ONLY);
    }

    function test_fork_passMovesBetweenWallets() public {
        vm.prank(CARD_HOLDER);
        pass.mint();
        vm.prank(CARD_HOLDER);
        pass.transferFrom(CARD_HOLDER, TICKET_ONLY, 1);
        assertEq(pass.ownerOf(1), TICKET_ONLY);
        assertTrue(pass.hasMinted(CARD_HOLDER));
        assertFalse(pass.hasMinted(TICKET_ONLY));
    }

    function test_fork_walletWithoutAgentIdIsRejected() public {
        address nobody = address(0x000000000000000000000000000000000000dEaD);
        assertEq(pass.missing(nobody), 1);
        vm.prank(nobody);
        vm.expectRevert(EarlyPass.NotAgentIdHolder.selector);
        pass.mint();
    }

    function test_fork_everyLeagueContractAnswers() public view {
        assertEq(pass.leagueSize(), 12);
        for (uint256 i = 0; i < 12; i++) {
            assertEq(pass.leagueAt(i), _league()[i]);
        }
    }
}
