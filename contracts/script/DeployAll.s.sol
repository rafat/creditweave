// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";          // ← add this

import {DeployRWAContracts} from "./DeployRWAContracts.s.sol";
import {DeployCreditWeave} from "./DeployCreditWeave.s.sol";
import {ConfigureIntegration} from "./ConfigureIntegration.s.sol";
import {SeedLiquidity} from "./SeedLiquidity.s.sol";

contract DeployAll is Script {

    function run() external {
        DeployRWAContracts cronos = new DeployRWAContracts();
        DeployRWAContracts.Deployment memory c = cronos.run();

        DeployCreditWeave cw = new DeployCreditWeave();
        DeployCreditWeave.Deployment memory w = cw.run(c.stable);

        ConfigureIntegration config = new ConfigureIntegration();
        config.run(
            w.lendingPool,
            c.assetId,
            c.token,
            c.logic
        );

        SeedLiquidity seed = new SeedLiquidity();
        seed.run(
            c.stable,
            w.lendingPool
        );

        console.log("=== FULL SYSTEM DEPLOYED ===");

        // Write deployments to JSON
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/deployments.json");
        
        string memory json = "deployments";
        vm.serializeAddress(json, "underwritingRegistry", w.underwriting);
        vm.serializeAddress(json, "navOracle", w.navOracle);
        vm.serializeAddress(json, "lendingPool", w.lendingPool);
        vm.serializeAddress(json, "rwaAssetRegistry", c.registry);
        vm.serializeAddress(json, "stablecoin", c.stable);
        vm.serializeAddress(json, "logic", c.logic);
        vm.serializeAddress(json, "vault", c.vault);
        vm.serializeAddress(json, "token", c.token);
        string memory finalJson = vm.serializeUint(json, "assetId", c.assetId);
        
        vm.writeJson(finalJson, path);
        console.log("Deployments written to:", path);
    }
}
