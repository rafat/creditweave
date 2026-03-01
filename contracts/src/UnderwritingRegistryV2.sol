// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ReceiverTemplate.sol";
import "./UnderwritingPolicyTypes.sol";

contract UnderwritingRegistryV2 is ReceiverTemplate {
    using UnderwritingPolicyTypes for UnderwritingPolicyTypes.UnderwritingDecision;

    struct DecisionDigestRef {
        bytes32 inputSnapshotHash;
        bytes32 policyHash;
        bytes32 covenantSetHash;
        bytes32 decisionHash;
        bytes32 explanationHash;
        bytes32 auditDigest;
        bytes32 reviewCycleId;
        uint64 nonce;
        uint256 updatedAt;
    }

    mapping(address => mapping(uint256 => UnderwritingPolicyTypes.UnderwritingDecision)) private s_decisions;
    mapping(address => mapping(uint256 => UnderwritingPolicyTypes.RequestContext)) private s_requests;
    mapping(address => mapping(uint256 => UnderwritingPolicyTypes.CovenantBreachState)) private s_breachState;
    mapping(address => mapping(uint256 => DecisionDigestRef)) private s_digestRefs;
    mapping(UnderwritingPolicyTypes.LoanProduct => UnderwritingPolicyTypes.ProductPolicy) private s_productPolicies;
    mapping(uint256 => UnderwritingPolicyTypes.LoanProduct) private s_assetProducts;

    uint16 public watchlistLtvHaircutBps = 1_000;
    uint16 public conditionalApprovalHaircutBps = 300;
    uint16 public hardBreachGraceHaircutBps = 2_000;
    uint16 public postGraceHardBreachHaircutBps = 10_000;

    event UnderwritingRequested(
        address indexed borrower,
        uint256 indexed assetId,
        uint256 intendedBorrowAmount,
        uint64 nonce,
        UnderwritingPolicyTypes.TriggerType triggerType
    );

    event UnderwritingUpdated(
        address indexed borrower,
        uint256 indexed assetId,
        uint64 nonce,
        UnderwritingPolicyTypes.LoanProduct loanProduct,
        UnderwritingPolicyTypes.DecisionStatus status,
        uint16 maxLtvBps,
        uint16 rateBps,
        uint256 creditLimit,
        uint256 expiry,
        uint256 nextReviewAt,
        uint256 gracePeriodEnd,
        bytes32 reasoningHash,
        bytes32 policyVersion,
        bytes32 decisionId,
        bytes32 sourceHash,
        bytes32 covenantSetHash
    );

    event CovenantStateUpdated(
        address indexed borrower,
        uint256 indexed assetId,
        bool hardBreach,
        bool cashTrapActive,
        uint256 breachedAt,
        uint256 gracePeriodEnd,
        bytes32 breachReason
    );

    event LtvHaircutsUpdated(
        uint16 watchlistHaircutBps,
        uint16 conditionalApprovalHaircutBps,
        uint16 hardBreachGraceHaircutBps,
        uint16 postGraceHardBreachHaircutBps
    );

    event ProductPolicyConfigured(
        UnderwritingPolicyTypes.LoanProduct indexed loanProduct,
        bool enabled,
        uint16 minLtvBps,
        uint16 maxLtvBps,
        uint16 minRateBps,
        uint16 maxRateBps,
        uint32 maxTenorDays,
        uint32 maxReviewCadenceDays,
        uint16 minDscrBps,
        uint16 maxDtiBps
    );

    event AssetProductSet(
        uint256 indexed assetId,
        UnderwritingPolicyTypes.LoanProduct indexed loanProduct
    );

    event AuditDigestStored(
        address indexed borrower,
        uint256 indexed assetId,
        uint64 nonce,
        bytes32 indexed auditDigest,
        bytes32 inputSnapshotHash,
        bytes32 policyHash,
        bytes32 decisionHash,
        bytes32 explanationHash,
        bytes32 reviewCycleId
    );

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    function requestUnderwriting(uint256 assetId, uint256 intendedBorrowAmount) external {
        _requestFor(msg.sender, assetId, intendedBorrowAmount, UnderwritingPolicyTypes.TriggerType.NEW);
    }

    function requestLifecycleUnderwriting(
        address borrower,
        uint256 assetId,
        uint256 intendedBorrowAmount,
        UnderwritingPolicyTypes.TriggerType triggerType
    ) external onlyOwner {
        require(borrower != address(0), "Invalid borrower");
        _requestFor(borrower, assetId, intendedBorrowAmount, triggerType);
    }

    function _requestFor(
        address borrower,
        uint256 assetId,
        uint256 intendedBorrowAmount,
        UnderwritingPolicyTypes.TriggerType triggerType
    ) internal {
        require(assetId > 0, "Invalid assetId");

        UnderwritingPolicyTypes.RequestContext storage request = s_requests[borrower][assetId];
        uint64 nonce = request.nonce + 1;

        request.intendedBorrowAmount = intendedBorrowAmount;
        request.nonce = nonce;
        request.pending = true;
        request.triggerType = triggerType;
        request.requestedAt = block.timestamp;
        request.reviewCycleId = keccak256(
            abi.encode(borrower, assetId, nonce, triggerType, block.timestamp)
        );
        request.loanProduct = s_assetProducts[assetId];

        emit UnderwritingRequested(
            borrower,
            assetId,
            intendedBorrowAmount,
            nonce,
            triggerType
        );
    }

    function _processReport(bytes calldata report) internal override {
        (
            address borrower,
            uint256 assetId,
            uint64 nonce,
            UnderwritingPolicyTypes.UnderwritingDecision memory decision
        ) = abi.decode(
            report,
            (address, uint256, uint64, UnderwritingPolicyTypes.UnderwritingDecision)
        );

        _validateIncomingDecision(borrower, assetId, nonce, decision);
        UnderwritingPolicyTypes.RequestContext storage request = s_requests[borrower][assetId];

        bytes32 covenantSetHash = hashCovenantSet(decision.covenants);
        require(
            decision.provenance.covenantSetHash == covenantSetHash,
            "Bad covenant hash"
        );
        bytes32 policyHash = hashPolicy(
            decision.provenance.policyVersion,
            decision.provenance.creditCommitteeFlags
        );
        bytes32 decisionHash = hashDecisionPayload(
            borrower,
            assetId,
            nonce,
            decision,
            request.reviewCycleId,
            covenantSetHash,
            policyHash
        );
        bytes32 auditDigest = hashAuditDigest(
            decision.provenance.sourceHash,
            policyHash,
            decisionHash,
            decision.reasoningHash
        );

        s_decisions[borrower][assetId] = decision;
        s_digestRefs[borrower][assetId] = DecisionDigestRef({
            inputSnapshotHash: decision.provenance.sourceHash,
            policyHash: policyHash,
            covenantSetHash: covenantSetHash,
            decisionHash: decisionHash,
            explanationHash: decision.reasoningHash,
            auditDigest: auditDigest,
            reviewCycleId: request.reviewCycleId,
            nonce: nonce,
            updatedAt: block.timestamp
        });

        delete s_requests[borrower][assetId].intendedBorrowAmount;
        s_requests[borrower][assetId].pending = false;
        s_requests[borrower][assetId].requestedAt = block.timestamp;

        emit UnderwritingUpdated(
            borrower,
            assetId,
            nonce,
            decision.loanProduct,
            decision.status,
            decision.maxLtvBps,
            decision.rateBps,
            decision.creditLimit,
            decision.expiry,
            decision.nextReviewAt,
            decision.gracePeriodEnd,
            decision.reasoningHash,
            decision.provenance.policyVersion,
            decision.provenance.decisionId,
            decision.provenance.sourceHash,
            decision.provenance.covenantSetHash
        );
        emit AuditDigestStored(
            borrower,
            assetId,
            nonce,
            auditDigest,
            decision.provenance.sourceHash,
            policyHash,
            decisionHash,
            decision.reasoningHash,
            request.reviewCycleId
        );
    }

    function _validateIncomingDecision(
        address borrower,
        uint256 assetId,
        uint64 nonce,
        UnderwritingPolicyTypes.UnderwritingDecision memory decision
    ) internal view {
        require(borrower != address(0), "Invalid borrower");
        require(assetId > 0, "Invalid assetId");
        require(decision.expiry > block.timestamp, "Invalid expiry");
        require(decision.maxLtvBps <= 10_000, "Invalid decision LTV");
        require(decision.covenants.maxLtvBps <= 10_000, "Invalid covenant LTV");
        require(
            uint8(decision.status) <= uint8(UnderwritingPolicyTypes.DecisionStatus.DENIED),
            "Invalid status"
        );

        UnderwritingPolicyTypes.RequestContext storage request = s_requests[borrower][assetId];
        require(request.pending, "No pending request");
        require(nonce == request.nonce, "Bad nonce");
        if (request.loanProduct != UnderwritingPolicyTypes.LoanProduct.UNSPECIFIED) {
            require(decision.loanProduct == request.loanProduct, "Wrong loan product");
        }
        _validateProductPolicy(decision);
    }

    function _validateProductPolicy(UnderwritingPolicyTypes.UnderwritingDecision memory decision)
        internal
        view
    {
        UnderwritingPolicyTypes.ProductPolicy storage policy = s_productPolicies[decision.loanProduct];
        if (!policy.enabled) return;

        require(decision.maxLtvBps >= policy.minLtvBps, "LTV below product min");
        require(decision.maxLtvBps <= policy.maxLtvBps, "LTV above product max");
        require(decision.rateBps >= policy.minRateBps, "Rate below product min");
        require(decision.rateBps <= policy.maxRateBps, "Rate above product max");

        if (policy.maxTenorDays > 0) {
            require(
                decision.expiry <= block.timestamp + uint256(policy.maxTenorDays) * 1 days,
                "Tenor exceeds product max"
            );
        }
        if (policy.maxReviewCadenceDays > 0 && decision.nextReviewAt > 0) {
            require(
                decision.nextReviewAt <= block.timestamp + uint256(policy.maxReviewCadenceDays) * 1 days,
                "Review cadence too slow"
            );
        }
        if (policy.minDscrBps > 0) {
            require(
                decision.covenants.minDscrBps >= policy.minDscrBps,
                "DSCR below product min"
            );
        }
        if (policy.maxDtiBps > 0) {
            require(
                decision.covenants.maxDtiBps <= policy.maxDtiBps,
                "DTI above product max"
            );
        }
    }

    function getDecision(address borrower, uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.UnderwritingDecision memory)
    {
        return s_decisions[borrower][assetId];
    }

    function getCovenants(address borrower, uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.CovenantSet memory)
    {
        return s_decisions[borrower][assetId].covenants;
    }

    function getProvenance(address borrower, uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.DecisionProvenance memory)
    {
        return s_decisions[borrower][assetId].provenance;
    }

    function getRequestContext(address borrower, uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.RequestContext memory)
    {
        return s_requests[borrower][assetId];
    }

    function setAssetLoanProduct(uint256 assetId, UnderwritingPolicyTypes.LoanProduct loanProduct)
        external
        onlyOwner
    {
        require(assetId > 0, "Invalid assetId");
        require(
            loanProduct != UnderwritingPolicyTypes.LoanProduct.UNSPECIFIED,
            "Invalid loan product"
        );
        s_assetProducts[assetId] = loanProduct;
        emit AssetProductSet(assetId, loanProduct);
    }

    function getAssetLoanProduct(uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.LoanProduct)
    {
        return s_assetProducts[assetId];
    }

    function setProductPolicy(
        UnderwritingPolicyTypes.LoanProduct loanProduct,
        UnderwritingPolicyTypes.ProductPolicy calldata policy
    ) external onlyOwner {
        require(
            loanProduct != UnderwritingPolicyTypes.LoanProduct.UNSPECIFIED,
            "Invalid loan product"
        );
        require(policy.maxLtvBps <= 10_000, "Invalid product max LTV");
        require(policy.minLtvBps <= policy.maxLtvBps, "Bad LTV bounds");
        require(policy.minRateBps <= policy.maxRateBps, "Bad rate bounds");
        require(policy.maxDtiBps <= 10_000, "Invalid product max DTI");

        s_productPolicies[loanProduct] = policy;
        emit ProductPolicyConfigured(
            loanProduct,
            policy.enabled,
            policy.minLtvBps,
            policy.maxLtvBps,
            policy.minRateBps,
            policy.maxRateBps,
            policy.maxTenorDays,
            policy.maxReviewCadenceDays,
            policy.minDscrBps,
            policy.maxDtiBps
        );
    }

    function getProductPolicy(UnderwritingPolicyTypes.LoanProduct loanProduct)
        external
        view
        returns (UnderwritingPolicyTypes.ProductPolicy memory)
    {
        return s_productPolicies[loanProduct];
    }

    function getActiveReviewCycleId(address borrower, uint256 assetId)
        external
        view
        returns (bytes32)
    {
        return s_requests[borrower][assetId].reviewCycleId;
    }

    function getRequestedBorrowAmount(address borrower, uint256 assetId)
        external
        view
        returns (uint256)
    {
        return s_requests[borrower][assetId].intendedBorrowAmount;
    }

    function getDecisionDigestRef(address borrower, uint256 assetId)
        external
        view
        returns (DecisionDigestRef memory)
    {
        return s_digestRefs[borrower][assetId];
    }

    function verifyStoredDecisionDigest(address borrower, uint256 assetId)
        external
        view
        returns (bool)
    {
        DecisionDigestRef storage refs = s_digestRefs[borrower][assetId];
        if (refs.auditDigest == bytes32(0)) return false;
        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];

        bytes32 covenantSetHash = hashCovenantSet(decision.covenants);
        bytes32 policyHash = hashPolicy(
            decision.provenance.policyVersion,
            decision.provenance.creditCommitteeFlags
        );
        bytes32 decisionHash = hashDecisionPayload(
            borrower,
            assetId,
            refs.nonce,
            decision,
            refs.reviewCycleId,
            covenantSetHash,
            policyHash
        );
        bytes32 digest = hashAuditDigest(
            decision.provenance.sourceHash,
            policyHash,
            decisionHash,
            decision.reasoningHash
        );

        return digest == refs.auditDigest;
    }

    function isApproved(address borrower, uint256 assetId) public view returns (bool) {
        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];
        if (decision.expiry <= block.timestamp) return false;
        return
            decision.status == UnderwritingPolicyTypes.DecisionStatus.APPROVED_UNCONDITIONAL
                || decision.status == UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL;
    }

    function isWatchlist(address borrower, uint256 assetId) external view returns (bool) {
        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];
        if (decision.expiry <= block.timestamp) return false;
        return decision.status == UnderwritingPolicyTypes.DecisionStatus.WATCHLIST;
    }

    function getBorrowingTerms(address borrower, uint256 assetId)
        external
        view
        returns (
            uint16 maxLtvBps,
            uint16 rateBps,
            uint256 creditLimit,
            uint256 expiry
        )
    {
        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];
        return (
            decision.maxLtvBps,
            decision.rateBps,
            decision.creditLimit,
            decision.expiry
        );
    }

    function effectiveMaxLtvBps(address borrower, uint256 assetId)
        external
        view
        returns (uint16)
    {
        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];
        if (decision.expiry <= block.timestamp) return 0;

        uint16 effective = decision.maxLtvBps;
        uint16 covenantCap = decision.covenants.maxLtvBps;
        if (covenantCap > 0 && covenantCap < effective) {
            effective = covenantCap;
        }

        if (decision.status == UnderwritingPolicyTypes.DecisionStatus.WATCHLIST) {
            effective = _applyHaircut(effective, watchlistLtvHaircutBps);
        } else if (decision.status == UnderwritingPolicyTypes.DecisionStatus.APPROVED_CONDITIONAL) {
            effective = _applyHaircut(effective, conditionalApprovalHaircutBps);
        }

        UnderwritingPolicyTypes.CovenantBreachState storage breach = s_breachState[borrower][assetId];
        if (breach.hardBreach) {
            if (_isAfterGracePeriod(decision, breach)) {
                return _applyHaircut(effective, postGraceHardBreachHaircutBps);
            }
            effective = _applyHaircut(effective, hardBreachGraceHaircutBps);
        }

        return effective;
    }

    function isBorrowBlocked(address borrower, uint256 assetId)
        external
        view
        returns (bool)
    {
        if (!isApproved(borrower, assetId)) return true;
        UnderwritingPolicyTypes.CovenantBreachState storage breach = s_breachState[borrower][assetId];
        if (!breach.hardBreach) return false;

        UnderwritingPolicyTypes.UnderwritingDecision storage decision = s_decisions[borrower][assetId];
        return _isAfterGracePeriod(decision, breach);
    }

    function getCovenantState(address borrower, uint256 assetId)
        external
        view
        returns (UnderwritingPolicyTypes.CovenantBreachState memory)
    {
        return s_breachState[borrower][assetId];
    }

    function setCovenantBreachState(
        address borrower,
        uint256 assetId,
        bool hardBreach,
        bool cashTrapActive,
        uint256 gracePeriodEnd,
        bytes32 breachReason
    ) external onlyOwner {
        require(borrower != address(0), "Invalid borrower");
        require(assetId > 0, "Invalid assetId");

        UnderwritingPolicyTypes.CovenantBreachState storage breach = s_breachState[borrower][assetId];
        breach.hardBreach = hardBreach;
        breach.cashTrapActive = cashTrapActive;
        breach.breachReason = breachReason;

        if (hardBreach) {
            breach.breachedAt = block.timestamp;
            breach.gracePeriodEnd = gracePeriodEnd;
        } else {
            breach.breachedAt = 0;
            breach.gracePeriodEnd = 0;
        }

        emit CovenantStateUpdated(
            borrower,
            assetId,
            breach.hardBreach,
            breach.cashTrapActive,
            breach.breachedAt,
            breach.gracePeriodEnd,
            breach.breachReason
        );
    }

    function setLtvHaircuts(
        uint16 _watchlistLtvHaircutBps,
        uint16 _conditionalApprovalHaircutBps,
        uint16 _hardBreachGraceHaircutBps,
        uint16 _postGraceHardBreachHaircutBps
    ) external onlyOwner {
        require(_watchlistLtvHaircutBps <= 10_000, "Invalid watchlist haircut");
        require(_conditionalApprovalHaircutBps <= 10_000, "Invalid conditional haircut");
        require(_hardBreachGraceHaircutBps <= 10_000, "Invalid grace haircut");
        require(_postGraceHardBreachHaircutBps <= 10_000, "Invalid post-grace haircut");

        watchlistLtvHaircutBps = _watchlistLtvHaircutBps;
        conditionalApprovalHaircutBps = _conditionalApprovalHaircutBps;
        hardBreachGraceHaircutBps = _hardBreachGraceHaircutBps;
        postGraceHardBreachHaircutBps = _postGraceHardBreachHaircutBps;

        emit LtvHaircutsUpdated(
            watchlistLtvHaircutBps,
            conditionalApprovalHaircutBps,
            hardBreachGraceHaircutBps,
            postGraceHardBreachHaircutBps
        );
    }

    function hashCovenantSet(UnderwritingPolicyTypes.CovenantSet memory covenants)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                covenants.minDscrBps,
                covenants.maxDtiBps,
                covenants.maxLtvBps,
                covenants.maxVacancyBps,
                covenants.cashTrapTriggerBps,
                covenants.reportingCadenceDays
            )
        );
    }

    function hashPolicy(bytes32 policyVersion, bytes32 creditCommitteeFlags)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(policyVersion, creditCommitteeFlags));
    }

    function hashDecisionPayload(
        address borrower,
        uint256 assetId,
        uint64 nonce,
        UnderwritingPolicyTypes.UnderwritingDecision memory decision,
        bytes32 reviewCycleId,
        bytes32 covenantSetHash,
        bytes32 policyHash
    ) public pure returns (bytes32) {
        bytes32 termsHash = keccak256(
            abi.encode(
                decision.status,
                decision.maxLtvBps,
                decision.rateBps,
                decision.creditLimit,
                decision.expiry,
                decision.nextReviewAt,
                decision.gracePeriodEnd,
                decision.reasoningHash
            )
        );
        bytes32 provenanceHash = keccak256(
            abi.encode(
                decision.provenance.triggerType,
                decision.provenance.decisionId,
                decision.provenance.sourceHash
            )
        );
        return keccak256(
            abi.encode(
                borrower,
                assetId,
                nonce,
                reviewCycleId,
                decision.loanProduct,
                termsHash,
                provenanceHash,
                covenantSetHash,
                policyHash
            )
        );
    }

    function hashAuditDigest(
        bytes32 inputSnapshotHash,
        bytes32 policyHash,
        bytes32 decisionHash,
        bytes32 explanationHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(inputSnapshotHash, policyHash, decisionHash, explanationHash)
        );
    }

    function verifyDecisionDigest(
        bytes32 expectedDigest,
        bytes32 inputSnapshotHash,
        bytes32 policyHash,
        bytes32 decisionHash,
        bytes32 explanationHash
    ) external pure returns (bool) {
        return expectedDigest == hashAuditDigest(
            inputSnapshotHash,
            policyHash,
            decisionHash,
            explanationHash
        );
    }

    function _applyHaircut(uint16 baseLtvBps, uint16 haircutBps)
        internal
        pure
        returns (uint16)
    {
        uint256 adjusted = (uint256(baseLtvBps) * (10_000 - haircutBps)) / 10_000;
        return uint16(adjusted);
    }

    function _isAfterGracePeriod(
        UnderwritingPolicyTypes.UnderwritingDecision storage decision,
        UnderwritingPolicyTypes.CovenantBreachState storage breach
    ) internal view returns (bool) {
        uint256 graceEnd = breach.gracePeriodEnd;
        if (graceEnd == 0) {
            graceEnd = decision.gracePeriodEnd;
        }
        if (graceEnd == 0) {
            return true;
        }
        return block.timestamp > graceEnd;
    }
}
