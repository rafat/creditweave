// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ReceiverTemplate.sol";

contract UnderwritingRegistry is ReceiverTemplate {
    struct UnderwritingTerms {
        bool approved;
        uint16 maxLtvBps;
        uint16 rateBps;
        uint256 expiry;
        bytes32 reasoningHash;
    }

    mapping(address => mapping(uint256 => UnderwritingTerms)) public terms;
    mapping(address => mapping(uint256 => uint256)) public requestedBorrowAmount;

    event UnderwritingRequested(
        address indexed borrower,
        uint256 indexed assetId,
        uint256 intendedBorrowAmount
    );

    event UnderwritingUpdated(
        address indexed borrower,
        uint256 indexed assetId,
        bool approved,
        uint16 maxLtvBps,
        uint16 rateBps,
        uint256 expiry,
        bytes32 reasoningHash
    );

    constructor(address forwarder)
        ReceiverTemplate(forwarder)
    {}

    // ------------------------------------------------------------
    // User Request
    // ------------------------------------------------------------

    function requestUnderwriting(uint256 assetId) external {
        requestUnderwriting(assetId, 0);
    }

    function requestUnderwriting(uint256 assetId, uint256 intendedBorrowAmount) public {
        requestedBorrowAmount[msg.sender][assetId] = intendedBorrowAmount;
        emit UnderwritingRequested(msg.sender, assetId, intendedBorrowAmount);
    }

    // ------------------------------------------------------------
    // CRE Entry
    // ------------------------------------------------------------

    function _processReport(bytes calldata report) internal override {
        (
            address borrower,
            uint256 assetId,
            bool approved,
            uint16 maxLtvBps,
            uint16 rateBps,
            uint256 expiry,
            bytes32 reasoningHash
        ) = abi.decode(
            report,
            (address, uint256, bool, uint16, uint16, uint256, bytes32)
        );

        require(borrower != address(0), "Invalid borrower");
        require(maxLtvBps <= 10_000, "Invalid LTV");
        require(expiry > block.timestamp, "Invalid expiry");

        terms[borrower][assetId] = UnderwritingTerms({
            approved: approved,
            maxLtvBps: maxLtvBps,
            rateBps: rateBps,
            expiry: expiry,
            reasoningHash: reasoningHash
        });
        delete requestedBorrowAmount[borrower][assetId];

        emit UnderwritingUpdated(
            borrower,
            assetId,
            approved,
            maxLtvBps,
            rateBps,
            expiry,
            reasoningHash
        );
    }

    // ------------------------------------------------------------
    // View Helpers
    // ------------------------------------------------------------

    function getTerms(address borrower, uint256 assetId)
        external
        view
        returns (bool, uint16, uint16, uint256, bytes32)
    {
        UnderwritingTerms storage t = terms[borrower][assetId];
        return (t.approved, t.maxLtvBps, t.rateBps, t.expiry, t.reasoningHash);
    }

    function isApproved(address borrower, uint256 assetId)
        external
        view
        returns (bool)
    {
        UnderwritingTerms storage t = terms[borrower][assetId];
        return t.approved && t.expiry > block.timestamp;
    }

    function getRequestedBorrowAmount(address borrower, uint256 assetId)
        external
        view
        returns (uint256)
    {
        return requestedBorrowAmount[borrower][assetId];
    }
}
