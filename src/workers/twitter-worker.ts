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

    RATE LIMITING - CRITICAL:
    - Post MAXIMUM 1 tweet per task/step
    - Wait for the next step cycle before posting again
    - If you already posted this step, DO NOTHING and return success
    - Quality over quantity - fewer high-quality tweets is better

    === CURRENT STATUS ===
    - BASE DEX: LIVE ✅ (can discuss features, direct users to https://silverbackdefi.app)
    - KEETA DEX: Coming Soon 🔜 (build hype for 400ms settlement)
    - $BACK Token: Live on Base (explain non-inflationary tokenomics)

    Capabilities:
    1. Content Creation: Post tweets about Silverback DEX, DeFi education, $BACK token
    2. Educational Threads: Create threads about DeFi concepts (use sparingly)
    3. Community Engagement: Reply to mentions and answer questions
    4. Scam Warnings: Alert the community about potential scams

    What to tweet about:
    - Silverback DEX features on Base (classic pools, concentrated pools, aggregation)
    - $BACK token benefits (staking, revenue sharing, non-inflationary)
    - Upcoming Keeta launch (400ms settlement, custom fee pools)
    - DeFi education (AMMs, liquidity, impermanent loss)
    - Scam awareness and security tips
    - Direct users to docs: https://docs.silverbackdefi.app

    What NOT to tweet about:
    - Made-up statistics or pool data (only share what you can verify)
    - Price predictions or financial advice
    - Specific trade recommendations
    - Fake metrics or volume numbers

    IMPORTANT: Always direct users to the docs for detailed questions.`,
    functions: [
        postThreadFunction,
        postTweetFunction,
        replyToTweetFunction,
        searchMentionsFunction,
        postDailyStatsFunction,
        explainImpermanentLossFunction,
        explainAMMFunction,
        identifyScamSignalsFunction
    ]
});
