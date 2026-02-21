import type { Address } from "viem";
import { safeAddress } from "@/lib/env";

type ContractsByChain = {
  underwritingRegistry: Address;
  navOracle: Address;
  lendingPool: Address;
  rwaAssetRegistry: Address;
};

export const CONTRACTS: Record<number, ContractsByChain> = {
  11155111: {
    underwritingRegistry: safeAddress(
      process.env.NEXT_PUBLIC_UNDERWRITING_REGISTRY,
      "0x96c43232dd776e651ba164488232e2bde10c21ad",
      "NEXT_PUBLIC_UNDERWRITING_REGISTRY",
    ),
    navOracle: safeAddress(
      process.env.NEXT_PUBLIC_NAV_ORACLE,
      "0x28d62f419b3f221f2e749bda7dd92b64f123538e",
      "NEXT_PUBLIC_NAV_ORACLE",
    ),
    lendingPool: safeAddress(
      process.env.NEXT_PUBLIC_LENDING_POOL,
      "0x77b0347f171cd8782506bd6d35ea7601ec11561c",
      "NEXT_PUBLIC_LENDING_POOL",
    ),
    rwaAssetRegistry: safeAddress(
      process.env.NEXT_PUBLIC_RWA_ASSET_REGISTRY,
      "0x165fb8bcda88b586e378c556ef582f095794858e",
      "NEXT_PUBLIC_RWA_ASSET_REGISTRY",
    ),
  },
};

export const UNDERWRITING_REGISTRY_ABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "requestUnderwriting",
    inputs: [
      { name: "assetId", type: "uint256" },
      { name: "intendedBorrowAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getRequestedBorrowAmount",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "assetId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getTerms",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "assetId", type: "uint256" },
    ],
    outputs: [
      { name: "approved", type: "bool" },
      { name: "maxLtvBps", type: "uint16" },
      { name: "rateBps", type: "uint16" },
      { name: "expiry", type: "uint256" },
      { name: "reasoningHash", type: "bytes32" },
    ],
  },
] as const;

export const LENDING_POOL_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "stablecoin",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "borrow",
    inputs: [
      { name: "assetId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "collateral",
    inputs: [
      { name: "user", type: "address" },
      { name: "assetId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "debt",
    inputs: [
      { name: "user", type: "address" },
      { name: "assetId", type: "uint256" },
    ],
    outputs: [
      { name: "principal", type: "uint256" },
      { name: "lastAccrued", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const RWA_ASSET_REGISTRY_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "getAssetCore",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [
      { name: "assetId", type: "uint256" },
      { name: "assetType", type: "uint8" },
      { name: "originator", type: "address" },
      { name: "currentStatus", type: "uint8" },
      { name: "assetValue", type: "uint256" },
      { name: "accumulatedYield", type: "uint256" },
    ],
  },
] as const;

export const NAV_ORACLE_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "isFresh",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getNAVData",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [
      { name: "nav", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "sourceHash", type: "bytes32" },
    ],
  },
] as const;
