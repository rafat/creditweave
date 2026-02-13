## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```

## Contract Call Tips (Structs and Mapping Getters)

Solidity public mapping getters do **not** return a struct type. They return a flat tuple of fields. If you try to decode the result as a struct in your frontend, you will get a decoding error or a runtime revert.

Use one of these patterns instead:

1. Add explicit view functions in the contract that return only the fields you need.
2. Read the mapping getter as a tuple and map it to a JS object yourself.
3. Keep ABI typings generated from the actual contract ABI so the tuple shape is accurate.

### Example: Ethers v6 (tuple -> object)

```ts
// ABI fragment for assets mapping getter
const abi = [
  "function assets(uint256) view returns (uint256 assetId, uint8 assetType, address originator, address logicContract, address vaultContract, address tokenContract, bool isKYCVerified, bool isPaused, uint256 assetValue, uint256 accumulatedYield, uint256 lastValuationDate, uint256 lastPaymentDate, uint256 missedPayments, uint256 daysInDefault, uint256 lastYieldDistributionDate, uint256 totalYieldDistributed, uint256 nextPaymentDueDate, uint256 expectedMonthlyPayment, uint256 expectedMaturityDate, address valuationOracle, uint8 currentStatus, uint8 statusBeforePause, uint256 registrationDate, uint256 activationDate, string ipfsMetadataHash)"
];

const tuple = await registry.assets(assetId);

const asset = {
  assetId: tuple.assetId,
  assetType: tuple.assetType,
  originator: tuple.originator,
  currentStatus: tuple.currentStatus,
  expectedMonthlyPayment: tuple.expectedMonthlyPayment,
  nextPaymentDueDate: tuple.nextPaymentDueDate,
};
```

### Example: viem (tuple -> object)

```ts
const abi = [
  {
    name: "assets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "assetId", type: "uint256" },
      { name: "assetType", type: "uint8" },
      { name: "originator", type: "address" },
      { name: "logicContract", type: "address" },
      { name: "vaultContract", type: "address" },
      { name: "tokenContract", type: "address" },
      { name: "isKYCVerified", type: "bool" },
      { name: "isPaused", type: "bool" },
      { name: "assetValue", type: "uint256" },
      { name: "accumulatedYield", type: "uint256" },
      { name: "lastValuationDate", type: "uint256" },
      { name: "lastPaymentDate", type: "uint256" },
      { name: "missedPayments", type: "uint256" },
      { name: "daysInDefault", type: "uint256" },
      { name: "lastYieldDistributionDate", type: "uint256" },
      { name: "totalYieldDistributed", type: "uint256" },
      { name: "nextPaymentDueDate", type: "uint256" },
      { name: "expectedMonthlyPayment", type: "uint256" },
      { name: "expectedMaturityDate", type: "uint256" },
      { name: "valuationOracle", type: "address" },
      { name: "currentStatus", type: "uint8" },
      { name: "statusBeforePause", type: "uint8" },
      { name: "registrationDate", type: "uint256" },
      { name: "activationDate", type: "uint256" },
      { name: "ipfsMetadataHash", type: "string" },
    ],
  },
];

const tuple = await publicClient.readContract({
  address: registryAddress,
  abi,
  functionName: "assets",
  args: [assetId],
});

const asset = {
  assetId: tuple[0],
  originator: tuple[2],
  currentStatus: tuple[20],
  expectedMonthlyPayment: tuple[17],
  nextPaymentDueDate: tuple[16],
};
```

### Contract Improvements (Recommended)

If you want a struct-like object without manual mapping, add a dedicated contract view function that returns a smaller struct or individual fields. This is the safest and most stable approach for frontend calls and reduces ABI tuple complexity.

This repo now exposes small, stable getters:

1. `getAssetCore(uint256)` → `assetId`, `assetType`, `originator`, `currentStatus`, `assetValue`, `accumulatedYield`
2. `getAssetSchedule(uint256)` → `nextPaymentDueDate`, `expectedMonthlyPayment`, `expectedMaturityDate`
3. `getAssetLinks(uint256)` → `logicContract`, `vaultContract`, `tokenContract`
4. `getAssetMetadata(uint256)` → `ipfsMetadataHash`, `registrationDate`, `activationDate`, `valuationOracle`

Recommended patterns:

1. **Small dedicated getters** (best for frontend stability):
   - `getAssetCore(uint256)` returning `assetId`, `originator`, `currentStatus`, `expectedMonthlyPayment`, `nextPaymentDueDate`.
2. **Grouped getters** for sections:
   - `getAssetSchedule(uint256)` returning schedule fields only.
   - `getAssetCompliance(uint256)` returning KYC/paused flags.
3. **Explicit struct getter**:
   - `function getAsset(uint256) external view returns (RealWorldAsset memory)` which returns the struct in ABI‑encoded form. This gives a clean frontend decode and avoids tuple shape confusion.

These patterns also help avoid stack‑too‑deep in tests because you don’t need to destructure 25 fields just to check a few values.
