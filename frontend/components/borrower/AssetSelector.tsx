"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem, formatUnits } from "viem";
import { CONTRACTS, RWA_ASSET_REGISTRY_ABI } from "@/lib/contracts";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";
import Link from "next/link";

type AssetInfo = {
  assetId: bigint;
  address: string;
  value: bigint;
  status: number;
};

type Props = {
  selectedAssetId: string;
  onSelect: (assetId: string) => void;
};

const ASSET_REGISTERED_EVENT = parseAbiItem(
  "event AssetRegistered(uint256 indexed assetId, uint8 assetType, address indexed originator, uint256 assetValue)"
);

export default function AssetSelector({ selectedAssetId, onSelect }: Props) {
  const [mounted, setMounted] = useState(false);
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const contracts = CONTRACTS[SUPPORTED_CHAIN_ID];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!address || !publicClient) return;

    const fetchAssets = async () => {
      try {
        setIsLoading(true);
        const latestBlock = await publicClient.getBlockNumber();
        // Query last 40,000 blocks for efficiency (staying under the common 50,000 limit)
        const fromBlock = latestBlock > 40000n ? latestBlock - 40000n : 0n;

        const logs = await publicClient.getLogs({
          address: contracts.rwaAssetRegistry,
          event: ASSET_REGISTERED_EVENT,
          args: { originator: address },
          fromBlock,
          toBlock: "latest",
        });

        const assetIds = Array.from(new Set(logs.map((log) => log.args.assetId as bigint)));
        
        const assetDetails = await Promise.all(
          assetIds.map(async (id) => {
            const core = await publicClient.readContract({
              address: contracts.rwaAssetRegistry,
              abi: RWA_ASSET_REGISTRY_ABI,
              functionName: "getAssetCore",
              args: [id],
            }) as [bigint, number, `0x${string}`, number, bigint, bigint];

            const metadata = await publicClient.readContract({
              address: contracts.rwaAssetRegistry,
              abi: RWA_ASSET_REGISTRY_ABI,
              functionName: "getAssetMetadata",
              args: [id],
            }) as [string, bigint, bigint, `0x${string}`];

            return {
              assetId: id,
              address: metadata[0] || "Unknown Address",
              value: core[4],
              status: Number(core[3]),
            };
          })
        );

        setAssets(assetDetails.sort((a, b) => Number(b.assetId - a.assetId)));
        
        // Auto-select first asset if none selected
        if (assetDetails.length > 0 && !selectedAssetId) {
            onSelect(assetDetails[0].assetId.toString());
        }
      } catch (e) {
        console.error("Failed to fetch assets:", e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssets();
  }, [address, publicClient, contracts.rwaAssetRegistry, onSelect, selectedAssetId]);

  if (!mounted) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <p className="mono text-xs text-[color:var(--ink-700)]">YOUR ASSETS</p>
        <div className="h-24 w-full animate-pulse rounded-2xl bg-gray-100" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="mono text-xs text-[color:var(--ink-700)]">YOUR ASSETS</p>
        <Link 
          href="/borrower/tokenize"
          className="text-xs font-semibold text-blue-600 hover:underline"
        >
          + Tokenize New Asset
        </Link>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-sm text-[color:var(--ink-700)] mb-4">No assets found for your address.</p>
          <Link 
            href="/borrower/tokenize"
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Get Started
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {assets.map((asset) => (
            <button
              key={asset.assetId.toString()}
              onClick={() => onSelect(asset.assetId.toString())}
              className={`flex flex-col gap-1 rounded-2xl border p-4 text-left transition ${
                selectedAssetId === asset.assetId.toString()
                  ? "border-black bg-gray-50 ring-1 ring-black"
                  : "bg-white hover:border-gray-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="mono text-[10px] font-bold uppercase text-gray-400">Asset #{asset.assetId.toString()}</span>
                {asset.status === 2 && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">ACTIVE</span>
                )}
              </div>
              <p className="line-clamp-1 font-semibold text-gray-900">{asset.address}</p>
              <p className="text-xs text-gray-500">
                Value: ${Number(formatUnits(asset.value, 18)).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
