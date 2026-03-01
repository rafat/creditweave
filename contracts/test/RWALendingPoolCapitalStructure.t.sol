// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "../src/LossWaterfall.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockNAVOracle.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWALendingPoolCapitalStructureTest is Test {
    RWALendingPool internal pool;
    LossWaterfall internal waterfall;
    MockERC20 internal stable;
    MockERC20 internal collateralToken;
    MockUnderwriting internal underwriting;
    MockNAVOracle internal navOracle;
    MockCashFlowLogic internal cashFlowLogic;

    address internal borrower = address(0xBEEF);
    address internal liquidator = address(0xCAFE);

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        collateralToken = new MockERC20("Collateral", "COL");
        underwriting = new MockUnderwriting();
        navOracle = new MockNAVOracle();
        cashFlowLogic = new MockCashFlowLogic(1000 ether);
        pool = new RWALendingPool(address(stable), address(underwriting), address(navOracle));
        waterfall = new LossWaterfall(address(pool));

        stable.mint(address(pool), 2_000_000 ether);
        vm.prank(pool.owner());
        pool.setAssetToken(1, address(collateralToken));
        vm.prank(pool.owner());
        pool.setAssetLogic(1, address(cashFlowLogic));

        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);
        underwriting.setTerms(true, 5000, 1000, block.timestamp + 365 days);

        collateralToken.mint(borrower, 2_000 ether);
        stable.mint(borrower, 20_000 ether);
        stable.mint(liquidator, 2_000 ether);

        vm.startPrank(borrower);
        collateralToken.approve(address(pool), type(uint256).max);
        stable.approve(address(pool), type(uint256).max);
        pool.depositCollateral(1, 1000 ether);
        vm.stopPrank();
    }

    function testReserveAccruesFromInterest() public {
        vm.prank(pool.owner());
        pool.setReserveFactor(1000); // 10%

        vm.prank(borrower);
        pool.borrow(1, 1000 ether);

        vm.warp(block.timestamp + 365 days);

        // trigger accrue path
        vm.prank(borrower);
        pool.repay(1, 1 ether);

        (uint256 principal,) = pool.debt(borrower, 1);
        // Interest = 100, reserve=10, lenderInterest=90, then repay 1 => 1089
        assertEq(pool.reserveBalance(), 10 ether);
        assertEq(principal, 1089 ether);
    }

    function testBadDebtUsesReserveAndWaterfall() public {
        vm.prank(pool.owner());
        pool.setReserveFactor(1000);
        vm.prank(pool.owner());
        pool.setLossWaterfall(address(waterfall));

        // Seed waterfall capacity
        vm.prank(address(pool));
        waterfall.depositJunior(300_000 ether);
        vm.prank(address(pool));
        waterfall.depositSenior(300_000 ether);

        // Max out borrow at current terms
        vm.prank(borrower);
        pool.borrow(1, 500_000 ether);

        // Accrue some reserve from interest before liquidation
        vm.warp(block.timestamp + 365 days);

        // Force deep under-collateralization
        navOracle.setNAV(1, 1 ether);

        vm.startPrank(liquidator);
        stable.approve(address(pool), type(uint256).max);
        pool.liquidate(borrower, 1, 10_000 ether); // capped by collateral recoverability
        vm.stopPrank();

        (uint256 principal,) = pool.debt(borrower, 1);
        assertEq(principal, 0);
        assertEq(pool.collateral(borrower, 1), 0);

        // Waterfall should absorb some losses
        (uint256 juniorBal) = waterfall.junior();
        (uint256 seniorBal) = waterfall.senior();
        assertLt(juniorBal, 300_000 ether);
        assertLt(seniorBal, 300_000 ether);
    }
}
