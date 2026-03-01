// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "../src/PortfolioRiskRegistry.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockNAVOracle.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWALendingPoolPortfolioRiskTest is Test {
    RWALendingPool internal pool;
    PortfolioRiskRegistry internal riskRegistry;
    MockERC20 internal stable;
    MockERC20 internal collateralToken;
    MockUnderwriting internal underwriting;
    MockNAVOracle internal navOracle;
    MockCashFlowLogic internal cashFlowLogic;

    address internal borrower = address(0xBEEF);
    bytes32 internal segmentId = keccak256("US-MULTIFAMILY-LA");

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        collateralToken = new MockERC20("Collateral", "COL");
        underwriting = new MockUnderwriting();
        navOracle = new MockNAVOracle();
        cashFlowLogic = new MockCashFlowLogic(1000 ether);

        pool = new RWALendingPool(address(stable), address(underwriting), address(navOracle));
        riskRegistry = new PortfolioRiskRegistry(address(this));

        stable.mint(address(pool), 1_000_000 ether);

        pool.setAssetToken(1, address(collateralToken));
        pool.setAssetLogic(1, address(cashFlowLogic));
        pool.setPortfolioRiskRegistry(address(riskRegistry));

        riskRegistry.configureSegment(
            segmentId,
            false,
            2000, // 20% haircut
            10_000_000 ether,
            1000,
            2500
        );
        riskRegistry.assignAssetSegment(1, segmentId);
        riskRegistry.updateSegmentExposure(segmentId, 1_000_000 ether, 50_000 ether, 20_000 ether);

        underwriting.setTerms(true, 5000, 1000, block.timestamp + 7 days);
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        collateralToken.mint(borrower, 2_000 ether);
        stable.mint(borrower, 1_000 ether);

        vm.startPrank(borrower);
        collateralToken.approve(address(pool), type(uint256).max);
        stable.approve(address(pool), type(uint256).max);
        pool.depositCollateral(1, 1000 ether);
        vm.stopPrank();
    }

    function testBorrowBlockedWhenSegmentPaused() public {
        riskRegistry.configureSegment(
            segmentId,
            true,
            2000,
            10_000_000 ether,
            1000,
            2500
        );

        vm.prank(borrower);
        vm.expectRevert("Segment borrow paused");
        pool.borrow(1, 10 ether);
    }

    function testSegmentHaircutReducesBorrowCapacity() public {
        // Collateral value = 1,000,000. Base LTV=50% => 500,000.
        // Segment haircut=20% => 400,000 max.
        vm.prank(borrower);
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 410_000 ether);

        vm.prank(borrower);
        pool.borrow(1, 390_000 ether);
    }
}
