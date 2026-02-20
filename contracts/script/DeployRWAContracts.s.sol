// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../src/RWAAssetRegistry.sol";
import "../src/RWARevenueVault.sol";
import "../src/InvestorShareToken.sol";
import "../src/RentalCashFlowLogic.sol";
import "../src/RWACommonTypes.sol";

import "../test/mocks/MockERC20.sol";

contract DeployRWAContracts is Script {

    struct Deployment {
        address registry;
        address logic;
        address vault;
        address token;
        address stable;
        uint256 assetId;
    }

    function run() external returns (Deployment memory d) {

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Cronosflow ===");

        // ------------------------------------------------------------
        // 1️⃣ Deploy Stable (Demo USDC)
        // ------------------------------------------------------------

        MockERC20 stable =
            new MockERC20("Demo USD", "dUSD");

        console.log("Stable:", address(stable));

        // ------------------------------------------------------------
        // 2️⃣ Deploy Registry
        // ------------------------------------------------------------

        RWAAssetRegistry registry =
            new RWAAssetRegistry(deployer);

        console.log("Registry:", address(registry));

        // Grant required roles
        registry.grantRole(
            registry.ASSET_FACTORY_ROLE(),
            deployer
        );

        registry.grantRole(
            registry.PAYMENT_COLLECTOR_ROLE(),
            deployer
        );

        registry.grantRole(
            registry.ASSET_MANAGER_ROLE(),
            deployer
        );

        registry.grantRole(
            registry.COMPLIANCE_ROLE(),
            deployer
        );

        // ------------------------------------------------------------
        // 3️⃣ KYC + Register Asset
        // ------------------------------------------------------------

        registry.verifyKYC(deployer);

        uint256 assetValue = 1_000_000 ether;

        uint256 assetId = registry.registerAsset(
            RWACommonTypes.AssetType.REAL_ESTATE,
            deployer,
            assetValue,
            "ipfs://demo-rental"
        );

        console.log("AssetId:", assetId);

        // ------------------------------------------------------------
        // 4️⃣ Deploy Logic
        // ------------------------------------------------------------

        RentalCashFlowLogic logic =
            new RentalCashFlowLogic();

        bytes memory initData = abi.encode(
            1000 ether,            // rent
            30 days,               // interval
            block.timestamp + 30 days,
            5,                     // grace units
            block.timestamp + 365 days,
            1 days,
            address(registry)
        );

        logic.initialize(initData);

        console.log("Logic:", address(logic));

        // ------------------------------------------------------------
        // 5️⃣ Deploy Vault
        // ------------------------------------------------------------

        RWARevenueVault vault =
            new RWARevenueVault();

        vault.initialize(
            deployer,
            deployer,
            address(logic),
            address(stable),
            address(registry),
            assetId,
            deployer
        );

        console.log("Vault:", address(vault));

        // ------------------------------------------------------------
        // 6️⃣ Deploy Token
        // ------------------------------------------------------------

        InvestorShareToken token =
            new InvestorShareToken(
                assetId,
                "Rental Share Token",
                "rRENT",
                1_000_000 ether,
                address(registry),
                address(vault),
                deployer
            );

        vault.setTokenContracts(address(token));

        console.log("Token:", address(token));

        // ------------------------------------------------------------
        // 7️⃣ Link + Activate
        // ------------------------------------------------------------

        registry.linkContracts(
            assetId,
            address(logic),
            address(vault),
            address(token)
        );

        registry.activateAsset(assetId);

        vm.stopBroadcast();

        d = Deployment(
            address(registry),
            address(logic),
            address(vault),
            address(token),
            address(stable),
            assetId
        );
    }
}
