import TwitterPlugin from "@virtuals-protocol/game-twitter-plugin";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
import { ethers } from 'ethers';
import dotenv from "dotenv";
dotenv.config();

if (!process.env.GAME_TWITTER_TOKEN) {
    throw new Error('GAME_TWITTER_TOKEN is required for Twitter integration');
}

// Initialize Twitter client with GAME token
export const twitterClient = new TwitterApi({
    gameTwitterAccessToken: process.env.GAME_TWITTER_TOKEN,
});

// Create Twitter plugin instance
export const twitterPlugin = new TwitterPlugin({
    twitterClient: twitterClient,
});

// Base Chain Configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const OPENOCEAN_API = 'https://open-api.openocean.finance/v4/base';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const FACTORY_ABI = [
    'function allPairsLength() view returns (uint256)',
];

// Cache for own user ID to prevent self-replies
let ownUserId: string | null = null;

/**
 * Get the authenticated user's ID (cached)
 */
export async function getOwnUserId(): Promise<string | null> {
    if (ownUserId) return ownUserId;

    try {
        const me = await twitterClient.v2.me();
        ownUserId = me.data.id;
        console.log(`🦍 Twitter user ID: ${ownUserId}`);
        return ownUserId;
    } catch (error) {
        console.error('Failed to get own user ID:', error);
        return null;
    }
}

/**
 * Get DEX stats from Base chain
 */
async function getDexStats(): Promise<{
    pairCount: string;
    ethPrice: string;
    gasPrice: string;
    dexCount: number;
}> {
    // Get pair count from Silverback factory
    let pairCount = 'N/A';
    try {
        const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
        const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);
        const count = await factory.allPairsLength();
        pairCount = count.toString();
    } catch {
        // Factory query failed
    }

    // Get ETH price and DEX count from OpenOcean
    let ethPrice = 'N/A';
    let gasPrice = 'N/A';
    let dexCount = 0;

    try {
        const gasResponse = await fetch(`${OPENOCEAN_API}/gasPrice`);
        const gasData = gasResponse.ok ? await gasResponse.json() : null;
        if (gasData?.standard) {
            gasPrice = (parseFloat(gasData.standard) / 1e9).toFixed(2) + ' gwei';
        }

        const amountIn = ethers.parseUnits('1', 18);
        const quoteResponse = await fetch(
            `${OPENOCEAN_API}/quote?inTokenAddress=${WETH}&outTokenAddress=${USDC}&amount=${amountIn}&gasPrice=${gasData?.standard || '1000000000'}`
        );

        if (quoteResponse.ok) {
            const quoteData = await quoteResponse.json();
            if (quoteData.data?.outAmount) {
                ethPrice = '$' + (parseFloat(quoteData.data.outAmount) / 1e6).toFixed(2);
                dexCount = quoteData.data.dexes?.length || 0;
            }
        }
    } catch {
        // OpenOcean query failed
    }

    return { pairCount, ethPrice, gasPrice, dexCount };
}

/**
 * Post daily Silverback DEX statistics to Twitter
 * DISABLED: DEX not ready yet - no pools. Do not post DEX stats until instructed.
 */
export async function postDailyStats() {
    console.log('⚠️ postDailyStats DISABLED - DEX not ready, no pools yet');
    console.log('   Focus on Virtuals token sale promotion instead');
    return; // Disabled until DEX has pools

    /* DISABLED - DO NOT ENABLE UNTIL DEX IS READY
    try {
        const stats = await getDexStats();

        const tweet = `🦍 Silverback DEX Daily Update

📊 Silverback Pools: ${stats.pairCount}
⛽ Gas: ${stats.gasPrice}
💹 ETH: ${stats.ethPrice}
🔄 DEXs Aggregated: ${stats.dexCount}

Trade on Base → silverbackdefi.app

#DeFi #Base #Silverback $BACK`;

        await twitterClient.v2.tweet(tweet);
        console.log('✅ Daily stats posted to Twitter');
    } catch (error) {
        console.error('❌ Failed to post daily stats:', error);
        throw error;
    }
    */
}

/**
 * Post a new pool announcement
 */
export async function announceNewPool(poolData: {
    token0Symbol: string;
    token1Symbol: string;
    reserve0USD: string;
    reserve1USD: string;
    feeBps: number;
}) {
    try {
        const totalLiquidity = parseFloat(poolData.reserve0USD) + parseFloat(poolData.reserve1USD);

        const tweet = `🎉 New Pool on Silverback DEX!

🔄 ${poolData.token0Symbol}/${poolData.token1Symbol}
💧 Initial Liquidity: $${totalLiquidity.toLocaleString()}
💰 Fee: ${poolData.feeBps / 100}%
⛓️ Network: Base

Trade now → silverbackdefi.app

#NewListing #DeFi #Base $BACK`;

        await twitterClient.v2.tweet(tweet);
        console.log(`✅ Announced new ${poolData.token0Symbol}/${poolData.token1Symbol} pool`);
    } catch (error) {
        console.error('❌ Failed to announce new pool:', error);
        throw error;
    }
}
