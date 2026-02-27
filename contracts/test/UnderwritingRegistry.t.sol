// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {UnderwritingRegistry} from "../src/UnderwritingRegistry.sol";
import "./mocks/MockForwarder.sol";

contract UnderwritingRegistryTest is Test {
    UnderwritingRegistry registry;
    MockForwarder forwarder;

    address borrower = address(0xBEEF);
    uint256 assetId = 1;

    event UnderwritingRequested(
        address indexed borrower,
        uint256 indexed assetId,
        uint256 intendedBorrowAmount,
        uint64 nonce
    );

    function setUp() public {
        forwarder = new MockForwarder();
        registry = new UnderwritingRegistry(address(forwarder));
    }

    function _buildReport(
        bool approved,
        uint16 maxLtvBps,
        uint16 rateBps,
        uint256 creditLimit,
        uint256 expiry,
        bytes32 reasoningHash
    ) internal view returns (bytes memory) {
        return abi.encode(
            borrower,
            assetId,
            uint64(1),
            approved,
            maxLtvBps,
            rateBps,
            creditLimit,
            expiry,
            reasoningHash
        );
    }

    // ------------------------------------------------------------
    // 1️⃣ Request emits event
    // ------------------------------------------------------------

    function testRequestUnderwritingEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit UnderwritingRequested(address(this), assetId, 5000, 1);

        registry.requestUnderwriting(assetId, 5000);
    }

    function testRequestUnderwritingStoresBorrowIntent() public {
        registry.requestUnderwriting(assetId, 12_345);
        uint256 requested = registry.getRequestedBorrowAmount(address(this), assetId);
        assertEq(requested, 12_345);
    }

    // ------------------------------------------------------------
    // 2️⃣ Only forwarder can call onReport
    // ------------------------------------------------------------

    function testOnReportFailsIfNotForwarder() public {
        bytes memory report = _buildReport(
            true,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1 days,
            keccak256("reason")
        );

        vm.expectRevert();
        registry.onReport("", report);
    }

    // ------------------------------------------------------------
    // 3️⃣ Valid report stores terms
    // ------------------------------------------------------------

    function testValidReportStoresTerms() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            true,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1 days,
            keccak256("reason")
        );

        forwarder.deliver(address(registry), "", report);

        (bool approved,,,,,) = registry.getTerms(borrower, assetId);
        (,uint16 maxLtvBps,,,,) = registry.getTerms(borrower, assetId);
        (,,uint16 rateBps,,,) = registry.getTerms(borrower, assetId);
        (,,,uint256 creditLimit,,) = registry.getTerms(borrower, assetId);
        (,,,,uint256 expiry,) = registry.getTerms(borrower, assetId);
        (,,,,,bytes32 reasoningHash) = registry.getTerms(borrower, assetId);

        assertTrue(approved);
        assertEq(maxLtvBps, 6000);
        assertEq(rateBps, 900);
        assertEq(creditLimit, 100_000 ether);
        assertGt(expiry, block.timestamp);
        assertEq(reasoningHash, keccak256("reason"));
        assertEq(registry.getRequestedBorrowAmount(borrower, assetId), 0);

    }

    // ------------------------------------------------------------
    // 4️⃣ Expired report rejected
    // ------------------------------------------------------------

    function testRejectExpiredReport() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            true,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp - 1,
            keccak256("reason")
        );

        vm.expectRevert("Invalid expiry");
        forwarder.deliver(address(registry), "", report);
    }

    // ------------------------------------------------------------
    // 5️⃣ Reject invalid LTV
    // ------------------------------------------------------------

    function testRejectInvalidLTV() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            true,
            uint16(15000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1 days,
            keccak256("reason")
        );

        vm.expectRevert("Invalid LTV");
        forwarder.deliver(address(registry), "", report);
    }

    // ------------------------------------------------------------
    // 6️⃣ isApproved logic
    // ------------------------------------------------------------

    function testIsApprovedTrue() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            true,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1 days,
            keccak256("reason")
        );

        forwarder.deliver(address(registry), "", report);

        bool approved = registry.isApproved(borrower, assetId);
        assertTrue(approved);
    }

    function testIsApprovedFalseIfExpired() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            true,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1,
            keccak256("reason")
        );

        forwarder.deliver(address(registry), "", report);

        vm.warp(block.timestamp + 2);

        bool approved = registry.isApproved(borrower, assetId);
        assertFalse(approved);
    }

    function testIsApprovedFalseIfDenied() public {
        vm.prank(borrower);
        registry.requestUnderwriting(assetId, 7_500);

        bytes memory report = _buildReport(
            false,
            uint16(6000),
            uint16(900),
            uint256(100_000 ether),
            block.timestamp + 1 days,
            keccak256("reason")
        );

        forwarder.deliver(address(registry), "", report);

        bool approved = registry.isApproved(borrower, assetId);
        assertFalse(approved);
    }
}
