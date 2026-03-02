// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/InvestorShareToken.sol";
import "./mocks/MockRegistry.sol";

contract InvestorShareTokenTest is Test {
    InvestorShareToken token;
    MockRegistry registry;

    address user1 = address(1);
    address user2 = address(2);

    uint256 assetId = 1;
    uint256 maxSupply = 1_000_000 ether;
    uint256 initialSupply = 100 ether;

    function setUp() public {
        registry = new MockRegistry();
        registry.setWhitelisted(user1, true);
        registry.setWhitelisted(user2, true);

        token = new InvestorShareToken(
            assetId,
            "RWA Share",
            "RWA",
            maxSupply,
            address(registry),
            user1,
            initialSupply
        );
    }

    // -------------------------------------------------
    // Constructor tests
    // -------------------------------------------------

    function testConstructorSetsValues() public view {
        assertEq(token.assetId(), assetId);
        assertEq(token.maxSupply(), maxSupply);
        assertEq(token.registry(), address(registry));
        assertEq(token.totalSupply(), initialSupply);
        assertEq(token.balanceOf(user1), initialSupply);
    }

    // -------------------------------------------------
    // Transfers
    // -------------------------------------------------

    function testTransferSuccess() public {
        vm.prank(user1);
        assertTrue(token.transfer(user2, 50 ether));

        assertEq(token.balanceOf(user1), initialSupply - 50 ether);
        assertEq(token.balanceOf(user2), 50 ether);
    }

    function testTransferFailsIfAssetInactive() public {
        registry.setAssetActive(false);

        vm.prank(user1);
        (bool success, ) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, user2, 10 ether)
        );
        assertFalse(success);
    }

    function testTransferFailsIfPaused() public {
        registry.setAssetPaused(true);

        vm.prank(user1);
        (bool success, ) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, user2, 10 ether)
        );
        assertFalse(success);
    }

    function testTransferFailsIfSenderNotWhitelisted() public {
        registry.setWhitelisted(user1, false);

        vm.prank(user1);
        (bool success, ) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, user2, 10 ether)
        );
        assertFalse(success);
    }


    // -------------------------------------------------
    // ownershipBps
    // -------------------------------------------------

    function testOwnershipBps() public {
        vm.prank(user1);
        assertTrue(token.transfer(user2, initialSupply / 2));

        uint256 bps = token.ownershipBps(user1);

        assertEq(bps, 5000); // 50%
    }
}
