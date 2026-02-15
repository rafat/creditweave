// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RWALendingPool.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockUnderwriting.sol";
import "./mocks/MockAssetRegistry.sol";

contract RWALendingPoolTest is Test {
    RWALendingPool pool;
    MockERC20 stable;
    MockUnderwriting underwriting;
    MockAssetRegistry registry;

    address borrower = address(0xBEEF);

    function setUp() public {
        stable = new MockERC20("Mock Stable", "mSTB");
        underwriting = new MockUnderwriting();
        registry = new MockAssetRegistry();

        pool = new RWALendingPool(
            address(stable),
            address(underwriting),
            address(registry)
        );

        // Provide liquidity to pool
        stable.mint(address(pool), 1_000_000 ether);

        vm.startPrank(borrower);
        stable.mint(borrower, 1_000_000 ether);
        stable.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------
    // Borrow success
    // ------------------------------------------------------------

    function testBorrowSuccess() public {
        registry.setAssetValue(1000 ether);

        underwriting.setTerms(
            true,
            5000, // 50% LTV
            1000, // 10% APR
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        pool.borrow(1, 400 ether);

        assertEq(stable.balanceOf(borrower), 1_000_400 ether);
    }

    // ------------------------------------------------------------
    // LTV enforcement
    // ------------------------------------------------------------

    function testBorrowFailsIfExceedsLTV() public {
        registry.setAssetValue(1000 ether);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp + 1 days
        );

        vm.prank(borrower);
        vm.expectRevert("Exceeds LTV");
        pool.borrow(1, 600 ether);
    }

    // ------------------------------------------------------------
    // Expiry enforcement
    // ------------------------------------------------------------

    function testBorrowFailsIfExpired() public {
        registry.setAssetValue(1000 ether);

        underwriting.setTerms(
            true,
            5000,
            1000,
            block.timestamp - 1
        );

        vm.prank(borrower);
        vm.expectRevert("Underwriting expired");
        pool.borrow(1, 400 ether);
    }

    // ------------------------------------------------------------
    // Interest accrual
    // ------------------------------------------------------------

    function testInterestAccruesOverTime() public {
        registry.setAssetValue(1000 ether);

        underwriting.setTerms(
            true,
            5000,
            1000, // 10%
            block.timestamp + 10 days
        );

        vm.prank(borrower);
        pool.borrow(1, 500 ether);

        vm.warp(block.timestamp + 365 days);

        uint256 outstanding = pool.getOutstanding(borrower, 1);

        // 10% of 500 = 50
        assertApproxEqAbs(outstanding, 550 ether, 1e15);
    }

    // ------------------------------------------------------------
    // Repay
    // ------------------------------------------------------------

    function testRepayReducesPrincipal() public {
        registry.setAssetValue(1000 ether);

        underwriting.setTerms(
            true,
            5000,
            0,
            block.timestamp + 10 days
        );

        vm.prank(borrower);
        pool.borrow(1, 500 ether);

        vm.prank(borrower);
        pool.repay(1, 200 ether);

        uint256 outstanding = pool.getOutstanding(borrower, 1);
        assertEq(outstanding, 300 ether);
    }
}
