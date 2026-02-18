// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "../src/interface/ICashFlowLogic.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockNAVOracle.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWALendingPoolTest is Test {
    RWALendingPool pool;
    MockERC20 stable;
    MockUnderwriting underwriting;
    MockNAVOracle navOracle;
    MockERC20 collateralToken;
    MockCashFlowLogic cashFlowLogic;

    address borrower = address(0xBEEF);

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        underwriting = new MockUnderwriting();
        navOracle = new MockNAVOracle();
        collateralToken = new MockERC20("Collateral", "COL");
        cashFlowLogic = new MockCashFlowLogic(1000 ether);

        pool = new RWALendingPool(
            address(stable),
            address(underwriting),
            address(navOracle)
        );

        // Provide liquidity to pool
        stable.mint(address(pool), 1_000_000 ether);

        // Set asset token mapping
        vm.prank(address(pool.owner()));
        pool.setAssetToken(1, address(collateralToken));

        // Set asset logic mapping
        vm.prank(address(pool.owner()));
        pool.setAssetLogic(1, address(cashFlowLogic));

        vm.startPrank(borrower);
        stable.mint(borrower, 1_000_000 ether);
        collateralToken.mint(borrower, 1_000_000 ether);
        stable.approve(address(pool), type(uint256).max);
        collateralToken.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------
    // Borrow success
    // ------------------------------------------------------------

    function testBorrowSuccess() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Deposit collateral first
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 400 ether);

        assertEq(stable.balanceOf(borrower), 1_000_400 ether);
    }

    // ------------------------------------------------------------
    // LTV enforcement
    // ------------------------------------------------------------

    function testBorrowFailsIfExceedsLTV() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp + 1 days
        );

        // Deposit collateral first
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 600_000 ether);
    }

    // ------------------------------------------------------------
    // Expiry enforcement
    // ------------------------------------------------------------

    function testBorrowFailsIfExpired() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp - 1
        );

        vm.prank(borrower);
        vm.expectRevert("Not approved");
        pool.borrow(1, 400 ether);
    }

    // ------------------------------------------------------------
    // Health factor
    // ------------------------------------------------------------

    function testHealthFactor() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Deposit collateral first
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 400 ether);

        uint256 health = pool.healthFactor(borrower, 1);
        // Collateral value = 1000e18 * 1000e18 / 1e18 = 1e24, max borrow = 1e24 * 0.5 = 5e23
        // debt = 400e18, so health = (5e23 * 1e18) / 400e18 = 1.25e21
        assertEq(health, 1.25e21);
    }

    // ------------------------------------------------------------
    // Repay
    // ------------------------------------------------------------

    function testRepayReducesPrincipal() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 10 days
        );

        // Deposit collateral first
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500 ether);

        vm.prank(borrower);
        pool.repay(1, 200 ether);

        // Check that the debt was reduced
        (uint256 principal,) = pool.debt(borrower, 1);
        assertEq(principal, 300 ether);

    }

    // ------------------------------------------------------------
    // Liquidation
    // ------------------------------------------------------------

    function testFullLiquidation() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp + 1 days
        );

        // Borrower deposits collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500 ether);

        // Drop NAV significantly to make unhealthy
        navOracle.setNAV(1, 1);

        address liquidator = address(0xCAFE);

        stable.mint(liquidator, 1000 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);

        pool.liquidate(borrower, 1, 500 ether); // repay full debt
        vm.stopPrank();

        // Debt should be > zero
        (uint256 principal,) = pool.debt(borrower, 1);
        assertGt(principal, 0); // bad debt remains
        assertEq(pool.collateral(borrower, 1), 0);

        assertGt(collateralToken.balanceOf(liquidator), 0);
    }

    function testPartialLiquidation() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500 ether);

        navOracle.setNAV(1, 0.9 ether); // Makes position unhealthy (health factor < 0.95)

        address liquidator = address(0xCAFE);
        stable.mint(liquidator, 500 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);

        pool.liquidate(borrower, 1, 200 ether);
        vm.stopPrank();

        (uint256 principal,) = pool.debt(borrower, 1);
        assertEq(principal, 300 ether);
        // After partial liquidation, some collateral should remain
        assertGt(pool.collateral(borrower, 1), 0);
    }

    // ------------------------------------------------------------
    // Liquidation Bonus
    // ------------------------------------------------------------

    function testLiquidationBonusSetting() public {
        // Test that owner can set liquidation bonus
        vm.prank(address(pool.owner()));
        pool.setLiquidationBonus(11000); // 110%

        assertEq(pool.liquidationBonusBps(), 11000);
    }

    function testLiquidationBonusMinimum() public {
        vm.startPrank(address(pool.owner()));
        vm.expectRevert("Must be >=100%");
        pool.setLiquidationBonus(9999); // Less than 100%
        vm.stopPrank();
    }

    // ------------------------------------------------------------
    // Dynamic LTV + Health Factor Tests
    // ------------------------------------------------------------

    function testEffectiveLTVWithPerformingHealth() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        // Set underwriting LTV to 50%
        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Set cashflow health to PERFORMING (100% multiplier)
        cashFlowLogic.setHealth(CashflowHealth.PERFORMING);

        // Deposit collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // With 50% underwriting LTV and 100% health multiplier, effective LTV should be 50%
        vm.prank(borrower);
        pool.borrow(1, 500 ether); // Should succeed

        // Try to borrow more than 50% - should fail
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 1 ether);
    }

    function testEffectiveLTVWithGracePeriodHealth() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        // Set underwriting LTV to 50%
        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Set cashflow health to GRACE_PERIOD (80% multiplier)
        cashFlowLogic.setHealth(CashflowHealth.GRACE_PERIOD);

        // Deposit collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // With 50% underwriting LTV and 80% health multiplier, effective LTV should be 40%
        vm.prank(borrower);
        pool.borrow(1, 400 ether); // Should succeed

        // Try to borrow more than 40% - should fail
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 1 ether);
    }

    function testEffectiveLTVWithLateHealth() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        // Set underwriting LTV to 50%
        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Set cashflow health to LATE (50% multiplier)
        cashFlowLogic.setHealth(CashflowHealth.LATE);

        // Deposit collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // With 50% underwriting LTV and 50% health multiplier, effective LTV should be 25%
        vm.prank(borrower);
        pool.borrow(1, 250 ether); // Should succeed

        // Try to borrow more than 25% - should fail
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 1 ether);
    }

    function testEffectiveLTVWithDefaultedHealth() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        // Set underwriting LTV to 50%
        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Set cashflow health to DEFAULTED (0% multiplier)
        cashFlowLogic.setHealth(CashflowHealth.DEFAULTED);

        // Deposit collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // With 50% underwriting LTV and 0% health multiplier, effective LTV should be 0%
        vm.expectRevert("Exceeds LTV");
        vm.prank(borrower);
        pool.borrow(1, 1 ether); // Should fail
    }

    function testHealthFactorChangesWithAssetHealth() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        // Set underwriting LTV to 80% (higher than health cap for LATE)
        underwriting.setTerms(
            true,
            8000, // 80% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        // Set cashflow health to PERFORMING initially
        cashFlowLogic.setHealth(CashflowHealth.PERFORMING);

        // Deposit collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // Borrow the maximum allowed with performing health (80% of collateral value)
        vm.prank(borrower);
        pool.borrow(1, 800 ether); // Borrow 800 out of possible 800 (80% of 1000 with 100% health)

        // Health factor should be close to 1.0 (800,000 * 1e18) / 800,000 = 1.0e18
        uint256 healthBefore = pool.healthFactor(borrower, 1);

        // Change health to LATE (50% multiplier)
        cashFlowLogic.setHealth(CashflowHealth.LATE);

        // Reduce NAV to make position definitely liquidatable
        navOracle.setNAV(1, 0.9 ether);

        // Health factor should now be much lower
        uint256 healthAfter = pool.healthFactor(borrower, 1);

        // Health factor should decrease when asset health deteriorates
        assertLt(healthAfter, healthBefore);

        // Position should now be liquidatable since health factor < 0.95e18
        assertTrue(pool.isLiquidatable(borrower, 1));
    }

    // ------------------------------------------------------------
    // Dynamic LTV Stress Tests
    // ------------------------------------------------------------

    function testDynamicLTVStress() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            6000, // 60%
            1000,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // Performing
        cashFlowLogic.setHealth(CashflowHealth.PERFORMING);

        vm.prank(borrower);
        pool.borrow(1, 600_000 ether); // Borrow up to original max (60% of 1M collateral value)

        uint256 health1 = pool.healthFactor(borrower, 1);

        // Move to LATE (50% cap) - this should make the position liquidatable
        // since we borrowed against the higher cap
        cashFlowLogic.setHealth(CashflowHealth.LATE);

        uint256 health2 = pool.healthFactor(borrower, 1);

        assertLt(health2, health1);
        // After health deterioration, the position should be liquidatable
        assertTrue(pool.isLiquidatable(borrower, 1));
    }

    // ------------------------------------------------------------
    // Health Factor Boundary Tests
    // ------------------------------------------------------------

    function testHealthFactorExactlyOne() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500_000 ether); // Borrow 500,000 out of 500,000 (50% of 1M with 100% health)

        uint256 hf = pool.healthFactor(borrower, 1);

        // With equal borrow and max borrowable, health factor should be 1.0
        // Max borrowable = 1000e18 * 1000e18 / 1e18 * 0.5 = 500,000e18
        // Debt = 500,000e18
        // Health factor = (500,000e18 * 1e18) / 500,000e18 = 1e18
        assertEq(hf, 1e18);
    }

    function testHealthFactorBelowLiquidationThreshold() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            8000, // 80% LTV
            0,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 800 ether); // Borrow near the max to make position sensitive

        // Reduce NAV significantly to make the position unhealthy
        navOracle.setNAV(1, 0.5 ether);

        uint256 hf = pool.healthFactor(borrower, 1);

        assertTrue(hf < 0.95e18);
        assertTrue(pool.isLiquidatable(borrower, 1));
    }

    // ------------------------------------------------------------
    // NAV Staleness Test
    // ------------------------------------------------------------

    function testBorrowFailsIfNAVStale() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, false);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.expectRevert("Stale NAV");
        vm.prank(borrower);
        pool.borrow(1, 100 ether);
    }

    // ------------------------------------------------------------
    // Collateral Withdrawal Safety Test
    // ------------------------------------------------------------

    function testWithdrawRevertsIfUnhealthy() public {
        navOracle.setNAV(1, 1 ether); // Small NAV for tight math
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        // Collateral value = 1000
        // Max borrow = 500

        vm.prank(borrower);
        pool.borrow(1, 500 ether); // Exactly max

        // Now health factor = 1.0

        vm.expectRevert("Would become unhealthy");
        vm.prank(borrower);
        pool.withdrawCollateral(1, 1 ether); // Should revert
    }

    function testInterestMakesPositionLiquidatable() public {
        navOracle.setNAV(1, 1 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            8000, // 80%
            1000, // 10% APR
            block.timestamp + 365 days
        );

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 800 ether); // max

        vm.warp(block.timestamp + 365 days);

        assertTrue(pool.isLiquidatable(borrower, 1));
    }

    // --------------------------------------------------------
    function testFullLiquidationWithProtocolFee() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        pool.setProtocolLiquidationFee(200); // 2%

        // Borrower deposits collateral
        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500_000 ether);

        // Crash NAV hard
        navOracle.setNAV(1, 1 ether);

        address liquidator = address(0xCAFE);
        stable.mint(liquidator, 500 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);

        pool.liquidate(borrower, 1, 500 ether);
        vm.stopPrank();

        // Debt should be > zero
        (uint256 principal,) = pool.debt(borrower, 1);
        assertGt(principal, 0); // bad debt remains


        assertLt(pool.collateral(borrower, 1), 1000 ether);
        assertGt(pool.collateral(borrower, 1), 0);


        // Protocol should receive shares
        assertGt(collateralToken.balanceOf(pool.treasury()), 0);

        // Liquidator should receive shares
        assertGt(collateralToken.balanceOf(liquidator), 0);
    }

    function testExactLiquidationMath() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        pool.setProtocolLiquidationFee(200); // 2%
        pool.setLiquidationBonus(10500);     // 5%

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500_000 ether);

        navOracle.setNAV(1, 1 ether);

        address liquidator = address(0xCAFE);
        stable.mint(liquidator, 500 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);

        pool.liquidate(borrower, 1, 500 ether);
        vm.stopPrank();

        uint256 liquidatorShares = collateralToken.balanceOf(liquidator);
        uint256 protocolShares = collateralToken.balanceOf(pool.treasury());

        // Expected USD:
        // Liquidator: 500 * 1.05 = 525
        // Protocol: 500 * 0.02 = 10
        // Total USD seized = 535
        // NAV = 1 => 1 USD = 1 share

        assertEq(liquidatorShares, 525 ether);
        assertEq(protocolShares, 10 ether);
    }

    function testPartialLiquidationWithProtocolFee() public {
        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 1 days
        );

        pool.setProtocolLiquidationFee(200);

        vm.prank(borrower);
        pool.depositCollateral(1, 1000 ether);

        vm.prank(borrower);
        pool.borrow(1, 500_000 ether);


        navOracle.setNAV(1, 1 ether);

        address liquidator = address(0xCAFE);
        stable.mint(liquidator, 200 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);

        pool.liquidate(borrower, 1, 200 ether);
        vm.stopPrank();

        // Liquidator USD = 200 * 1.05 = 210
        // Protocol USD = 200 * 0.02 = 4
        // Total = 214 shares (NAV=1)

        assertEq(collateralToken.balanceOf(liquidator), 210 ether);
        assertEq(collateralToken.balanceOf(pool.treasury()), 4 ether);

        // Debt should now be 300
        (uint256 principal,) = pool.debt(borrower, 1);
        assertLt(principal, 500_000 ether);
        assertGt(principal, 0);

    }

    function testProtocolFeeCap() public {
        vm.prank(pool.owner());
        vm.expectRevert("Fee too high");
        pool.setProtocolLiquidationFee(5000); // 50%
    }



}
