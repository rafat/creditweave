// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockNAVOracle.sol";
import "./mocks/MockCashFlowLogic.sol";
import "./mocks/MockUnderwritingV2Adapter.sol";

contract RWALendingPoolV2EnforcementTest is Test {
    RWALendingPool internal pool;
    MockERC20 internal stable;
    MockERC20 internal collateralToken;
    MockUnderwriting internal underwritingV1;
    MockUnderwritingV2Adapter internal underwritingV2;
    MockNAVOracle internal navOracle;
    MockCashFlowLogic internal cashFlowLogic;

    address internal borrower = address(0xBEEF);

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        collateralToken = new MockERC20("Collateral", "COL");
        underwritingV1 = new MockUnderwriting();
        underwritingV2 = new MockUnderwritingV2Adapter();
        navOracle = new MockNAVOracle();
        cashFlowLogic = new MockCashFlowLogic(1000 ether);

        pool = new RWALendingPool(address(stable), address(underwritingV1), address(navOracle));

        stable.mint(address(pool), 1_000_000 ether);
        vm.prank(pool.owner());
        pool.setAssetToken(1, address(collateralToken));

        vm.prank(pool.owner());
        pool.setAssetLogic(1, address(cashFlowLogic));

        vm.prank(pool.owner());
        pool.setUnderwritingRegistryV2(address(underwritingV2));

        navOracle.setNAV(1, 1000 ether);
        navOracle.setIsFresh(1, true);

        underwritingV1.setTerms(true, 5000, 1000, block.timestamp + 7 days);
        underwritingV2.setBorrowingTerms(5000, 1000, type(uint256).max, block.timestamp + 7 days);
        underwritingV2.setEffectiveLtvBps(5000);

        collateralToken.mint(borrower, 2000 ether);
        stable.mint(borrower, 1000 ether);

        vm.startPrank(borrower);
        collateralToken.approve(address(pool), type(uint256).max);
        stable.approve(address(pool), type(uint256).max);
        pool.depositCollateral(1, 1000 ether);
        vm.stopPrank();
    }

    function testBorrowBlockedByCovenantsWhenV2Enabled() public {
        underwritingV2.setBorrowBlocked(true);

        vm.prank(borrower);
        vm.expectRevert("Borrow blocked by covenants");
        pool.borrow(1, 10 ether);
    }

    function testBorrowUsesDynamicEffectiveLtvFromV2() public {
        underwritingV2.setBorrowBlocked(false);
        underwritingV2.setEffectiveLtvBps(2000); // Tightened to 20%

        vm.prank(borrower);
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 210_000 ether); // > 20% of 1,000,000

        vm.prank(borrower);
        pool.borrow(1, 190_000 ether);
    }
}
