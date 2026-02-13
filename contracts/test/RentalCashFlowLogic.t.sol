// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RentalCashFlowLogic.sol";
import "../src/RWACommonTypes.sol";

contract RentalCashFlowLogicTest is Test {
    RentalCashFlowLogic logic;

    address registry = address(100);

    uint256 rentAmount = 1000 ether;
    uint256 DAY = 1 days;

    uint256 paymentInterval;
    uint256 gracePeriodUnits = 5;
    uint256 leaseEndDate;
    uint256 firstDue;
    uint256 timeUnitSeconds;

    function setUp() public {
        logic = new RentalCashFlowLogic();

        timeUnitSeconds = DAY;
        paymentInterval = 30 * timeUnitSeconds;

        firstDue = block.timestamp + 60;
        leaseEndDate = firstDue + 180 * DAY;

        bytes memory initData = abi.encode(
            rentAmount,
            paymentInterval,
            firstDue,
            gracePeriodUnits,
            leaseEndDate,
            timeUnitSeconds,
            registry
        );

        logic.initialize(initData);
    }

    // -------------------------------------------------
    // Initialization
    // -------------------------------------------------

    function testInitializeOnlyOnce() public {
        vm.expectRevert("Already initialized");
        logic.initialize("0x");
    }

    function testStartsPerforming() public {
        assertEq(uint256(logic.getCashflowHealth()), 0); // PERFORMING
    }

    // -------------------------------------------------
    // Payments
    // -------------------------------------------------

    function testProcessPayment() public {
        vm.prank(registry);
        logic.processPayment(rentAmount, block.timestamp);

        assertEq(logic.getTotalReceived(), rentAmount);
    }

    // -------------------------------------------------
    // Grace / Late / Default Preview
    // -------------------------------------------------

    function testPreviewGracePeriod() public {
        vm.warp(firstDue + 1);

        (
            RWACommonTypes.AssetStatus _status,
            CashflowHealth health,
            uint256 _daysPastDue,
            uint256 _period
        ) = logic.previewDefault(block.timestamp);


        assertEq(uint256(health), 1); // GRACE_PERIOD
    }

    function testPreviewLate() public {
        uint256 t0 = firstDue + gracePeriodUnits * timeUnitSeconds + 1;
        vm.warp(t0);

        (
            RWACommonTypes.AssetStatus _status,
            CashflowHealth health,
            ,
        ) = logic.previewDefault(block.timestamp);

        assertEq(uint256(health), 2); // LATE
    }

    function testPreviewDefaultAfterTwoMissed() public {
        // First period missed
        uint256 t0 = firstDue + gracePeriodUnits * timeUnitSeconds + 1;
        vm.warp(t0);

        (
            RWACommonTypes.AssetStatus status0,
            CashflowHealth health0,
            ,
        ) = logic.previewDefault(block.timestamp);

        assertEq(uint256(health0), 2); // LATE
        assertEq(uint256(status0), uint256(RWACommonTypes.AssetStatus.ACTIVE));

        // Second period missed
        uint256 t1 = firstDue + paymentInterval + gracePeriodUnits * timeUnitSeconds + 1;
        vm.warp(t1);

        (
            RWACommonTypes.AssetStatus status1,
            CashflowHealth health1,
            ,
        ) = logic.previewDefault(block.timestamp);

        assertEq(uint256(health1), 3); // DEFAULTED
        assertEq(uint256(status1), uint256(RWACommonTypes.AssetStatus.DEFAULTED));
    }

    // -------------------------------------------------
    // Lease Maturity
    // -------------------------------------------------

    function testPreviewCompletedAfterLeaseEnd() public {
        vm.warp(leaseEndDate + 1);

        (
            RWACommonTypes.AssetStatus status,
            CashflowHealth health,
            ,
        ) = logic.previewDefault(block.timestamp);

        assertEq(uint256(health), 4); // COMPLETED
        assertEq(uint256(status), uint256(RWACommonTypes.AssetStatus.EXPIRED));
    }

    // -------------------------------------------------
    // Compressed Timeline (Minute-Based)
    // -------------------------------------------------

    function testCompressedTimeline() public {
        RentalCashFlowLogic logic2 = new RentalCashFlowLogic();

        uint256 MINUTE = 60;
        uint256 timeUnit = MINUTE;
        uint256 interval = 30 * MINUTE;
        uint256 first = block.timestamp + 10;
        uint256 end = first + 2 * interval;

        bytes memory initData = abi.encode(
            rentAmount,
            interval,
            first,
            gracePeriodUnits,
            end,
            timeUnit,
            registry
        );

        logic2.initialize(initData);

        // Just after due
        vm.warp(first + 1);

        (
            ,
            CashflowHealth health0,
            uint256 unitsPastDue,
        ) = logic2.previewDefault(block.timestamp);

        assertEq(uint256(health0), 1); // GRACE
        assertEq(unitsPastDue, 0);

        // After grace
        vm.warp(first + gracePeriodUnits * MINUTE + 1);

        (
            ,
            CashflowHealth health1,
            uint256 unitsPastDue2,
        ) = logic2.previewDefault(block.timestamp);

        assertEq(uint256(health1), 2); // LATE
        assertTrue(unitsPastDue2 >= gracePeriodUnits);
    }
}
