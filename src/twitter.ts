import TwitterPlugin from "@virtuals-protocol/game-twitter-plugin";
import { TwitterApi } from "@virtuals-protocol/game-twitter-node";
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
 * Post daily Silverback DEX statistics to Twitter
 */
export async function postDailyStats() {
    try {
        const DEX_API_URL = process.env.DEX_API_URL || 'https://dexkeeta.onrender.com/api';
        
        // Fetch pool data
        const poolsResponse = await fetch(`${DEX_API_URL}/anchor/pools`);
        const pools = await poolsResponse.json();
        
        // Calculate metrics
        const activePools = pools.filter((p: any) => p.status === 'active');
        const totalLiquidity = pools.reduce((sum: number, p: any) => {
            return sum + (parseFloat(p.reserve0USD || '0') + parseFloat(p.reserve1USD || '0'));
        }, 0);
        
        const tweet = `🦍 Silverback DEX Daily Update

📊 Active Pools: ${activePools.length}
💧 Total Liquidity: $${totalLiquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
⚡ Network: Keeta (400ms blocks)

Trade on Silverback DEX → dexkeeta.onrender.com

#DeFi #Keeta #Silverback`;

        await twitterClient.v2.tweet(tweet);
        console.log('✅ Daily stats posted to Twitter');
    } catch (error) {
        console.error('❌ Failed to post daily stats:', error);
        throw error;
    }
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

Start trading now → dexkeeta.onrender.com

#NewListing #DeFi`;

        await twitterClient.v2.tweet(tweet);
        console.log(`✅ Announced new ${poolData.token0Symbol}/${poolData.token1Symbol} pool`);
    } catch (error) {
        console.error('❌ Failed to announce new pool:', error);
        throw error;
    }
}
