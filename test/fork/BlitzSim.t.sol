// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Blitz} from "../../src/Blitz.sol";

interface ICards {
    function totalCards() external view returns (uint256);
    function ownerOf(uint256) external view returns (address);
}

interface ISquadsLive {
    function joinSquad(string calldata) external;
    function squadOf(address) external view returns (address, uint40);
}

/// @dev A dress rehearsal, not evidence of demand. It deploys Blitz on a fork of BNB Chain and
///      plays three rounds that have already finished in real time, so that the real Chainlink
///      feed decides them. The players are real Agent ID wallets (the first holders of Forecast
///      League cards), impersonated on the fork; nothing here touches mainnet.
contract BlitzSimulation is Test {
    address constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant BTC_USD = 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf;
    address constant SQUADS = 0x1eAeEE5BA7582858b266920E79938203E92120D0;
    address constant CORE = 0x79F55DAa8a3CF2Eb76EE40e26ff6E244a4cC1eD4;
    address constant CAPTAIN = 0x2a2F48145780639dbD91e748dF157F35283165Da; // dopaminekr.ai

    uint256 constant PLAYERS = 60;

    function test_threeRoundsWithRealHoldersAndRealPrices() public {
        vm.createSelectFork("bsc");
        uint256 realNow = block.timestamp;
        Blitz blitz = new Blitz(REGISTRY, BTC_USD, SQUADS);

        address[] memory players = new address[](PLAYERS);
        for (uint256 i = 0; i < PLAYERS; i++) players[i] = ICards(CORE).ownerOf(i + 1);

        // Five of them join the live squad "dopaminekr" on the fork before playing.
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(players[i]);
            ISquadsLive(SQUADS).joinSquad("dopaminekr");
        }

        uint32 first = uint32(realNow / 6 hours) - 5; // its target time is 18 to 24 hours ago
        uint256[3] memory turnout = [uint256(60), 36, 24];
        uint256 mintGas;
        uint256 mints;
        for (uint256 k = 0; k < 3; k++) {
            vm.warp((uint256(first) + k) * 6 hours + 120);
            for (uint256 i = 0; i < turnout[k]; i++) {
                vm.prank(players[i]);
                uint256 g = gasleft();
                if (i % 3 == 0) blitz.up();
                else if (i % 3 == 1) blitz.down();
                else blitz.mint();
                mintGas += g - gasleft();
                mints++;
            }
        }

        // Back to the real present: all three rounds are finished and the real feed has their prices.
        vm.warp(realNow);
        uint256 claimGas;
        uint256 firstClaimGas;
        for (uint256 i = 0; i < PLAYERS; i++) {
            vm.prank(players[i]);
            uint256 g = gasleft();
            blitz.claim();
            g -= gasleft();
            if (i == 0) firstClaimGas = g;
            else claimGas += g;
        }

        emit log_named_uint("players (real Agent ID wallets)", blitz.totalPlayers());
        emit log_named_uint("tickets", blitz.totalSupply());
        emit log_named_uint("average gas per ticket", mintGas / mints);
        emit log_named_uint("first claim, settling three rounds (gas)", firstClaimGas);
        emit log_named_uint("average later claim (gas)", claimGas / (PLAYERS - 1));
        for (uint32 k = 0; k < 3; k++) {
            (uint64 p0, uint64 p1, uint8 outcome,) = blitz.resultOf(first + k);
            emit log_named_uint("round", first + k);
            emit log_named_uint("  lock price (USD, 8 decimals)", p0);
            emit log_named_uint("  target price", p1);
            emit log_named_uint("  outcome (1 up, 2 down, 3 push, 4 void)", outcome);
            emit log_named_uint("  tickets", blitz.roundMinted(first + k));
            assertTrue(outcome == 1 || outcome == 2 || outcome == 3, "a past round must settle from the real feed");
        }
        (uint256 wins, uint256 losses, uint256 bestStreak) = _tally(blitz, players);
        emit log_named_uint("wins recorded", wins);
        emit log_named_uint("losses recorded", losses);
        emit log_named_uint("best streak", bestStreak);
        (uint32 squadTickets, uint32 squadWins, uint32 squadLosses) = blitz.squadTally(CAPTAIN, first, first + 2);
        emit log_named_uint("squad dopaminekr: tickets", squadTickets);
        emit log_named_uint("squad dopaminekr: wins", squadWins);
        emit log_named_uint("squad dopaminekr: losses", squadLosses);
        assertEq(blitz.totalSupply(), 120);
        assertEq(wins + losses, 120); // no push or void in these rounds, checked above per round
        assertEq(squadTickets, 6 * 3); // the captain (card #1) and the five who joined played all three rounds
        // 36 of the 60 first-round players came back in the second round, 24 in the third.
        assertEq(blitz.roundMinted(first + 1), 36);
        assertEq(blitz.roundMinted(first + 2), 24);
    }

    function _tally(Blitz blitz, address[] memory players) internal view returns (uint256 wins, uint256 losses, uint256 best) {
        for (uint256 i = 0; i < players.length; i++) {
            (, uint32 w, uint32 l,, uint32 b, uint32 unclaimed) = blitz.recordOf(players[i]);
            wins += w;
            losses += l;
            if (b > best) best = b;
            require(unclaimed == 0, "unclaimed tickets left");
        }
    }
}
