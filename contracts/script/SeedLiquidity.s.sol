// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Script} from "forge-std/Script.sol";
import {MockERC20} from "../test//mocks/MockERC20.sol";

contract SeedLiquidity is Script {

    function run(
        address stable,
        address lendingPool
    ) external {

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        MockERC20(stable).mint(lendingPool, 1_000_000 ether);

        vm.stopBroadcast();
    }
}
