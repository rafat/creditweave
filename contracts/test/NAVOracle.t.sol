// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/NAVOracle.sol";
import "./mocks/MockForwarder.sol";

contract NAVOracleTest is Test {
    NAVOracle oracle;
    MockForwarder forwarder;

    uint256 assetId = 1;

    function setUp() public {
        forwarder = new MockForwarder();
        oracle = new NAVOracle(address(forwarder));
    }

    // ------------------------------------------------------------
    // 1️⃣ Only forwarder can call onReport
    // ------------------------------------------------------------

    function testOnReportFailsIfNotForwarder() public {
        bytes memory report =
            abi.encode(assetId, 1000 ether, keccak256("source"));

        vm.expectRevert();
        oracle.onReport("", report);
    }

    // ------------------------------------------------------------
    // 2️⃣ Valid NAV update
    // ------------------------------------------------------------

    function testValidNAVStored() public {
        bytes memory report =
            abi.encode(assetId, 1000 ether, keccak256("source"));

        forwarder.deliver(address(oracle), "", report);

        (uint256 nav, uint256 updatedAt, bytes32 sourceHash) =
            oracle.getNAVData(assetId);

        assertEq(nav, 1000 ether);
        assertEq(sourceHash, keccak256("source"));
        assertEq(updatedAt, block.timestamp);
    }

    // ------------------------------------------------------------
    // 3️⃣ Reject invalid NAV
    // ------------------------------------------------------------

    function testRejectZeroNAV() public {
        bytes memory report =
            abi.encode(assetId, 0, keccak256("source"));

        vm.expectRevert("Invalid NAV");
        forwarder.deliver(address(oracle), "", report);
    }

    function testRejectInvalidAssetId() public {
        bytes memory report =
            abi.encode(0, 1000 ether, keccak256("source"));

        vm.expectRevert("Invalid assetId");
        forwarder.deliver(address(oracle), "", report);
    }

    // ------------------------------------------------------------
    // 4️⃣ Freshness logic
    // ------------------------------------------------------------

    function testFreshnessTrueInitially() public {
        bytes memory report =
            abi.encode(assetId, 1000 ether, keccak256("source"));

        forwarder.deliver(address(oracle), "", report);

        bool fresh = oracle.isFresh(assetId);
        assertTrue(fresh);
    }

    function testFreshnessBecomesFalseAfterStaleness() public {
        bytes memory report =
            abi.encode(assetId, 1000 ether, keccak256("source"));

        forwarder.deliver(address(oracle), "", report);

        vm.warp(block.timestamp + 4 days);

        bool fresh = oracle.isFresh(assetId);
        assertFalse(fresh);
    }

    // ------------------------------------------------------------
    // 5️⃣ Overwrite NAV
    // ------------------------------------------------------------

    function testNAVOverwrite() public {
        bytes memory report1 =
            abi.encode(assetId, 1000 ether, keccak256("source1"));

        forwarder.deliver(address(oracle), "", report1);

        vm.warp(block.timestamp + 1 hours);

        bytes memory report2 =
            abi.encode(assetId, 1200 ether, keccak256("source2"));

        forwarder.deliver(address(oracle), "", report2);

        (uint256 nav, uint256 updatedAt, bytes32 sourceHash) =
            oracle.getNAVData(assetId);

        assertEq(nav, 1200 ether);
        assertEq(sourceHash, keccak256("source2"));
        assertEq(updatedAt, block.timestamp);
    }

    // ------------------------------------------------------------
    // 6️⃣ Owner can update staleness window
    // ------------------------------------------------------------

    function testOwnerCanUpdateMaxStaleness() public {
        oracle.setMaxStaleness(1 days);
        assertEq(oracle.maxStaleness(), 1 days);
    }

    function testNonOwnerCannotUpdateStaleness() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        oracle.setMaxStaleness(1 days);
    }
}
