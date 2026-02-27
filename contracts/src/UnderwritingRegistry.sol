// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ReceiverTemplate.sol";

contract UnderwritingRegistry is ReceiverTemplate {
    struct UnderwritingTerms {
        bool approved;
        uint16 maxLtvBps;
        uint16 rateBps;
        uint256 creditLimit;
        uint256 expiry;
        bytes32 reasoningHash;
    }

    mapping(address => mapping(uint256 => UnderwritingTerms)) public terms;
    mapping(address => mapping(uint256 => uint256)) public requestedBorrowAmount;
    mapping(address => mapping(uint256 => uint64)) public requestNonce;
    mapping(address => mapping(uint256 => bool)) public underwritingPending;

    event UnderwritingRequested(
        address indexed borrower,
        uint256 indexed assetId,
        uint256 intendedBorrowAmount,
        uint64 nonce
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
        uint64 nonce = ++requestNonce[msg.sender][assetId];
        requestedBorrowAmount[msg.sender][assetId] = intendedBorrowAmount;
        underwritingPending[msg.sender][assetId] = true;
        emit UnderwritingRequested(msg.sender, assetId, intendedBorrowAmount, nonce);
    }

    // ------------------------------------------------------------
    // CRE Entry
    // ------------------------------------------------------------

    function _processReport(bytes calldata report) internal override {
        (
            address borrower,
            uint256 assetId,
            uint64 nonce,
            UnderwritingTerms memory t
        ) = _decodeReport(report);

        require(borrower != address(0), "Invalid borrower");
        require(t.maxLtvBps <= 10_000, "Invalid LTV");
        require(t.expiry > block.timestamp, "Invalid expiry");
        require(underwritingPending[borrower][assetId], "No pending request");
        require(nonce == requestNonce[borrower][assetId], "Bad nonce");

        terms[borrower][assetId] = t;

        delete requestedBorrowAmount[borrower][assetId];
        delete underwritingPending[borrower][assetId];

        emit UnderwritingUpdated(
            borrower,
            assetId,
            t.approved,
            t.maxLtvBps,
            t.rateBps,
            t.expiry,
            t.reasoningHash
        );
    }

    function _decodeReport(bytes calldata report) internal pure returns (
        address borrower,
        uint256 assetId,
        uint64 nonce,
        UnderwritingTerms memory t
    ) {
        (
            borrower,
            assetId,
            nonce,
            t.approved,
            t.maxLtvBps,
            t.rateBps,
            t.creditLimit,
            t.expiry,
            t.reasoningHash
        ) = abi.decode(
            report,
            (address, uint256, uint64, bool, uint16, uint16, uint256, uint256, bytes32)
        );
    }

    // ------------------------------------------------------------
    // View Helpers
    // ------------------------------------------------------------

    function getTerms(address borrower, uint256 assetId)
        external
        view
        returns (bool, uint16, uint16, uint256, uint256, bytes32)
    {
        UnderwritingTerms storage t = terms[borrower][assetId];
        return (t.approved, t.maxLtvBps, t.rateBps, t.creditLimit, t.expiry, t.reasoningHash);
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
