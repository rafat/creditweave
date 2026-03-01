// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockNAVOracle.sol";
import "./mocks/MockCashFlowLogic.sol";

contract RWALendingPoolSecurityTest is Test {
    RWALendingPool internal pool;
    MockERC20 internal stable;
    MockUnderwriting internal underwriting;
    MockNAVOracle internal navOracle;
    MockERC20 internal collateralToken;
    MockCashFlowLogic internal cashFlowLogic;

    address internal borrower = address(0xBEEF);

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        underwriting = new MockUnderwriting();
        navOracle = new MockNAVOracle();
        collateralToken = new MockERC20("Collateral", "COL");
        cashFlowLogic = new MockCashFlowLogic(1000 ether);

        pool = new RWALendingPool(address(stable), address(underwriting), address(navOracle));

        stable.mint(address(pool), 1_000_000 ether);
        vm.prank(pool.owner());
        pool.setAssetToken(1, address(collateralToken));
        vm.prank(pool.owner());
        pool.setAssetLogic(1, address(cashFlowLogic));

        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);
        underwriting.setTerms(true, 5000, 0, block.timestamp + 365 days);

        stable.mint(borrower, 1_000_000 ether);
        collateralToken.mint(borrower, 1_000_000 ether);

        vm.startPrank(borrower);
        stable.approve(address(pool), type(uint256).max);
        collateralToken.approve(address(pool), type(uint256).max);
        pool.depositCollateral(1, 1000 ether);
        vm.stopPrank();
    }

    function testFuzzRepayCannotChargeMoreThanDebt(uint96 borrowAmountRaw, uint96 repayAmountRaw) public {
        uint256 borrowAmount = bound(uint256(borrowAmountRaw), 1 ether, 1_000 ether);
        uint256 repayAmount = bound(uint256(repayAmountRaw), 1 ether, 10_000 ether);

        vm.prank(borrower);
        pool.borrow(1, borrowAmount);

        uint256 debtBefore = pool.getDebtWithAccrual(borrower, 1);
        uint256 borrowerBalBefore = stable.balanceOf(borrower);
        uint256 poolBalBefore = stable.balanceOf(address(pool));

        vm.prank(borrower);
        pool.repay(1, repayAmount);

        uint256 expectedTransfer = repayAmount > debtBefore ? debtBefore : repayAmount;
        uint256 borrowerBalAfter = stable.balanceOf(borrower);
        uint256 poolBalAfter = stable.balanceOf(address(pool));
        uint256 debtAfter = pool.getDebtWithAccrual(borrower, 1);

        assertEq(borrowerBalBefore - borrowerBalAfter, expectedTransfer);
        assertEq(poolBalAfter - poolBalBefore, expectedTransfer);
        assertEq(debtAfter, debtBefore - expectedTransfer);
    }
}
