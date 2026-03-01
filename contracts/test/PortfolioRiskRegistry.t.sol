// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PortfolioRiskRegistry.sol";

contract PortfolioRiskRegistryTest is Test {
    PortfolioRiskRegistry internal riskRegistry;
    address internal admin = address(0xABCD);
    address internal operator = address(0xBEEF);

    bytes32 internal segmentId = keccak256("US-MULTIFAMILY-MIAMI");
    uint256 internal assetId = 1;

    function setUp() public {
        vm.prank(admin);
        riskRegistry = new PortfolioRiskRegistry(admin);

        vm.prank(admin);
        riskRegistry.setRiskOperator(operator, true);

        vm.prank(operator);
        riskRegistry.configureSegment(
            segmentId,
            false,
            500, // 5%
            10_000_000 ether,
            1000, // 10%
            2500 // 25%
        );

        vm.prank(operator);
        riskRegistry.assignAssetSegment(assetId, segmentId);
    }

    function testBorrowAllowedWhenHealthySegment() public {
        vm.prank(operator);
        riskRegistry.updateSegmentExposure(
            segmentId,
            1_000_000 ether,
            100_000 ether, // 10%
            50_000 ether // 5%
        );

        assertTrue(riskRegistry.isBorrowAllowed(assetId));
    }

    function testBorrowBlockedOnThresholdBreach() public {
        vm.prank(operator);
        riskRegistry.updateSegmentExposure(
            segmentId,
            1_000_000 ether,
            300_000 ether, // 30% > 25%
            120_000 ether // 12% > 10%
        );

        assertFalse(riskRegistry.isBorrowAllowed(assetId));
    }

    function testApplySegmentHaircut() public view {
        uint16 adjusted = riskRegistry.applySegmentHaircut(assetId, 7000);
        assertEq(adjusted, 6650); // 7000 * 95%
    }

    function testApplyHardThrottleAfterBreach() public {
        vm.prank(operator);
        riskRegistry.updateSegmentExposure(
            segmentId,
            20_000_000 ether, // > max exposure
            100_000 ether,
            10_000 ether
        );

        uint16 adjusted = riskRegistry.applySegmentHaircut(assetId, 7000);
        assertEq(adjusted, 0);
    }
}
