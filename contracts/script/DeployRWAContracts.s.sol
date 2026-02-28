// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../src/RWAAssetRegistry.sol";
import "../test/mocks/MockERC20.sol";

contract DeployRWAContracts is Script {

    struct Deployment {
        address registry;
        address stable;
    }

    function run() external returns (Deployment memory d) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying RWA Infrastructure ===");

        // 1. Deploy Stable (Demo USD)
        MockERC20 stable = new MockERC20("Demo USD", "dUSD");
        console.log("Stablecoin deployed at:", address(stable));

        // 2. Deploy Registry
        RWAAssetRegistry registry = new RWAAssetRegistry(deployer);
        console.log("Registry deployed at:", address(registry));

        // Grant core roles to the deployer so they can manage the protocol
        registry.grantRole(registry.ASSET_FACTORY_ROLE(), deployer);
        registry.grantRole(registry.PAYMENT_COLLECTOR_ROLE(), deployer);
        registry.grantRole(registry.ASSET_MANAGER_ROLE(), deployer);
        registry.grantRole(registry.COMPLIANCE_ROLE(), deployer);

        registry.verifyKYC(deployer);

        vm.stopBroadcast();

        d = Deployment(
            address(registry),
            address(stable)
        );
    }
}
