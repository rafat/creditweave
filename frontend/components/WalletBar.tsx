"use client";

import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { SUPPORTED_CHAIN_ID } from "@/lib/wagmi";

const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(address.length - 4)}`;

export default function WalletBar() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== SUPPORTED_CHAIN_ID;
  const primaryConnector = connectors[0];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-[color:var(--card)] p-4">
      <div className="flex flex-col gap-1">
        <span className="mono text-xs text-[color:var(--ink-700)]">WALLET</span>
        <span className="text-sm">
          {isConnected && address ? shortenAddress(address) : "Not connected"}
        </span>
        <span className="mono text-xs text-[color:var(--ink-700)]">
          Chain: {isConnected ? chainId : "n/a"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!isConnected ? (
          <button
            type="button"
            onClick={() => primaryConnector && connect({ connector: primaryConnector })}
            disabled={isConnectPending || !primaryConnector}
            className="rounded-xl bg-[color:var(--ink-900)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!primaryConnector
              ? "No Wallet Detected"
              : isConnectPending
                ? "Connecting..."
                : "Connect MetaMask"}
          </button>
        ) : (
          <>
            {isWrongNetwork && (
              <button
                type="button"
                onClick={() => switchChain({ chainId: SUPPORTED_CHAIN_ID })}
                disabled={isSwitchPending}
                className="rounded-xl border bg-white px-3 py-2 text-sm font-medium transition hover:bg-[color:var(--mint-100)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSwitchPending ? "Switching..." : "Switch to Sepolia"}
              </button>
            )}
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded-xl border bg-white px-3 py-2 text-sm font-medium transition hover:bg-[color:var(--mint-100)]"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
