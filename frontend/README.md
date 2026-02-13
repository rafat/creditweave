This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Contract Calls (RWAAssetRegistry)

These are the recommended, frontend-friendly getters:

1. `getAssetCore(uint256)`
2. `getAssetSchedule(uint256)`
3. `getAssetLinks(uint256)`
4. `getAssetMetadata(uint256)`

Example (viem):

```ts
const abi = [
  {
    name: "getAssetCore",
    type: "function",
    stateMutability: "view",
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
  {
    name: "getAssetSchedule",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [
      { name: "nextPaymentDueDate", type: "uint256" },
      { name: "expectedMonthlyPayment", type: "uint256" },
      { name: "expectedMaturityDate", type: "uint256" },
    ],
  },
  {
    name: "getAssetLinks",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [
      { name: "logicContract", type: "address" },
      { name: "vaultContract", type: "address" },
      { name: "tokenContract", type: "address" },
    ],
  },
  {
    name: "getAssetMetadata",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [
      { name: "ipfsMetadataHash", type: "string" },
      { name: "registrationDate", type: "uint256" },
      { name: "activationDate", type: "uint256" },
      { name: "valuationOracle", type: "address" },
    ],
  },
];

const core = await publicClient.readContract({
  address: registryAddress,
  abi,
  functionName: "getAssetCore",
  args: [assetId],
});

const schedule = await publicClient.readContract({
  address: registryAddress,
  abi,
  functionName: "getAssetSchedule",
  args: [assetId],
});
```

If you’re using `ethers`, the same ABI works with `new ethers.Contract(...)`.
