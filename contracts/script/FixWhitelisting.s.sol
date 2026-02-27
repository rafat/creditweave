// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/RWAAssetRegistry.sol";

contract FixWhitelisting is Script {
    function run() external {
        // Current deployed addresses from your environment
        address registryAddress = 0xF0d10E2F38c032F5Da27bF2896deA72E943393de;
        address lendingPoolAddress = 0xAe6c3bB71723B43aeF175997c480c26BC5439643;

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        RWAAssetRegistry registry = RWAAssetRegistry(registryAddress);
        
        console.log("Current Whitelist Status:", registry.isWhitelisted(lendingPoolAddress));
        
        if (!registry.kycVerified(lendingPoolAddress)) {
            console.log("KYC verifying Lending Pool...");
            registry.verifyKYC(lendingPoolAddress);
        }

        console.log("Whitelisting Lending Pool in Registry...");
        registry.whitelistRecipient(lendingPoolAddress);
        
        console.log("New Whitelist Status:", registry.isWhitelisted(lendingPoolAddress));
        console.log("Done.");

        vm.stopBroadcast();
    }
}
