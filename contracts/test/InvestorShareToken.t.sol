// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/InvestorShareToken.sol";
import "./mocks/MockRegistry.sol";
import "./mocks/MockVault.sol";

contract InvestorShareTokenTest is Test {
    InvestorShareToken token;
    MockRegistry registry;
    MockVault vault;

    address admin = address(1);
    address user1 = address(2);
    address user2 = address(3);

    uint256 assetId = 1;
    uint256 maxSupply = 1_000_000 ether;

    function setUp() public {
        registry = new MockRegistry();
        vault = new MockVault();

        token = new InvestorShareToken(
            assetId,
            "RWA Share",
            "RWA",
            maxSupply,
            address(registry),
            address(vault),
            admin
        );

        registry.setWhitelisted(user1, true);
        registry.setWhitelisted(user2, true);
    }

    // -------------------------------------------------
    // Constructor tests
    // -------------------------------------------------

    function testConstructorSetsValues() public {
        assertEq(token.assetId(), assetId);
        assertEq(token.maxSupply(), maxSupply);
        assertEq(token.registry(), address(registry));
        assertEq(token.vault(), address(vault));
    }

    // -------------------------------------------------
    // Minting
    // -------------------------------------------------

    function testMintSuccess() public {
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        assertEq(token.balanceOf(user1), 100 ether);
        assertEq(token.totalSupply(), 100 ether);
    }

    function testMintFailsIfNotWhitelisted() public {
        address badUser = address(4);

        vm.prank(address(vault));
        vm.expectRevert("Recipient not whitelisted");
        token.mint(badUser, 100 ether);
    }

    function testMintFailsIfSupplyExceeded() public {
        vm.prank(address(vault));
        vm.expectRevert("Max supply exceeded");
        token.mint(user1, maxSupply + 1);
    }

    function testMintFailsIfDistributionStarted() public {
        vault.setDistributionStarted(true);

        vm.prank(address(vault));
        vm.expectRevert("Supply locked");
        token.mint(user1, 100 ether);
    }

    // -------------------------------------------------
    // Transfers
    // -------------------------------------------------

    function testTransferSuccess() public {
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        vm.prank(user1);
        token.transfer(user2, 50 ether);

        assertEq(token.balanceOf(user1), 50 ether);
        assertEq(token.balanceOf(user2), 50 ether);
    }

    function testTransferFailsIfAssetInactive() public {
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        registry.setAssetActive(false);

        vm.prank(user1);
        vm.expectRevert("Asset not active");
        token.transfer(user2, 10 ether);
    }

    function testTransferFailsIfPaused() public {
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        registry.setAssetPaused(true);

        vm.prank(user1);
        vm.expectRevert("Asset paused");
        token.transfer(user2, 10 ether);
    }

    function testTransferFailsIfSenderNotWhitelisted() public {
        // First mint while whitelisted
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        // Now remove whitelist
        registry.setWhitelisted(user1, false);

        vm.prank(user1);
        vm.expectRevert("Sender not whitelisted");
        token.transfer(user2, 10 ether);
    }


    // -------------------------------------------------
    // ownershipBps
    // -------------------------------------------------

    function testOwnershipBps() public {
        vm.prank(address(vault));
        token.mint(user1, 100 ether);

        vm.prank(address(vault));
        token.mint(user2, 100 ether);

        uint256 bps = token.ownershipBps(user1);

        assertEq(bps, 5000); // 50%
    }
}
