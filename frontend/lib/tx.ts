export type TxPhase =
  | "idle"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export type TxState = {
  phase: TxPhase;
  hash?: `0x${string}`;
  message?: string;
};

export const getExplorerTxUrl = (chainId: number, hash: string): string => {
  if (chainId === 11155111) {
    return `https://sepolia.etherscan.io/tx/${hash}`;
  }
  return `https://etherscan.io/tx/${hash}`;
};

export const normalizeTxError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.shortMessage === "string") return record.shortMessage;
    if (typeof record.message === "string") return record.message;
  }
  return "Transaction failed.";
};
