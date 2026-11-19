// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LeagueCore} from "../src/LeagueCore.sol";
import {Scorer} from "../src/Scorer.sol";
import {CardArt} from "../src/CardArt.sol";
import {CardArtData} from "../src/CardArtData.sol";
import {CardTestUtils} from "./utils/CardTestUtils.sol";

contract MockAgentID {
    mapping(address => uint256) public balanceOf;
    mapping(address => string) private _handle;
    bool public handleReverts;

    function give(address a, string memory h) external {
        balanceOf[a] = 1;
        _handle[a] = h;
    }

    function setHandleReverts(bool v) external {
        handleReverts = v;
    }

    function handleOf(address a) external view returns (string memory) {
        require(!handleReverts, "boom");
        return _handle[a];
    }
}

contract MockFeed {
    struct R {
        int256 answer;
        uint256 updatedAt;
    }

    mapping(uint80 => R) public rounds;
    mapping(uint80 => bool) public reverts;
    uint8 public decimals = 8;

    function set(uint80 id, int256 answer, uint256 updatedAt) external {
        rounds[id] = R(answer, updatedAt);
    }

    function setReverts(uint80 id, bool v) external {
        reverts[id] = v;
    }

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverts[id], "no data");
        R memory r = rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}

contract LeagueTest is CardTestUtils {
    MockAgentID aid;
    MockFeed fBtc;
    MockFeed fEth;
    MockFeed fBnb;
    LeagueCore core;
    Scorer scorer;
    CardArt art;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address mallory = address(0xBAD);

    uint256 constant DAY = 1 days;
    uint256 constant HORIZON = 6 hours;
    uint256 constant T0 = 20_000 * DAY + 10 hours; // some day, 10:00 UTC
    uint32 constant E0 = 20_000;

    function setUp() public {
        vm.warp(T0);
        aid = new MockAgentID();
        fBtc = new MockFeed();
        fEth = new MockFeed();
        fBnb = new MockFeed();
        art = new CardArt(address(new CardArtData()));
        core = new LeagueCore(address(aid), "Forecast League", "FCL", address(art));
        scorer = new Scorer(address(core), address(fBtc), address(fEth), address(fBnb), HORIZON);
        aid.give(alice, "alice01");
        aid.give(bob, "bob");
    }

    function _e() internal view returns (uint32) {
        return uint32(block.timestamp / DAY);
    }

    function _p(uint64 a, uint64 b, uint64 c) internal pure returns (uint64[3] memory p) {
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    // ------------------------------------------------------------ LeagueCore

    function test_nonHolderCannotSubmit() public {
        vm.prank(mallory);
        vm.expectRevert(LeagueCore.NotAgentIdHolder.selector);
        core.submit(_p(1, 0, 0), false, _e());
    }

    function test_emptySubmissionReverts() public {
        vm.prank(alice);
        vm.expectRevert(LeagueCore.EmptySubmission.selector);
        core.submit(_p(0, 0, 0), false, _e());
    }

    function test_firstSubmitMintsCardAndRecords() public {
        vm.prank(alice);
        core.submit(_p(6_380_000_000_000, 180_000_000_000, 0), true, _e());

        assertEq(core.totalCards(), 1);
        assertEq(core.cardOf(alice), 1);
        assertEq(core.ownerOf(1), alice);
        assertEq(core.balanceOf(alice), 1);
        assertEq(core.balanceOf(bob), 0);
        assertTrue(core.locked(1));
        assertTrue(core.showName(alice));
        assertEq(core.submissionCount(alice), 1);

        (uint64[3] memory prices, uint40 at) = core.submissionOf(alice, E0);
        assertEq(prices[0], 6_380_000_000_000);
        assertEq(prices[1], 180_000_000_000);
        assertEq(prices[2], 0);
        assertEq(at, T0);
    }

    function test_oncePerDay_andNoSecondCard() public {
        vm.startPrank(alice);
        core.submit(_p(1, 1, 1), false, _e());
        vm.expectRevert(LeagueCore.AlreadySubmitted.selector);
        core.submit(_p(2, 2, 2), false, _e());

        vm.warp(T0 + DAY);
        core.submit(_p(3, 3, 3), false, _e());
        vm.stopPrank();

        assertEq(core.totalCards(), 1);
        assertEq(core.submissionCount(alice), 2);
        (uint64[3] memory first,) = core.submissionOf(alice, E0);
        assertEq(first[0], 1); // the rejected second call did not overwrite
    }

    function test_wrongEpochReverts_atTheDayBoundary() public {
        uint256 lock = (uint256(E0) + 1) * DAY;

        // Prepared for day E0 but included after midnight: rejected, nothing recorded.
        vm.warp(lock);
        vm.prank(alice);
        vm.expectRevert(LeagueCore.WrongEpoch.selector);
        core.submit(_p(1, 0, 0), false, E0);
        assertEq(core.cardOf(alice), 0);

        // One second before midnight still belongs to day E0.
        vm.warp(lock - 1);
        vm.prank(alice);
        core.submit(_p(1, 0, 0), false, E0);
        (, uint40 at) = core.submissionOf(alice, E0);
        assertEq(at, lock - 1);

        // Exactly at midnight it is day E0 + 1.
        vm.warp(lock);
        vm.prank(alice);
        core.submit(_p(2, 0, 0), false, E0 + 1);
        (uint64[3] memory next,) = core.submissionOf(alice, E0 + 1);
        assertEq(next[0], 2);
        assertEq(core.totalSupply(), 1);
    }

    function test_constructorRejectsBadArguments() public {
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(0x1234), "Forecast League", "FCL", address(art)); // no registry at that address
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(aid), "Forecast League", "FCL", address(0x1234)); // no card art at that address
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(aid), 'Bad"Name', "FCL", address(art));
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(aid), "Forecast League", "<b>", address(art));
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(aid), "", "FCL", address(art));
        vm.expectRevert(LeagueCore.BadConstructorArgument.selector);
        new LeagueCore(address(aid), "This name is longer than thirty two chars", "FCL", address(art));
    }

    function test_eventsOnFirstSubmit() public {
        vm.expectEmit(true, true, true, true, address(core));
        emit LeagueCore.Transfer(address(0), alice, 1);
        vm.expectEmit(false, false, false, true, address(core));
        emit LeagueCore.Locked(1);
        vm.expectEmit(true, false, false, true, address(core));
        emit LeagueCore.ShowNameSet(alice, true);
        vm.expectEmit(true, true, false, true, address(core));
        emit LeagueCore.Submitted(alice, E0, 5, 6, 7);
        vm.expectEmit(false, false, false, true, address(core));
        emit LeagueCore.MetadataUpdate(1);
        vm.prank(alice);
        core.submit(_p(5, 6, 7), true, E0);
    }

    function test_cardNumbersAreSequentialPerHolder() public {
        vm.prank(alice);
        core.submit(_p(1, 0, 0), false, _e());
        vm.prank(bob);
        core.submit(_p(1, 0, 0), false, _e());
        assertEq(core.cardOf(alice), 1);
        assertEq(core.cardOf(bob), 2);
        assertEq(core.totalCards(), 2);
    }

    function test_cardIsNonTransferable() public {
        vm.prank(alice);
        core.submit(_p(1, 0, 0), false, _e());

        vm.startPrank(alice);
        vm.expectRevert(LeagueCore.NonTransferable.selector);
        core.transferFrom(alice, bob, 1);
        vm.expectRevert(LeagueCore.NonTransferable.selector);
        core.safeTransferFrom(alice, bob, 1);
        vm.expectRevert(LeagueCore.NonTransferable.selector);
        core.safeTransferFrom(alice, bob, 1, "");
        vm.expectRevert(LeagueCore.NonTransferable.selector);
        core.approve(bob, 1);
        vm.expectRevert(LeagueCore.NonTransferable.selector);
        core.setApprovalForAll(bob, true);
        vm.stopPrank();

        assertEq(core.ownerOf(1), alice);
        assertEq(core.getApproved(1), address(0));
        assertFalse(core.isApprovedForAll(alice, bob));
    }

    function test_interfacesAndMissingToken() public {
        assertTrue(core.supportsInterface(0x01ffc9a7));
        assertTrue(core.supportsInterface(0x80ac58cd));
        assertTrue(core.supportsInterface(0x5b5e139f));
        assertTrue(core.supportsInterface(0xb45a3c0e));
        assertTrue(core.supportsInterface(0x49064906));
        assertFalse(core.supportsInterface(0xffffffff));
        vm.expectRevert(LeagueCore.NonexistentToken.selector);
        core.ownerOf(1);
        vm.expectRevert(LeagueCore.NonexistentToken.selector);
        core.tokenURI(1);
    }

    function test_setShowNameNeedsCard() public {
        vm.prank(bob);
        vm.expectRevert(LeagueCore.NoCard.selector);
        core.setShowName(true);
    }

    function _decodedJson(uint256 tokenId) internal view returns (string memory) {
        return _jsonOf(core.tokenURI(tokenId));
    }

    function test_tokenURI_showsNameOnlyWithConsent() public {
        vm.prank(alice);
        core.submit(_p(1, 0, 0), false, _e());
        string memory hidden = _decodedJson(1);
        assertFalse(_contains(hidden, "alice01"));
        assertTrue(_contains(hidden, "Forecast League #1"));
        assertTrue(_contains(hidden, "no monetary value"));

        assertTrue(_contains(_svgOf(hidden), ">AGENT #0001</text>")); // the image hides the name too
        assertFalse(_contains(_svgOf(hidden), "alice01"));

        vm.prank(alice);
        core.setShowName(true);
        string memory shown = _decodedJson(1);
        assertTrue(_contains(shown, '"value":"alice01.ai"'));
        assertTrue(_contains(_svgOf(shown), ">alice01.ai</text>"));
        assertEq(
            keccak256(bytes(_svgOf(shown))), keccak256(bytes(art.svg(alice, 1, "alice01", 1))), "image comes from CardArt"
        );

        vm.prank(alice);
        core.setShowName(false);
        assertFalse(_contains(_decodedJson(1), "alice01"));
        assertFalse(_contains(_svgOf(_decodedJson(1)), "alice01"));
    }

    // ------------------------------------------------------------------ mint

    function test_mint_onlyForHolders_onlyOnce() public {
        vm.prank(mallory);
        vm.expectRevert(LeagueCore.NotAgentIdHolder.selector);
        core.mint();

        vm.expectEmit(true, true, true, true, address(core));
        emit LeagueCore.Transfer(address(0), alice, 1);
        vm.expectEmit(false, false, false, true, address(core));
        emit LeagueCore.Locked(1);
        vm.prank(alice);
        core.mint();

        assertEq(core.cardOf(alice), 1);
        assertEq(core.ownerOf(1), alice);
        assertEq(core.totalCards(), 1);
        assertEq(core.balanceOf(alice), 1);
        assertEq(core.submissionCount(alice), 0);
        assertFalse(core.showName(alice));

        vm.prank(alice);
        vm.expectRevert(LeagueCore.AlreadyHasCard.selector);
        core.mint();
        assertEq(core.totalCards(), 1);
    }

    function test_mintThenSubmit_keepsTheSameCard() public {
        vm.prank(alice);
        core.mint();
        vm.prank(bob);
        core.mint();

        vm.recordLogs();
        vm.prank(alice);
        core.submit(_p(5, 6, 7), true, _e());
        assertEq(vm.getRecordedLogs().length, 3, "ShowNameSet, Submitted and MetadataUpdate only, no second mint");

        assertEq(core.cardOf(alice), 1);
        assertEq(core.cardOf(bob), 2);
        assertEq(core.totalCards(), 2);
        assertEq(core.submissionCount(alice), 1);
    }

    function test_submitThenMint_reverts() public {
        vm.prank(alice);
        core.submit(_p(5, 6, 7), false, _e());
        vm.prank(alice);
        vm.expectRevert(LeagueCore.AlreadyHasCard.selector);
        core.mint();
        assertEq(core.totalCards(), 1);
    }

    function test_mintedCardWithoutForecasts_hasMetadata() public {
        vm.prank(alice);
        core.mint();
        string memory json = _decodedJson(1);
        assertTrue(_contains(json, '{"trait_type":"Forecasts","value":0}'));
        assertTrue(_contains(json, '{"trait_type":"Tier","value":"ROOKIE"}'));
        string memory svg = _svgOf(json);
        assertTrue(_contains(svg, ">ROOKIE</text>"));
        assertTrue(_contains(svg, "FORECASTS 0</text>"));
        assertTrue(_contains(svg, ">GENESIS</text>"));
    }

    // ------------------------------------------------------------------ tiers

    function test_tierOf_thresholds() public view {
        assertEq(core.tierOf(0), "ROOKIE");
        assertEq(core.tierOf(2), "ROOKIE");
        assertEq(core.tierOf(3), "ANALYST");
        assertEq(core.tierOf(7), "ANALYST");
        assertEq(core.tierOf(8), "STRATEGIST");
        assertEq(core.tierOf(14), "STRATEGIST");
        assertEq(core.tierOf(15), "ORACLE");
        assertEq(core.tierOf(type(uint32).max), "ORACLE");
    }

    /// The Tier attribute and the picture change together as forecasts accumulate.
    function test_tierAttributeAndImage_followTheForecastCount() public {
        string[4] memory names = ["ROOKIE", "ANALYST", "STRATEGIST", "ORACLE"];
        for (uint32 n = 1; n <= 15; n++) {
            vm.warp(T0 + (n - 1) * DAY);
            vm.prank(alice);
            core.submit(_p(1, 0, 0), true, _e());
            if (n == 1 || n == 2 || n == 3 || n == 7 || n == 8 || n == 14 || n == 15) {
                uint256 ti = n >= 15 ? 3 : n >= 8 ? 2 : n >= 3 ? 1 : 0;
                string memory json = _decodedJson(1);
                assertTrue(
                    _contains(json, string.concat('{"trait_type":"Tier","value":"', names[ti], '"}')), names[ti]
                );
                assertTrue(_contains(json, string.concat('{"trait_type":"Forecasts","value":', vm.toString(n), "}")));
                string memory svg = _svgOf(json);
                assertTrue(_contains(svg, string.concat(">", names[ti], "</text>")));
                assertTrue(_contains(svg, string.concat("FORECASTS ", vm.toString(n), "</text>")));
                assertEq(art.tierOf(n), ti);
            }
        }
    }

    /// Not an assertion of a limit, just a record: gas of one tokenURI call per tier.
    function test_gas_tokenURI_perTier() public {
        uint32[4] memory at = [uint32(1), 3, 8, 15];
        uint256 next = 0;
        for (uint32 n = 1; n <= 15; n++) {
            vm.warp(T0 + (n - 1) * DAY);
            vm.prank(alice);
            core.submit(_p(1, 0, 0), true, _e());
            if (n == at[next]) {
                uint256 before = gasleft();
                string memory uri = core.tokenURI(1);
                uint256 used = before - gasleft();
                emit log_named_uint(string.concat("tokenURI gas, ", core.tierOf(n)), used);
                emit log_named_uint("  token URI bytes", bytes(uri).length);
                assertLt(used, 15_000_000);
                next = next == 3 ? 3 : next + 1;
            }
        }
    }

    function test_tokenURI_rejectsOddHandlesAndSurvivesRegistryFailure() public {
        aid.give(mallory, 'x","evil":"1');
        vm.prank(mallory);
        core.submit(_p(1, 0, 0), true, _e());
        string memory json = _decodedJson(1);
        assertFalse(_contains(json, "evil"));
        assertFalse(_contains(json, "Agent ID"));

        aid.give(bob, "bob");
        vm.prank(bob);
        core.submit(_p(1, 0, 0), true, _e());
        aid.setHandleReverts(true);
        assertFalse(_contains(_decodedJson(2), "bob.ai")); // still returns metadata
    }

    // ---------------------------------------------------------------- Scorer

    function test_scoreFormula() public view {
        // Example from the plan: P0 63,800  P1 64,438
        uint64 p0 = 6_380_000_000_000;
        uint64 p1 = 6_443_800_000_000;
        assertEq(scorer.scoreOf(p0, p1, p0), 0); // submitting the lock price
        assertEq(scorer.scoreOf(p0, p1, 6_430_000_000_000), 78);
        assertEq(scorer.scoreOf(p0, p1, 6_300_000_000_000), -100); // limited
        assertEq(scorer.scoreOf(p0, p1, p1), 100); // exact
        assertEq(scorer.scoreOf(p0, p1, 6_457_600_000_000), 78); // symmetric overshoot
        // price did not move: the floor (0.1% of P0) is the yardstick
        assertEq(scorer.scoreOf(p0, p0, p0), 0);
        assertEq(scorer.scoreOf(p0, p0, p0 + 6_380_000_000), -100);
        assertEq(scorer.scoreOf(p0, p0, p0 + 3_190_000_000), -50);
    }

    function testFuzz_scoreIsBoundedAndBaselineIsZero(uint64 p0, uint64 p1, uint64 f) public view {
        p0 = uint64(bound(p0, 1, type(uint64).max));
        p1 = uint64(bound(p1, 1, type(uint64).max));
        int16 s = scorer.scoreOf(p0, p1, f);
        assertGe(s, -100);
        assertLe(s, 100);
        assertEq(scorer.scoreOf(p0, p1, p0), 0);
    }

    uint256 constant LOCK = (uint256(E0) + 1) * DAY;
    uint256 constant TARGET = LOCK + HORIZON;

    function _seedFeed(MockFeed f, int256 p0, int256 p1) internal {
        f.set(10, p0 - 5, LOCK - 70); // older than the best lock round
        f.set(11, p0, LOCK - 4); // best lock round
        f.set(12, p0 + 9, LOCK + 62); // after lock
        f.set(20, p1 - 7, TARGET - 71);
        f.set(21, p1, TARGET - 5); // best target round
        f.set(22, p1 + 3, TARGET + 61);
        f.set(30, p0, LOCK - 2 hours); // too old
    }

    function test_settleValidation() public {
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);

        vm.expectRevert(Scorer.BadFeedIndex.selector);
        scorer.settle(E0, 3, 11, 21);

        vm.warp(TARGET);
        vm.expectRevert(Scorer.TooEarly.selector); // must be strictly after the target time
        scorer.settle(E0, 0, 11, 21);

        vm.warp(TARGET + 120);
        vm.expectRevert(Scorer.BadFeedRound.selector); // lock round updated after lock time
        scorer.settle(E0, 0, 12, 21);
        vm.expectRevert(Scorer.BadFeedRound.selector); // target round updated after target time
        scorer.settle(E0, 0, 11, 22);
        vm.expectRevert(Scorer.BadFeedRound.selector); // more than MAX_LAG before lock
        scorer.settle(E0, 0, 30, 21);
        vm.expectRevert(Scorer.BadFeedRound.selector); // unknown round
        scorer.settle(E0, 0, 99, 21);
    }

    function test_settle_onlyTheLatestRoundIsAccepted() public {
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        vm.warp(TARGET + 120);

        vm.expectRevert(Scorer.NotLatestRound.selector); // an older lock round that suits the caller
        scorer.settle(E0, 0, 10, 21);
        vm.expectRevert(Scorer.NotLatestRound.selector); // an older target round
        scorer.settle(E0, 0, 11, 20);

        scorer.settle(E0, 0, 11, 21);
        (Scorer.Round memory r,) = scorer.roundOf(E0, 0);
        assertEq(r.p0, 6_380_000_000_000);
        assertEq(r.p1, 6_443_800_000_000);
    }

    function test_settle_twoRoundsWithTheSameTime_laterOneIsTheAnswer() public {
        fBtc.set(11, 100e8, LOCK - 4);
        fBtc.set(12, 101e8, LOCK - 4); // same update time as round 11
        fBtc.set(13, 102e8, LOCK + 60);
        fBtc.set(21, 110e8, TARGET - 5);
        fBtc.set(22, 111e8, TARGET + 60);
        vm.warp(TARGET + 120);

        vm.expectRevert(Scorer.NotLatestRound.selector);
        scorer.settle(E0, 0, 11, 21);
        scorer.settle(E0, 0, 12, 21);
        (Scorer.Round memory r,) = scorer.roundOf(E0, 0);
        assertEq(r.p0, 101e8);
    }

    function test_settle_rejectsBadFeedAnswers() public {
        fBtc.set(11, 0, LOCK - 4);
        fBtc.set(21, 110e8, TARGET - 5);
        vm.warp(TARGET + 120);
        vm.expectRevert(Scorer.BadFeedRound.selector);
        scorer.settle(E0, 0, 11, 21);

        fBtc.set(11, -5, LOCK - 4);
        vm.expectRevert(Scorer.BadFeedRound.selector);
        scorer.settle(E0, 0, 11, 21);

        fBtc.set(11, int256(uint256(type(uint64).max)) + 1, LOCK - 4);
        vm.expectRevert(Scorer.BadFeedRound.selector);
        scorer.settle(E0, 0, 11, 21);

        fBtc.set(11, int256(uint256(type(uint64).max)), LOCK - 4);
        scorer.settle(E0, 0, 11, 21); // the largest storable price is fine
    }

    function test_settle_boundariesOfTheAllowedLag() public {
        fBtc.set(11, 100e8, LOCK - 30 minutes - 1);
        fBtc.set(21, 110e8, TARGET);
        vm.warp(TARGET + 1);
        vm.expectRevert(Scorer.BadFeedRound.selector); // one second too old
        scorer.settle(E0, 0, 11, 21);

        fBtc.set(11, 100e8, LOCK - 30 minutes);
        scorer.settle(E0, 0, 11, 21); // exactly MAX_LAG old, and a target round updated exactly at target
        (Scorer.Round memory r,) = scorer.roundOf(E0, 0);
        assertEq(r.t1, TARGET);
    }

    /// When a feed moves to a new series of round numbers, the last round of the old series has
    /// no successor. It is accepted, and anyone can replace it with a closer round in time.
    function test_settle_closerRoundWinsDuringChallenge_thenFinal() public {
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        fBtc.set(40, 6_370_000_000_000, LOCK - 200); // last round of an old series
        fBtc.set(45, 6_440_000_000_000, TARGET - 300);
        fBtc.setReverts(41, true); // a feed may revert for a round that does not exist
        vm.warp(TARGET + 120);

        scorer.settle(E0, 0, 40, 45);
        (Scorer.Round memory r, bool fin) = scorer.roundOf(E0, 0);
        assertEq(r.p0, 6_370_000_000_000);
        assertFalse(fin);

        vm.expectRevert(Scorer.NotCloser.selector); // same rounds again
        scorer.settle(E0, 0, 40, 45);
        vm.expectRevert(Scorer.NotCloser.selector); // one side better, the other the same, is fine; both same is not
        scorer.settle(E0, 0, 40, 45);

        scorer.settle(E0, 0, 11, 45); // one side closer
        scorer.settle(E0, 0, 11, 21); // then the other
        (r,) = scorer.roundOf(E0, 0);
        assertEq(r.p0, 6_380_000_000_000);
        assertEq(r.p1, 6_443_800_000_000);

        vm.expectRevert(Scorer.NotCloser.selector); // cannot go back to a worse round
        scorer.settle(E0, 0, 40, 21);

        vm.warp(TARGET + 120 + 30 minutes - 1);
        (, fin) = scorer.roundOf(E0, 0);
        assertFalse(fin);
        vm.warp(TARGET + 120 + 30 minutes);
        (, fin) = scorer.roundOf(E0, 0);
        assertTrue(fin);
        vm.expectRevert(Scorer.RoundFinal.selector);
        scorer.settle(E0, 0, 11, 21);
    }

    function test_scorerConstructorChecksFeeds() public {
        MockFeed odd = new MockFeed();
        odd.setDecimals(18);
        vm.expectRevert(bytes("feed decimals"));
        new Scorer(address(core), address(fBtc), address(odd), address(fBnb), HORIZON);
        vm.expectRevert(bytes("core"));
        new Scorer(address(0x1234), address(fBtc), address(fEth), address(fBnb), HORIZON);
        vm.expectRevert(bytes("horizon"));
        new Scorer(address(core), address(fBtc), address(fEth), address(fBnb), 10 minutes);
    }

    function test_endToEnd_scoringAndStats() public {
        // alice: good BTC call, skips ETH, exact BNB. bob: submits the lock prices.
        vm.prank(alice);
        core.submit(_p(6_430_000_000_000, 0, 60_000_000_000), true, _e());
        vm.prank(bob);
        core.submit(_p(6_380_000_000_000, 180_000_000_000, 59_000_000_000), false, _e());

        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        _seedFeed(fEth, 180_000_000_000, 181_000_000_000);
        _seedFeed(fBnb, 59_000_000_000, 60_000_000_000);

        vm.warp(TARGET + 60);
        scorer.settle(E0, 0, 11, 21);
        scorer.settle(E0, 2, 11, 21);

        vm.expectRevert(Scorer.NotFinal.selector); // challenge window still open
        scorer.score(alice, E0);

        vm.warp(TARGET + 60 + 30 minutes);
        scorer.score(alice, E0); // alice did not forecast ETH, so the unsettled ETH round does not block her
        (uint32 epochs, uint32 forecasts, uint32 wins, int64 total) = scorer.statsOf(alice);
        assertEq(epochs, 1);
        assertEq(forecasts, 2);
        assertEq(wins, 2);
        assertEq(total, 78 + 100);

        vm.expectRevert(Scorer.AlreadyScored.selector);
        scorer.score(alice, E0);

        vm.expectRevert(Scorer.NotFinal.selector); // bob forecast ETH, which is not settled yet
        scorer.score(bob, E0);

        scorer.settle(E0, 1, 11, 21);
        vm.warp(block.timestamp + 30 minutes);
        scorer.score(bob, E0);
        (epochs, forecasts, wins, total) = scorer.statsOf(bob);
        assertEq(epochs, 1);
        assertEq(forecasts, 3);
        assertEq(wins, 0);
        assertEq(total, 0); // doing nothing scores nothing

        vm.expectRevert(Scorer.NoSubmission.selector);
        scorer.score(mallory, E0);
    }

    function test_scoreMany_skipsWhatCannotBeScored() public {
        vm.prank(alice);
        core.submit(_p(6_430_000_000_000, 0, 0), false, _e());
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        vm.warp(TARGET + 60);
        scorer.settle(E0, 0, 11, 21);
        vm.warp(block.timestamp + 30 minutes);

        address[] memory list = new address[](3);
        list[0] = alice;
        list[1] = mallory; // no submission
        list[2] = alice; // duplicate
        scorer.scoreMany(list, E0);
        (uint32 epochs,,, int64 total) = scorer.statsOf(alice);
        assertEq(epochs, 1);
        assertEq(total, 78);
    }

    function test_voidRound_isSkippedForEveryoneAndCanNeverBeSettled() public {
        vm.prank(alice);
        core.submit(_p(6_430_000_000_000, 180_000_000_000, 0), false, _e());
        vm.prank(bob);
        core.submit(_p(0, 185_000_000_000, 0), false, _e()); // ETH only
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        _seedFeed(fEth, 180_000_000_000, 181_000_000_000);
        vm.warp(TARGET + 60);
        scorer.settle(E0, 0, 11, 21); // ETH is never settled in time

        vm.warp(TARGET + 7 days - 1);
        vm.expectRevert(Scorer.NotFinal.selector);
        scorer.score(alice, E0);

        vm.warp(TARGET + 7 days);
        vm.expectRevert(Scorer.RoundVoid.selector); // too late: the ETH round is void for good
        scorer.settle(E0, 1, 11, 21);

        scorer.score(alice, E0);
        (uint32 epochs, uint32 forecasts,, int64 total) = scorer.statsOf(alice);
        assertEq(epochs, 1);
        assertEq(forecasts, 1); // only BTC counted
        assertEq(total, 78);

        // Bob only forecast the void pair: nothing is scored and the epoch does not count.
        scorer.score(bob, E0);
        (epochs, forecasts,, total) = scorer.statsOf(bob);
        assertEq(epochs, 0);
        assertEq(forecasts, 0);
        assertEq(total, 0);
        assertTrue(scorer.scored(bob, E0));
    }

    function test_roundSettledJustBeforeTheVoidDeadlineIsStillScored() public {
        vm.prank(alice);
        core.submit(_p(6_430_000_000_000, 0, 0), false, _e());
        _seedFeed(fBtc, 6_380_000_000_000, 6_443_800_000_000);
        vm.warp(TARGET + 7 days - 1);
        scorer.settle(E0, 0, 11, 21);

        vm.warp(TARGET + 7 days + 60);
        vm.expectRevert(Scorer.NotFinal.selector); // settled, so not void; challenge window still open
        scorer.score(alice, E0);

        vm.warp(TARGET + 7 days - 1 + 30 minutes);
        scorer.score(alice, E0);
        (,,, int64 total) = scorer.statsOf(alice);
        assertEq(total, 78);
    }

    function test_isQualified_needsFiveEpochsAndPositiveTotal() public {
        for (uint32 d = 0; d < 5; d++) {
            vm.warp(T0 + d * DAY);
            vm.prank(alice);
            core.submit(_p(6_430_000_000_000, 0, 0), false, _e());
            vm.prank(bob);
            core.submit(_p(6_380_000_000_000, 0, 0), false, _e());
        }
        for (uint32 d = 0; d < 5; d++) {
            uint256 lock = (uint256(E0 + d) + 1) * DAY;
            fBtc.set(uint80(100 + d * 2), 6_380_000_000_000, lock - 3);
            fBtc.set(uint80(101 + d * 2), 6_443_800_000_000, lock + HORIZON - 3);
        }
        vm.warp((uint256(E0) + 5) * DAY + HORIZON + 60);
        for (uint32 d = 0; d < 5; d++) {
            scorer.settle(E0 + d, 0, uint80(100 + d * 2), uint80(101 + d * 2));
        }
        vm.warp(block.timestamp + 30 minutes);
        for (uint32 d = 0; d < 4; d++) {
            scorer.score(alice, E0 + d);
            scorer.score(bob, E0 + d);
        }
        assertFalse(scorer.isQualified(alice)); // four epochs only
        scorer.score(alice, E0 + 4);
        scorer.score(bob, E0 + 4);
        assertTrue(scorer.isQualified(alice)); // five epochs, total 390
        assertFalse(scorer.isQualified(bob)); // five epochs, total 0
    }
}
