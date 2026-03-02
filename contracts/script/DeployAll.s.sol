// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {DeployRWAContracts} from "./DeployRWAContracts.s.sol";
import {DeployCreditWeave} from "./DeployCreditWeave.s.sol";
import {SeedLiquidity} from "./SeedLiquidity.s.sol";

contract DeployAll is Script {

    function run() external {
        // 1. Deploy RWA Infrastructure (Registry + Stablecoin)
        DeployRWAContracts rwaInfra = new DeployRWAContracts();
        DeployRWAContracts.Deployment memory rwa = rwaInfra.run();

        // 2. Deploy CreditWeave Core (Lending Pool, Oracle, Underwriting)
        DeployCreditWeave cwCore = new DeployCreditWeave();
        DeployCreditWeave.Deployment memory cw = cwCore.run(rwa.stable);

        // 3. Seed Liquidity to Pool (Mint 1M Demo USD to the pool)
        SeedLiquidity seed = new SeedLiquidity();
        seed.run(
            rwa.stable,
            cw.lendingPool
        );

        console.log("=== CORE INFRASTRUCTURE DEPLOYED ===");

        // Write deployments to JSON
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/deployments.json");
        
        string memory json = "deployments";
        vm.serializeAddress(json, "underwritingRegistry", cw.underwriting);
        vm.serializeAddress(json, "underwritingRegistryV2", cw.underwritingV2);
        vm.serializeAddress(json, "navOracle", cw.navOracle);
        vm.serializeAddress(json, "lendingPool", cw.lendingPool);
        vm.serializeAddress(json, "portfolioRiskRegistry", cw.portfolioRiskRegistry);
        vm.serializeAddress(json, "lossWaterfall", cw.lossWaterfall);
        vm.serializeAddress(json, "rwaAssetRegistry", rwa.registry);
        vm.serializeAddress(json, "stablecoin", rwa.stable);
        
        // These are empty because no asset is deployed yet
        vm.serializeAddress(json, "logic", address(0));
        vm.serializeAddress(json, "token", address(0));
        string memory finalJson = vm.serializeUint(json, "assetId", 0);
        
        vm.writeJson(finalJson, path);
        console.log("Deployments written to:", path);
    }
}
