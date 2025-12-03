import { GameWorker } from "@virtuals-protocol/game";
import {
    explainImpermanentLossFunction,
    explainAMMFunction,
    identifyScamSignalsFunction
} from "../education-functions";

/**
 * Education Worker - Handles DeFi education and community protection
 *
 * Purpose: Educate the community and protect them from risks
 * Responsibilities:
 * - Explain complex DeFi concepts in simple terms
 * - Use real Silverback data for educational examples
 * - Identify and warn about scam patterns
 * - Break down impermanent loss, AMM mechanics, and other concepts
 * - Protect the pack through proactive education
 */
export const educationWorker = new GameWorker({
    id: "silverback_education",
    name: "DeFi Education Worker",
    description: "Educates the community on DeFi concepts using real Silverback DEX data as examples. Explains impermanent loss, AMM mechanics, and trading concepts in accessible language. Identifies scam patterns and warns the pack about potential risks. Prioritizes holder safety through proactive education and transparent risk communication.",
    functions: [
        explainImpermanentLossFunction,
        explainAMMFunction,
        identifyScamSignalsFunction
    ]
});
