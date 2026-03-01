// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {UnderwritingRegistryV2} from "../src/UnderwritingRegistryV2.sol";
import {UnderwritingPolicyTypes} from "../src/UnderwritingPolicyTypes.sol";
import "./mocks/MockForwarder.sol";

contract UnderwritingRegistryV2Test is Test {
    UnderwritingRegistryV2 internal registry;
    MockForwarder internal forwarder;

    address internal borrower = address(0xBEEF);
    uint256 internal assetId = 1;

    function setUp() public {
        forwarder = new MockForwarder();
        registry = new UnderwritingRegistryV2(address(forwarder));
    }

    function _buildDecision(UnderwritingPolicyTypes.DecisionStatus status)
        internal
        view
        returns (UnderwritingPolicyTypes.UnderwritingDecision memory)
    {
        UnderwritingPolicyTypes.CovenantSet memory covenants = UnderwritingPolicyTypes.CovenantSet({
            minDscrBps: 12500,
            maxDtiBps: 4200,
            maxLtvBps: 7000,
            maxVacancyBps: 1200,
            cashTrapTriggerBps: 11000,
            reportingCadenceDays: 30
        });

        UnderwritingPolicyTypes.DecisionProvenance memory provenance =
            UnderwritingPolicyTypes.DecisionProvenance({
                policyVersion: keccak256("policy-v1"),
                decisionId: keccak256("decision-1"),
                sourceHash: keccak256("source-1"),
                triggerType: UnderwritingPolicyTypes.TriggerType.NEW,
                creditCommitteeFlags: keccak256("flags"),
                covenantSetHash: keccak256(abi.encode(covenants))
            });

        return UnderwritingPolicyTypes.UnderwritingDecision({
            loanProduct: UnderwritingPolicyTypes.LoanProduct.UNSPECIFIED,
            status: status,
            maxLtvBps: 6800,
            rateBps: 975,
            creditLimit: 250_000 ether,
            expiry: block.timestamp + 30 days,
            nextReviewAt: block.timestamp + 7 days,
            gracePeriodEnd: block.timestamp + 5 days,
            reasoningHash: keccak256("reasoning"),
            covenants: covenants,
            provenance: provenance
        });
    }

    function _buildReport(
        address _borrower,
        uint256 _assetId,
        uint64 nonce,
        UnderwritingPolicyTypes.UnderwritingDecision memory decision
    ) internal pure returns (bytes memory) {
        return abi.encode(_borrower, _assetId, nonce, decision);
    }

    function testRequestUnderwritingStoresRequestContext() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 10_000 ether);

        UnderwritingPolicyTypes.RequestContext memory req =
            registry.getRequestContext(borrower, assetId);

        assertEq(req.intendedBorrowAmount, 10_000 ether);
        assertEq(req.nonce, 1);
        assertTrue(req.pending);
        assertEq(uint8(req.triggerType), uint8(UnderwritingPolicyTypes.TriggerType.NEW));
        assertTrue(req.reviewCycleId != bytes32(0));
        assertEq(uint8(req.loanProduct), uint8(UnderwritingPolicyTypes.LoanProduct.UNSPECIFIED));
    }

    function testLifecycleRequestIsOwnerOnly() public {
        vm.expectRevert();
        vm.prank(borrower);
        registry.requestLifecycleUnderwriting(
            borrower,
            assetId,
            5_000 ether,
            UnderwritingPolicyTypes.TriggerType.SCHEDULED
        );

        registry.requestLifecycleUnderwriting(
            borrower,
            assetId,
            5_000 ether,
            UnderwritingPolicyTypes.TriggerType.SCHEDULED
        );

        UnderwritingPolicyTypes.RequestContext memory req =
            registry.getRequestContext(borrower, assetId);
        assertTrue(req.pending);
        assertEq(uint8(req.triggerType), uint8(UnderwritingPolicyTypes.TriggerType.SCHEDULED));
    }

    function testValidReportStoresDecisionAndClearsPending() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL);

        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        forwarder.deliver(address(registry), "", report);

        UnderwritingPolicyTypes.UnderwritingDecision memory stored =
            registry.getDecision(borrower, assetId);
        UnderwritingPolicyTypes.RequestContext memory req =
            registry.getRequestContext(borrower, assetId);

        assertEq(uint8(stored.status), uint8(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL));
        assertEq(stored.maxLtvBps, 6800);
        assertEq(stored.rateBps, 975);
        assertEq(stored.creditLimit, 250_000 ether);
        assertEq(stored.provenance.decisionId, keccak256("decision-1"));
        assertEq(stored.covenants.minDscrBps, 12500);
        assertFalse(req.pending);
        assertEq(req.intendedBorrowAmount, 0);
    }

    function testRejectReportWithoutPendingRequest() public {
        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);

        bytes memory report = _buildReport(borrower, assetId, 1, decision);

        vm.expectRevert("No pending request");
        forwarder.deliver(address(registry), "", report);
    }

    function testRejectReportWithBadNonce() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);

        bytes memory report = _buildReport(borrower, assetId, 2, decision);

        vm.expectRevert("Bad nonce");
        forwarder.deliver(address(registry), "", report);
    }

    function testRejectInvalidStatus() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        bytes memory report = abi.encode(
            borrower,
            assetId,
            uint64(1),
            decision.loanProduct,
            uint8(4), // invalid enum value
            decision.maxLtvBps,
            decision.rateBps,
            decision.creditLimit,
            decision.expiry,
            decision.nextReviewAt,
            decision.gracePeriodEnd,
            decision.reasoningHash,
            decision.covenants.minDscrBps,
            decision.covenants.maxDtiBps,
            decision.covenants.maxLtvBps,
            decision.covenants.maxVacancyBps,
            decision.covenants.cashTrapTriggerBps,
            decision.covenants.reportingCadenceDays,
            decision.provenance.policyVersion,
            decision.provenance.decisionId,
            decision.provenance.sourceHash,
            decision.provenance.triggerType,
            decision.provenance.creditCommitteeFlags,
            decision.provenance.covenantSetHash
        );

        vm.expectRevert();
        forwarder.deliver(address(registry), "", report);
    }

    function testRejectInvalidLtvBounds() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        decision.maxLtvBps = 10_001;

        bytes memory report = _buildReport(borrower, assetId, 1, decision);

        vm.expectRevert("Invalid decision LTV");
        forwarder.deliver(address(registry), "", report);
    }

    function testIsApprovedOnlyForApprovedStatusesAndUnexpired() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 1);

        UnderwritingPolicyTypes.UnderwritingDecision memory conditional =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL);
        forwarder.deliver(address(registry), "", _buildReport(borrower, assetId, 1, conditional));
        assertTrue(registry.isApproved(borrower, assetId));

        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 1);
        UnderwritingPolicyTypes.UnderwritingDecision memory watchlist =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.WATCHLIST);
        forwarder.deliver(address(registry), "", _buildReport(borrower, assetId, 2, watchlist));
        assertFalse(registry.isApproved(borrower, assetId));
        assertTrue(registry.isWatchlist(borrower, assetId));

        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 1);
        UnderwritingPolicyTypes.UnderwritingDecision memory expired =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        expired.expiry = block.timestamp + 1;
        forwarder.deliver(address(registry), "", _buildReport(borrower, assetId, 3, expired));
        vm.warp(block.timestamp + 2);
        assertFalse(registry.isApproved(borrower, assetId));
        assertFalse(registry.isWatchlist(borrower, assetId));
    }

    function testBorrowBlockingAfterGracePeriodOnHardBreach() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 1);

        UnderwritingPolicyTypes.UnderwritingDecision memory approved =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        approved.gracePeriodEnd = block.timestamp + 3 days;
        forwarder.deliver(address(registry), "", _buildReport(borrower, assetId, 1, approved));

        registry.setCovenantBreachState(
            borrower,
            assetId,
            true,
            true,
            block.timestamp + 1 days,
            keccak256("DSCR_BREACH")
        );

        assertFalse(registry.isBorrowBlocked(borrower, assetId));
        vm.warp(block.timestamp + 2 days);
        assertTrue(registry.isBorrowBlocked(borrower, assetId));
    }

    function testEffectiveLtvTightensForWatchlistAndHardBreach() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 1);

        UnderwritingPolicyTypes.UnderwritingDecision memory watchlist =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.WATCHLIST);
        watchlist.maxLtvBps = 7000;
        watchlist.covenants.maxLtvBps = 6800;
        watchlist.provenance.covenantSetHash = registry.hashCovenantSet(watchlist.covenants);
        watchlist.gracePeriodEnd = block.timestamp + 1 days;
        forwarder.deliver(address(registry), "", _buildReport(borrower, assetId, 1, watchlist));

        // Watchlist haircut only: 6800 * (1 - 10%) = 6120
        assertEq(registry.effectiveMaxLtvBps(borrower, assetId), 6120);

        registry.setCovenantBreachState(
            borrower,
            assetId,
            true,
            false,
            block.timestamp + 1 days,
            keccak256("OCCUPANCY_DROP")
        );

        // During grace, hard breach haircut also applies: 6120 * (1 - 20%) = 4896
        assertEq(registry.effectiveMaxLtvBps(borrower, assetId), 4896);

        vm.warp(block.timestamp + 2 days);
        // After grace, post-grace haircut set to 100% => zero effective LTV
        assertEq(registry.effectiveMaxLtvBps(borrower, assetId), 0);
    }

    function testLifecycleRequestGeneratesReviewCycleId() public {
        registry.requestLifecycleUnderwriting(
            borrower,
            assetId,
            777 ether,
            UnderwritingPolicyTypes.TriggerType.EVENT_DRIVEN
        );

        UnderwritingPolicyTypes.RequestContext memory req =
            registry.getRequestContext(borrower, assetId);
        bytes32 cycleId = registry.getActiveReviewCycleId(borrower, assetId);

        assertEq(req.reviewCycleId, cycleId);
        assertTrue(cycleId != bytes32(0));
    }

    function testAuditDigestStoredAndVerifiable() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL);
        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        forwarder.deliver(address(registry), "", report);

        UnderwritingRegistryV2.DecisionDigestRef memory refs =
            registry.getDecisionDigestRef(borrower, assetId);

        assertEq(refs.inputSnapshotHash, decision.provenance.sourceHash);
        assertEq(refs.explanationHash, decision.reasoningHash);
        assertEq(refs.covenantSetHash, decision.provenance.covenantSetHash);
        assertEq(refs.nonce, 1);
        assertTrue(refs.auditDigest != bytes32(0));

        bool storedValid = registry.verifyStoredDecisionDigest(borrower, assetId);
        assertTrue(storedValid);

        bool digestValid = registry.verifyDecisionDigest(
            refs.auditDigest,
            refs.inputSnapshotHash,
            refs.policyHash,
            refs.decisionHash,
            refs.explanationHash
        );
        assertTrue(digestValid);
    }

    function testRejectsMismatchedCovenantSetHash() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        decision.provenance.covenantSetHash = keccak256("tampered");

        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        vm.expectRevert("Bad covenant hash");
        forwarder.deliver(address(registry), "", report);
    }

    function testRejectsWrongLoanProductForAssignedAsset() public {
        registry.setAssetLoanProduct(assetId, UnderwritingPolicyTypes.LoanProduct.BRIDGE);

        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL);
        decision.loanProduct = UnderwritingPolicyTypes.LoanProduct.STABILIZED_TERM;

        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        vm.expectRevert("Wrong loan product");
        forwarder.deliver(address(registry), "", report);
    }

    function testRejectsDecisionOutsideProductPolicyBounds() public {
        registry.setAssetLoanProduct(assetId, UnderwritingPolicyTypes.LoanProduct.BRIDGE);
        registry.setProductPolicy(
            UnderwritingPolicyTypes.LoanProduct.BRIDGE,
            UnderwritingPolicyTypes.ProductPolicy({
                enabled: true,
                minLtvBps: 5000,
                maxLtvBps: 7500,
                minRateBps: 900,
                maxRateBps: 1800,
                maxTenorDays: 180,
                maxReviewCadenceDays: 30,
                minDscrBps: 12000,
                maxDtiBps: 5000
            })
        );

        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL);
        decision.loanProduct = UnderwritingPolicyTypes.LoanProduct.BRIDGE;
        decision.rateBps = 800;

        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        vm.expectRevert("Rate below product min");
        forwarder.deliver(address(registry), "", report);
    }

    function testAcceptsDecisionWithinProductPolicyBounds() public {
        registry.setAssetLoanProduct(assetId, UnderwritingPolicyTypes.LoanProduct.BRIDGE);
        registry.setProductPolicy(
            UnderwritingPolicyTypes.LoanProduct.BRIDGE,
            UnderwritingPolicyTypes.ProductPolicy({
                enabled: true,
                minLtvBps: 5000,
                maxLtvBps: 7500,
                minRateBps: 900,
                maxRateBps: 1800,
                maxTenorDays: 180,
                maxReviewCadenceDays: 30,
                minDscrBps: 12000,
                maxDtiBps: 5000
            })
        );

        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 25_000 ether);

        UnderwritingPolicyTypes.UnderwritingDecision memory decision =
            _buildDecision(UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL);
        decision.loanProduct = UnderwritingPolicyTypes.LoanProduct.BRIDGE;
        decision.expiry = block.timestamp + 120 days;
        decision.nextReviewAt = block.timestamp + 20 days;
        decision.rateBps = 1200;
        decision.maxLtvBps = 6500;
        decision.covenants.minDscrBps = 13000;
        decision.covenants.maxDtiBps = 4500;
        decision.provenance.covenantSetHash = registry.hashCovenantSet(decision.covenants);

        bytes memory report = _buildReport(borrower, assetId, 1, decision);
        forwarder.deliver(address(registry), "", report);

        UnderwritingPolicyTypes.UnderwritingDecision memory stored =
            registry.getDecision(borrower, assetId);
        assertEq(uint8(stored.loanProduct), uint8(UnderwritingPolicyTypes.LoanProduct.BRIDGE));
        assertEq(stored.rateBps, 1200);
    }
}
