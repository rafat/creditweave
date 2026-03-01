// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library UnderwritingPolicyTypes {
    enum TriggerType {
        NEW,
        SCHEDULED,
        EVENT_DRIVEN,
        MANUAL_OVERRIDE
    }

    enum DecisionStatus {
        APPROVED_UNCONDITIONAL,
        APPROVED_CONDITIONAL,
        WATCHLIST,
        DENIED
    }

    enum LoanProduct {
        UNSPECIFIED,
        BRIDGE,
        STABILIZED_TERM,
        CONSTRUCTION_LITE
    }

    struct ProductPolicy {
        bool enabled;
        uint16 minLtvBps;
        uint16 maxLtvBps;
        uint16 minRateBps;
        uint16 maxRateBps;
        uint32 maxTenorDays;
        uint32 maxReviewCadenceDays;
        uint16 minDscrBps;
        uint16 maxDtiBps;
    }

    struct CovenantSet {
        uint16 minDscrBps;
        uint16 maxDtiBps;
        uint16 maxLtvBps;
        uint16 maxVacancyBps;
        uint16 cashTrapTriggerBps;
        uint32 reportingCadenceDays;
    }

    struct DecisionProvenance {
        bytes32 policyVersion;
        bytes32 decisionId;
        bytes32 sourceHash;
        TriggerType triggerType;
        bytes32 creditCommitteeFlags;
        bytes32 covenantSetHash;
    }

    struct UnderwritingDecision {
        LoanProduct loanProduct;
        DecisionStatus status;
        uint16 maxLtvBps;
        uint16 rateBps;
        uint256 creditLimit;
        uint256 expiry;
        uint256 nextReviewAt;
        uint256 gracePeriodEnd;
        bytes32 reasoningHash;
        CovenantSet covenants;
        DecisionProvenance provenance;
    }

    struct RequestContext {
        uint256 intendedBorrowAmount;
        uint64 nonce;
        bool pending;
        TriggerType triggerType;
        uint256 requestedAt;
        bytes32 reviewCycleId;
        LoanProduct loanProduct;
    }

    struct CovenantBreachState {
        bool hardBreach;
        bool cashTrapActive;
        uint256 breachedAt;
        uint256 gracePeriodEnd;
        bytes32 breachReason;
    }
}
