import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { DEPLOYMENTS } from "@/lib/abis";

export const runtime = "nodejs"; // Needed for child_process
const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { propertyAddress, assetValue, rentAmount, borrowerAddress } = await request.json();

    if (!propertyAddress || !assetValue || !rentAmount || !borrowerAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: "Server missing admin credentials" }, { status: 500 });
    }

    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

    // Build the command to run the Foundry script
    const scriptPath = "script/TokenizeAsset.s.sol";
    const cwd = path.resolve(process.cwd(), "../contracts");

    const envVars = {
      ...process.env,
      PRIVATE_KEY: privateKey,
      PROPERTY_ADDRESS: propertyAddress,
      ASSET_VALUE: assetValue.toString(),
      RENT_AMOUNT: rentAmount.toString(),
      ORIGINATOR: borrowerAddress,
      NEXT_PUBLIC_RWA_ASSET_REGISTRY: process.env.NEXT_PUBLIC_RWA_ASSET_REGISTRY || DEPLOYMENTS.rwaAssetRegistry,
      NEXT_PUBLIC_LENDING_POOL: process.env.NEXT_PUBLIC_LENDING_POOL || DEPLOYMENTS.lendingPool,
    };

    console.log(`[Tokenize] Running Foundry script in ${cwd} for originator ${borrowerAddress}...`);
    
    // Using forge script to broadcast the transaction.
    // Note: --verify requires Etherscan API key, we skip it for speed.
    const command = `forge script ${scriptPath} --rpc-url ${rpcUrl} --broadcast`;

    const { stdout, stderr } = await execAsync(command, { cwd, env: envVars });
    
    // Parse the output to find the SUCCESS_ASSET_ID
    const match = stdout.match(/SUCCESS_ASSET_ID:\s*(\d+)/);
    
    if (match && match[1]) {
      const assetId = parseInt(match[1], 10);
      return NextResponse.json({ success: true, assetId, message: "Tokenization successful" });
    } else {
        console.error("Tokenization script failed or output not found.");
        console.error("STDOUT:", stdout);
        console.error("STDERR:", stderr);
        throw new Error("Failed to parse Asset ID from script output");
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Tokenization failed";
    console.error("[Tokenize API Error]:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
