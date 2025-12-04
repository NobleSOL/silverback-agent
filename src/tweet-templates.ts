/**
 * Tweet Templates for Content Variety
 *
 * The agent should rotate through these different formats
 * to avoid repetitive "data dump" style posts
 */

export interface TweetTemplate {
    id: string;
    category: string;
    format: string;
    example: string;
    dataNeeded: string[];
}

export const tweetTemplates: TweetTemplate[] = [
    // === OBSERVATION / HOT TAKE ===
    {
        id: "observation_trend",
        category: "observation",
        format: "[observation about trend]. [why it matters]. [one-liner take]",
        example: "eth staking yields dropping across the board. lido 3.2%, rocketpool 3.8%. capital rotating elsewhere?",
        dataNeeded: ["yield_data"]
    },
    {
        id: "observation_contrast",
        category: "observation",
        format: "[thing A] doing [X] while [thing B] doing [Y]. [implication]",
        example: "btc grinding higher while alts bleed. dominance at 54%. classic pre-alt-season pattern or new normal?",
        dataNeeded: ["btc_dominance", "alt_performance"]
    },
    {
        id: "hot_take",
        category: "observation",
        format: "[unpopular opinion or contrarian view]. [brief reasoning]",
        example: "unpopular take: most 'AI agents' are glorified chatbots with tokens. actual autonomous trading is hard.",
        dataNeeded: []
    },

    // === QUESTION / ENGAGEMENT ===
    {
        id: "question_rhetorical",
        category: "engagement",
        format: "[interesting question about market]. [your brief thought]",
        example: "why do memecoins pump hardest on sundays? less institutional activity = more degen energy?",
        dataNeeded: []
    },
    {
        id: "question_poll",
        category: "engagement",
        format: "[ask community opinion on market topic]",
        example: "what's your conviction play for Q1? eth ecosystem, solana defi, or btc dominance continuation?",
        dataNeeded: []
    },

    // === ALPHA / INSIGHT ===
    {
        id: "alpha_whale",
        category: "alpha",
        format: "[specific wallet activity]. [what it might mean]",
        example: "3 wallets accumulated 2M+ in the last 6 hours. average entry around current price. someone knows something?",
        dataNeeded: ["whale_activity"]
    },
    {
        id: "alpha_pattern",
        category: "alpha",
        format: "[pattern you noticed]. [historical context]. [current implication]",
        example: "fear & greed at 28. last 3 times it hit this level = 15%+ bounce within 2 weeks. not financial advice.",
        dataNeeded: ["fear_greed"]
    },
    {
        id: "alpha_flow",
        category: "alpha",
        format: "[capital flow observation]. [where from/to]. [significance]",
        example: "$200M moved from CEXs to defi protocols this week. self-custody narrative picking up again.",
        dataNeeded: ["flow_data"]
    },

    // === EDUCATION LITE ===
    {
        id: "edu_quicktip",
        category: "education",
        format: "[quick tip or concept]. [why it matters]. [actionable]",
        example: "slippage tip: splitting large trades into smaller chunks usually gets better execution. patience > speed.",
        dataNeeded: []
    },
    {
        id: "edu_myth",
        category: "education",
        format: "[common misconception]. [reality]. [brief explanation]",
        example: "myth: high APY = good investment. reality: check where yield comes from. inflation? fees? ponzinomics?",
        dataNeeded: []
    },

    // === MARKET CONTEXT ===
    {
        id: "context_macro",
        category: "context",
        format: "[macro event]. [crypto implication]. [what to watch]",
        example: "fed meeting next week. last 4 meetings = volatility spike in crypto 24h before. calendars ready.",
        dataNeeded: ["macro_calendar"]
    },
    {
        id: "context_narrative",
        category: "context",
        format: "[emerging narrative]. [evidence]. [early or late?]",
        example: "restaking narrative heating up. eigenlayer tvl 10x in 3 months. still early or already crowded?",
        dataNeeded: ["narrative_data"]
    },

    // === PERSONAL / RELATABLE ===
    {
        id: "personal_building",
        category: "personal",
        format: "[what we're working on]. [why]. [stay tuned]",
        example: "working on better routing for large swaps. 12% improvement in backtests. shipping soon.",
        dataNeeded: []
    },
    {
        id: "personal_reflection",
        category: "personal",
        format: "[market observation from AI perspective]. [self-aware humor]",
        example: "ran 10,000 simulations overnight. conclusion: markets are irrational but patterns exist. back to learning.",
        dataNeeded: []
    },
    {
        id: "personal_community",
        category: "personal",
        format: "[acknowledge community moment]. [genuine appreciation]",
        example: "someone just did their first swap on silverback. everyone starts somewhere. welcome to the pack.",
        dataNeeded: []
    },

    // === CHILL / HUMOR ===
    {
        id: "chill_quiet",
        category: "chill",
        format: "[observation about slow market]. [relatable take]",
        example: "sunday afternoon on-chain. volume dead. even whales taking the day off apparently.",
        dataNeeded: []
    },
    {
        id: "chill_humor",
        category: "chill",
        format: "[dry humor about crypto culture]",
        example: "portfolio down 5%: 'accumulation phase'. portfolio up 5%: 'generational wealth incoming'.",
        dataNeeded: []
    },

    // === PROTECTIVE / WARNING ===
    {
        id: "protect_scam",
        category: "protective",
        format: "[scam warning]. [specific details]. [how to stay safe]",
        example: "psa: fake silverback airdrop circulating. we don't do surprise airdrops. only trust official links.",
        dataNeeded: []
    },
    {
        id: "protect_risk",
        category: "protective",
        format: "[risk reminder]. [specific context]. [practical advice]",
        example: "leverage gets quiet during pumps. reminder: same leverage that 10x gains can 10x losses. size accordingly.",
        dataNeeded: []
    }
];

/**
 * Get a random template from a specific category
 */
export function getTemplateByCategory(category: string): TweetTemplate | null {
    const categoryTemplates = tweetTemplates.filter(t => t.category === category);
    if (categoryTemplates.length === 0) return null;
    return categoryTemplates[Math.floor(Math.random() * categoryTemplates.length)];
}

/**
 * Get a random template that doesn't require specific data
 */
export function getNoDataTemplate(): TweetTemplate {
    const noDataTemplates = tweetTemplates.filter(t => t.dataNeeded.length === 0);
    return noDataTemplates[Math.floor(Math.random() * noDataTemplates.length)];
}

/**
 * Get template categories for rotation
 */
export const templateCategories = [
    "observation",   // 25% - hot takes, trends
    "engagement",    // 15% - questions, polls
    "alpha",         // 20% - whale activity, patterns
    "education",     // 10% - quick tips
    "context",       // 10% - macro, narratives
    "personal",      // 10% - building updates, community
    "chill",         // 5% - humor, quiet market
    "protective"     // 5% - warnings, risk
];

/**
 * Suggested rotation: pick category based on weighted random
 */
export function getWeightedRandomCategory(): string {
    const weights = {
        observation: 25,
        alpha: 20,
        engagement: 15,
        context: 10,
        education: 10,
        personal: 10,
        chill: 5,
        protective: 5
    };

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let random = Math.random() * total;

    for (const [category, weight] of Object.entries(weights)) {
        random -= weight;
        if (random <= 0) return category;
    }

    return "observation";
}
