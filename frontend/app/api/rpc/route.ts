import { NextResponse } from "next/server";

export const runtime = "nodejs";

const defaultRpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";

type CachedEntry = {
  body: string;
  status: number;
  expiresAt: number;
};

const cache = new Map<string, CachedEntry>();
const inFlight = new Map<string, Promise<Response>>();

const cacheableMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_chainId",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getTtlMs = (method: string): number => {
  if (method === "eth_blockNumber") return 800;
  if (method === "eth_getLogs") return 2_000;
  if (method === "eth_getTransactionReceipt") return 2_000;
  return 1_500;
};

const getRpcUrls = (): string[] => {
  const primary = process.env.SEPOLIA_RPC_URL || defaultRpcUrl;
  const fallbackRaw = process.env.SEPOLIA_RPC_FALLBACK_URL || "";
  const fallback = fallbackRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return [primary, ...fallback];
};

const forwardRpc = async (rawBody: string): Promise<Response> => {
  const urls = getRpcUrls();
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: rawBody,
          cache: "no-store",
        });

        if (res.status !== 429) return res;
        lastResponse = res;
        await sleep(200 * (attempt + 1));
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("All RPC endpoints failed");
};

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const parsed = JSON.parse(rawBody) as
      | { method?: string }
      | Array<{ method?: string }>;

    if (Array.isArray(parsed)) {
      const upstreamResponse = await forwardRpc(rawBody);
      const upstreamText = await upstreamResponse.text();
      return new Response(upstreamText, {
        status: upstreamResponse.status,
        headers: { "content-type": "application/json" },
      });
    }

    const method = parsed.method || "";
    const canCache = cacheableMethods.has(method);
    const cacheKey = `${method}:${rawBody}`;
    const now = Date.now();

    if (canCache) {
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return new Response(cached.body, {
          status: cached.status,
          headers: {
            "content-type": "application/json",
            "x-rpc-cache": "hit",
          },
        });
      }
    }

    if (inFlight.has(cacheKey)) {
      return inFlight.get(cacheKey) as Promise<Response>;
    }

    const responsePromise = (async () => {
      const upstreamResponse = await forwardRpc(rawBody);
      const upstreamText = await upstreamResponse.text();

      if (canCache && upstreamResponse.status === 200) {
        cache.set(cacheKey, {
          body: upstreamText,
          status: upstreamResponse.status,
          expiresAt: Date.now() + getTtlMs(method),
        });
      }

      if (canCache && upstreamResponse.status === 429) {
        const stale = cache.get(cacheKey);
        if (stale) {
          return new Response(stale.body, {
            status: stale.status,
            headers: {
              "content-type": "application/json",
              "x-rpc-cache": "stale",
            },
          });
        }
      }

      return new Response(upstreamText, {
        status: upstreamResponse.status,
        headers: { "content-type": "application/json" },
      });
    })();

    inFlight.set(cacheKey, responsePromise);
    try {
      return await responsePromise;
    } finally {
      inFlight.delete(cacheKey);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON-RPC request body" },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "RPC proxy failed", message },
      { status: 502 },
    );
  }
}
