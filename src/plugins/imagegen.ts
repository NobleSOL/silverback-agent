/**
 * Image Generation Plugin Integration
 * Enables AI-powered image generation using Together AI's FLUX model
 *
 * Use cases:
 * - Generate charts and visualizations for tweets
 * - Create branded images for announcements
 * - Generate educational diagrams
 */

import ImageGenPlugin from "@virtuals-protocol/game-imagegen-plugin";
import dotenv from "dotenv";

dotenv.config();

// Default API key from the plugin documentation
const DEFAULT_TOGETHER_API_KEY = "UP-17f415babba7482cb4b446a1";

/**
 * Create the image generation worker
 * Uses Together AI for image generation
 */
export function createImageGenWorker() {
    const apiKey = process.env.TOGETHER_API_KEY || DEFAULT_TOGETHER_API_KEY;

    const imageGenPlugin = new ImageGenPlugin({
        apiClientConfig: {
            apiKey: apiKey,
        },
    });

    console.log("✅ Image generation worker created");
    return imageGenPlugin.getWorker({});
}

/**
 * Create ImageGenPlugin instance for direct use
 */
export function createImageGenPlugin() {
    const apiKey = process.env.TOGETHER_API_KEY || DEFAULT_TOGETHER_API_KEY;

    return new ImageGenPlugin({
        id: "silverback_imagegen",
        name: "Silverback Image Generator",
        description: "Generate images for tweets, charts, and visualizations",
        apiClientConfig: {
            apiKey: apiKey,
        },
    });
}

/**
 * Check if image generation is available
 */
export function isImageGenAvailable(): boolean {
    return !!(process.env.TOGETHER_API_KEY || DEFAULT_TOGETHER_API_KEY);
}

/**
 * Image prompt templates for consistent branding
 */
export const imagePromptTemplates = {
    marketChart: (trend: 'up' | 'down' | 'sideways', asset: string) =>
        `Professional cryptocurrency trading chart showing ${asset} with ${trend === 'up' ? 'bullish green candlesticks trending upward' : trend === 'down' ? 'bearish red candlesticks trending downward' : 'ranging sideways movement'}. Dark theme with neon accents. Clean minimalist style. No text overlays.`,

    announcement: (topic: string) =>
        `Professional announcement banner for crypto DeFi project. Theme: ${topic}. Dark purple and gold color scheme. Gorilla silhouette watermark. Modern minimalist design. No text.`,

    ecosystem: (chain: string) =>
        `Abstract visualization of ${chain} blockchain ecosystem. Network nodes connected by glowing lines. Dark space theme with ${chain === 'Base' ? 'blue' : 'purple'} accent colors. Futuristic and professional.`,

    comparison: (assets: string[]) =>
        `Side by side cryptocurrency comparison visualization showing ${assets.join(' vs ')}. Clean infographic style. Dark theme with contrasting colors for each asset. No specific numbers or text.`,

    whale: () =>
        `Artistic representation of a crypto whale - large whale silhouette made of golden coins and blockchain nodes swimming through digital ocean. Dark blue background. Ethereal and mystical.`,

    defi: () =>
        `Abstract DeFi concept art. Liquidity pools as glowing orbs, yield farming as growing digital plants, swaps as energy transfers between nodes. Purple and teal color scheme. Futuristic.`
};
