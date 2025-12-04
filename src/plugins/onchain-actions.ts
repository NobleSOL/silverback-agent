/**
 * On-Chain Actions Plugin Integration
 * Enables real trading using GOAT SDK with Uniswap and ERC20 support
 *
 * IMPORTANT: This executes REAL transactions with REAL funds
 * Only enable when ready for live trading
 *
 * Note: Due to version conflicts between @goat-sdk packages, this module
 * is configured for future use. The plugin dependencies need aligned versions.
 */

import { getOnChainActionsWorker } from "@virtuals-protocol/game-on-chain-actions-plugin";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

// Token addresses for Base network (for reference)
export const TOKEN_ADDRESSES = {
    WETH: "0x4200000000000000000000000000000000000006" as const,
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    BACK: "0x558881c4959e9cf961a7E1815FCD6586906babd2" as const,
};

/**
 * Create the on-chain actions worker for live trading
 * Returns null if required environment variables are not set
 *
 * Note: This is a simplified version that can be expanded when
 * GOAT SDK version conflicts are resolved
 */
export async function createOnChainActionsWorker() {
    // Check required environment variables
    if (!process.env.WALLET_PRIVATE_KEY) {
        console.log("⚠️ WALLET_PRIVATE_KEY not set - On-chain trading disabled");
        return null;
    }

    if (!process.env.BASE_RPC_URL) {
        console.log("⚠️ BASE_RPC_URL not set - On-chain trading disabled");
        return null;
    }

    try {
        // Create wallet from private key
        const account = privateKeyToAccount(
            process.env.WALLET_PRIVATE_KEY as `0x${string}`
        );

        const walletClient = createWalletClient({
            account: account,
            transport: http(process.env.BASE_RPC_URL),
            chain: base,
        });

        console.log(`🔐 Wallet configured: ${account.address}`);

        // Note: Full GOAT SDK integration requires aligned package versions
        // For now, we import dynamically to avoid TypeScript conflicts
        const { viem } = await import("@goat-sdk/wallet-viem");
        const { sendETH } = await import("@goat-sdk/wallet-evm");

        // Create the worker with basic send ETH capability
        const onChainActionsWorker = await getOnChainActionsWorker({
            wallet: viem(walletClient) as any,
            plugins: [sendETH() as any],
        });

        console.log("✅ On-chain actions worker created successfully");
        return onChainActionsWorker;
    } catch (error) {
        console.error("❌ Failed to create on-chain actions worker:", error);
        return null;
    }
}

/**
 * Check if on-chain trading is enabled
 */
export function isOnChainTradingEnabled(): boolean {
    return !!(
        process.env.WALLET_PRIVATE_KEY &&
        process.env.BASE_RPC_URL
    );
}

/**
 * Get wallet address if configured
 */
export function getWalletAddress(): string | null {
    if (!process.env.WALLET_PRIVATE_KEY) return null;

    try {
        const account = privateKeyToAccount(
            process.env.WALLET_PRIVATE_KEY as `0x${string}`
        );
        return account.address;
    } catch {
        return null;
    }
}
