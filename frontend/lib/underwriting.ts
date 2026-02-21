export type TermsTuple = [boolean, number, number, bigint, `0x${string}`];

export type UnderwritingUiState =
  | "unset"
  | "pending"
  | "approved_active"
  | "approved_expired"
  | "denied";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const deriveUnderwritingState = (
  pendingBorrowAmount: bigint,
  terms?: TermsTuple,
  nowUnixSeconds?: number,
): UnderwritingUiState => {
  if (pendingBorrowAmount > 0n) return "pending";
  if (!terms) return "unset";

  const [approved, maxLtvBps, rateBps, expiry, reasoningHash] = terms;
  const hasTerms =
    approved ||
    maxLtvBps > 0 ||
    rateBps > 0 ||
    expiry > 0n ||
    reasoningHash.toLowerCase() !== ZERO_HASH;

  if (!hasTerms) return "unset";

  const now = BigInt(nowUnixSeconds ?? Math.floor(Date.now() / 1000));
  if (!approved) return "denied";
  if (expiry <= now) return "approved_expired";
  return "approved_active";
};

export const getRiskBadge = (
  approved: boolean,
  maxLtvBps: number,
): "LOW" | "MEDIUM" | "HIGH" | "DENIED" => {
  if (!approved) return "DENIED";
  if (maxLtvBps >= 7000) return "LOW";
  if (maxLtvBps >= 6200) return "MEDIUM";
  return "HIGH";
};

export const getStatusLabel = (state: UnderwritingUiState): string => {
  switch (state) {
    case "pending":
      return "PENDING";
    case "approved_active":
      return "APPROVED";
    case "approved_expired":
      return "EXPIRED";
    case "denied":
      return "DENIED";
    default:
      return "UNSET";
  }
};
