import { GameWorker } from "@virtuals-protocol/game";
import {
    getSwapQuoteFunction,
    getPoolsFunction,
    getDEXMetricsFunction,
    getTokenPriceFunction,
    getPoolInfoFunction
} from "./functions";

// Create Silverback DEX worker with our custom functions
export const silverbackDEXWorker = new GameWorker({
    id: "silverback_dex",
    name: "Silverback DEX Worker",
    description: "Provides Silverback DEX data including swap quotes, pool information, prices, and DEX metrics for the Keeta Network",
    functions: [
        getSwapQuoteFunction,
        getPoolsFunction,
        getDEXMetricsFunction,
        getTokenPriceFunction,
        getPoolInfoFunction
    ]
}); 