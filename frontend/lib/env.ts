import { isAddress, type Address } from "viem";

const warnedMessages = new Set<string>();

const warnOnce = (message: string) => {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  // Intentional: surface deployment/config issues early in browser and server logs.
  console.warn(`[CreditWeave Frontend] ${message}`);
};

export const safeAddress = (
  value: string | undefined,
  fallback: Address,
  keyName: string,
): Address => {
  if (!value || value.trim() === "") {
    warnOnce(`${keyName} missing, using fallback ${fallback}`);
    return fallback;
  }

  if (!isAddress(value)) {
    warnOnce(`${keyName} invalid (${value}), using fallback ${fallback}`);
    return fallback;
  }

  return value as Address;
};

export const safeRpcUrl = (value: string | undefined, fallback: string): string => {
  if (!value || value.trim() === "") {
    warnOnce(`NEXT_PUBLIC_SEPOLIA_RPC_URL missing, using fallback ${fallback}`);
    return fallback;
  }

  try {
    // Validate URL format at startup to prevent silent provider issues.
    new URL(value);
    return value;
  } catch {
    warnOnce(`NEXT_PUBLIC_SEPOLIA_RPC_URL invalid (${value}), using fallback ${fallback}`);
    return fallback;
  }
};
