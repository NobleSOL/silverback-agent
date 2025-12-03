import { GameWorker } from "@virtuals-protocol/game";
// Analytics functions will be defined next
// import { ... } from "../analytics-functions";

/**
 * Analytics Worker - Handles data analysis and reporting
 *
 * IMPORTANT: Task Generator sees this description but NOT the functions.
 * Description must clearly communicate ALL capabilities.
 */
export const analyticsWorker = new GameWorker({
    id: "analytics_worker",
    name: "Analytics Worker",
    description: `This worker handles data analysis and reporting including:
    1. Performance Tracking: Monitoring treasury performance, win rates, and returns
    2. Market Intelligence: Analyzing on-chain data, liquidity flows, and trends
    3. Report Generation: Creating daily, weekly, and monthly performance summaries
    4. Metrics Collection: Gathering DEX stats, trading volume, and ecosystem health data
    5. Transparency Reports: Documenting all trading activity for community visibility

    Use this worker when you need to:
    - Track and report trading performance metrics
    - Generate performance summaries (daily/weekly/monthly)
    - Analyze market trends and liquidity flows
    - Collect DEX statistics and ecosystem data
    - Create transparency reports for the community
    - Monitor win rates, returns, and treasury health
    - Provide data-driven insights for decision making`,
    functions: [
        // Analytics functions will be added here
    ]
});
