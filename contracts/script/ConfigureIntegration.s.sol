// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {RWALendingPool} from "../src/RWALendingPool.sol";
import {Script} from "forge-std/Script.sol";
    
contract ConfigureIntegration is Script {

    function run(
        address lendingPool,
        uint256 assetId,
        address token,
        address logic
    ) external {

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        RWALendingPool pool = RWALendingPool(lendingPool);

        pool.setAssetToken(assetId, token);
        pool.setAssetLogic(assetId, logic);

        vm.stopBroadcast();
    }
}
