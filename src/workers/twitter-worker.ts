import { GameWorker } from "@virtuals-protocol/game";
import {
    postTweetFunction,
    postDailyStatsFunction,
    replyToTweetFunction,
    searchMentionsFunction,
    postThreadFunction
} from "../twitter-functions";
import {
    explainImpermanentLossFunction,
    explainAMMFunction,
    identifyScamSignalsFunction
} from "../education-functions";
import {
    getMarketOverviewFunction,
    getDefiMetricsFunction,
    getVirtualsDataFunction
} from "../market-data-functions";

/**
 * Twitter Worker - Handles all Twitter/X interactions
 *
 * IMPORTANT: Task Generator sees this description but NOT the functions.
 * Description must clearly communicate ALL capabilities.
 */
export const twitterWorker = new GameWorker({
    id: "twitter_worker",
    name: "Twitter Worker",
    description: `This worker handles Twitter/X interactions for community building.

    === DATA-DRIVEN CONTENT - CRITICAL ===
    BEFORE posting ANY market update:
    1. ALWAYS call get_market_overview first to get real BTC/ETH prices and changes
    2. Use get_defi_metrics for DeFi TVL data
    3. Use get_virtuals_ecosystem for Virtuals Protocol data

    NEVER post vague statements like "DeFi Market Update: Recent surge in stablecoin demand"
    ALWAYS include specific numbers like "Stablecoin market cap hits $150B, up 5% this week"

    === RATE LIMITING ===
    - Post MAXIMUM 1 tweet per task/step
    - Quality over quantity - data-rich tweets perform better

    === CONTENT PRIORITIES (in order) ===
    1. Virtuals Protocol Launch Promotion - We're LIVE on Virtuals! Share this news.
    2. Silverback DEX Features - Base DEX is LIVE at https://silverbackdefi.app
    3. Market Updates with REAL DATA - Always include $ amounts, % changes
    4. Community Engagement - Answer questions, engage with mentions
    5. DeFi Education - Tie to current market conditions with data

    === CURRENT STATUS ===
    - $BACK Token: LIVE on Virtuals Protocol (Base chain)
    - BASE DEX: LIVE ✅ at https://silverbackdefi.app
    - KEETA DEX: Coming Soon 🔜 (400ms settlement)

    === EXAMPLE GOOD TWEETS ===
    - "ETH up 3.2% to $3,450 today. Base network TVL continues growing. Perfect time to explore Silverback DEX - live at silverbackdefi.app"
    - "$BACK is live on Virtuals Protocol! Non-inflationary tokenomics: protocol revenue → buybacks → staking rewards. No new supply dilution."
    - "DeFi TVL: $95B across major protocols. Silverback DEX on Base offering 0.3% swap fees with OpenOcean aggregation for best rates."

    === EXAMPLE BAD TWEETS (AVOID) ===
    - "DeFi market showing interesting movements" (no specific data)
    - "Stablecoin demand increasing" (no numbers)
    - "Market looking bullish" (vague, no context)

    === WHAT TO TWEET ABOUT ===
    - Virtuals Protocol launch and $BACK token
    - Silverback DEX features (classic pools, concentrated pools, aggregation)
    - Market updates WITH REAL NUMBERS from get_market_overview
    - DeFi trends WITH ACTUAL TVL DATA from get_defi_metrics
    - Keeta network launch hype (400ms settlement, custom fees)

    IMPORTANT: Always use the market data functions before posting market-related content.`,
    functions: [
        // Market data functions - call these FIRST before posting
        getMarketOverviewFunction,
        getDefiMetricsFunction,
        getVirtualsDataFunction,
        // Twitter posting functions
        postThreadFunction,
        postTweetFunction,
        replyToTweetFunction,
        searchMentionsFunction,
        postDailyStatsFunction,
        // Education functions
        explainImpermanentLossFunction,
        explainAMMFunction,
        identifyScamSignalsFunction
    ]
});
