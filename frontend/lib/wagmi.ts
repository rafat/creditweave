import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";

// Always use same-origin proxy in browser to avoid CORS/provider quirks.
const sepoliaRpcUrl = "/api/rpc";

export const SUPPORTED_CHAIN = sepolia;
export const SUPPORTED_CHAIN_ID = sepolia.id;

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(sepoliaRpcUrl, {
      // Prevent retry storms when upstream RPC starts rate limiting.
      retryCount: 0,
      timeout: 20_000,
    }),
  },
});
