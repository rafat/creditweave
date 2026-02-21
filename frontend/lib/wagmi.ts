import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { safeRpcUrl } from "@/lib/env";

const sepoliaRpcUrl =
  safeRpcUrl(
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
    "https://ethereum-sepolia-rpc.publicnode.com",
  );

export const SUPPORTED_CHAIN = sepolia;
export const SUPPORTED_CHAIN_ID = sepolia.id;

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(sepoliaRpcUrl),
  },
});
