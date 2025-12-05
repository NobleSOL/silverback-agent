/**
 * Silverback Agent Plugins
 *
 * This module exports all available plugin integrations:
 *
 * 1. On-Chain Actions - Real trading with GOAT SDK
 * 2. Image Generation - AI-powered images with Together AI
 * 3. Telegram - Trading signals and community alerts
 * 4. TokenMetrics - AI trading signals and token grades
 * 5. CoinGecko - Enhanced market data and analytics
 *
 * Usage:
 * - Import specific plugins as needed
 * - Configure via environment variables
 * - Add to agent workers when ready
 */

// On-Chain Trading
export {
    createOnChainActionsWorker,
    isOnChainTradingEnabled,
    getWalletAddress,
    TOKEN_ADDRESSES
} from './onchain-actions';

// Image Generation
export {
    createImageGenWorker,
    createImageGenPlugin,
    isImageGenAvailable,
    imagePromptTemplates
} from './imagegen';

// Telegram Integration
export {
    createTelegramPlugin,
    getTelegramWorker,
    isTelegramAvailable,
    sendTradingSignalFunction,
    sendPerformanceUpdateFunction,
    telegramTemplates
} from './telegram';

// TokenMetrics AI Signals (70% win rate)
export {
    isTokenMetricsAvailable,
    getApiUsageStats,
    getAITradingSignalsFunction,
    getTokenGradesFunction,
    getResistanceSupportFunction,
    getPricePredictionsFunction,
    getMarketSentimentFunction,
    getApiUsageFunction
} from './token-metrics';

// CoinGecko Enhanced Data
export {
    isCoinGeckoProAvailable,
    getTokenDetailsFunction,
    getOHLCVDataFunction,
    getGlobalMarketDataFunction,
    getTopMoversFunction,
    searchTokensFunction
} from './coingecko';
