/**
 * Silverback Agent Plugins
 *
 * This module exports all available plugin integrations:
 *
 * 1. On-Chain Actions - Real trading with GOAT SDK
 * 2. Image Generation - AI-powered images with Together AI
 *
 * Usage:
 * - Import specific plugins as needed
 * - Configure via environment variables
 * - Add to agent workers when ready
 */

export {
    createOnChainActionsWorker,
    isOnChainTradingEnabled,
    getWalletAddress
} from './onchain-actions';

export {
    createImageGenWorker,
    createImageGenPlugin,
    isImageGenAvailable,
    imagePromptTemplates
} from './imagegen';
