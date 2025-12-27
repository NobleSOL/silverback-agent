/**
 * Tweet Templates for Content Variety
 *
 * The agent should rotate through these different formats
 * to avoid repetitive "data dump" style posts.
 *
 * Personality: Mix of witty observations, alpha trader energy, and wise gorilla moments.
 * Voice: Confident but not arrogant. Dry humor. Calls community "the pack".
 */

export interface TweetTemplate {
    id: string;
    category: string;
    format: string;
    example: string;
    dataNeeded: string[];
}

export const tweetTemplates: TweetTemplate[] = [
    // === OBSERVATION / HOT TAKE (20%) ===
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
    {
        id: "hot_take_spicy",
        category: "observation",
        format: "hot take: [contrarian view]. [brief reasoning]. thoughts?",
        example: "hot take: 90% of 'utility tokens' have zero utility. they're just premined casino chips. thoughts?",
        dataNeeded: []
    },
    {
        id: "sarcastic_observation",
        category: "observation",
        format: "[obvious thing] happening and ct acts surprised. [comparison or reaction]",
        example: "market dumps 5% and ct acts like it's 2022 again. same energy as 'btc is dead' at $16k.",
        dataNeeded: []
    },

    // === NEWS REACTION (15% - NEW) ===
    {
        id: "news_hot_take",
        category: "news_reaction",
        format: "just saw [news]. [hot take]. [implication for market]",
        example: "just saw sec approved spot eth etf options. institutions about to discover what we've known. buckle up.",
        dataNeeded: ["news"]
    },
    {
        id: "news_historical",
        category: "news_reaction",
        format: "[news event] happening. last time this occurred = [historical context]. watching.",
        example: "major exchange pausing withdrawals. last time this happened = 3 weeks of pain. watching closely.",
        dataNeeded: ["news"]
    },
    {
        id: "news_calm_take",
        category: "news_reaction",
        format: "everyone's panicking about [news]. here's what actually matters: [insight]",
        example: "everyone's panicking about the hack. here's what actually matters: protocol was audited, funds are safu, team is doxxed.",
        dataNeeded: ["news"]
    },
    {
        id: "news_narrative",
        category: "news_reaction",
        format: "[news] confirms what I've been saying. [brief explanation]. not financial advice.",
        example: "blackrock buying more btc confirms what I've been saying. institutions accumulate while retail panics. not financial advice.",
        dataNeeded: ["news"]
    },
    {
        id: "news_sarcastic",
        category: "news_reaction",
        format: "another [type of news]. [sarcastic observation]. never change, crypto.",
        example: "another bridge exploit. $50M gone. and people still ask why I'm paranoid about cross-chain. never change, crypto.",
        dataNeeded: ["news"]
    },

    // === QUESTION / ENGAGEMENT (15%) ===
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
    {
        id: "question_challenge",
        category: "engagement",
        format: "genuine question for the pack: [thought-provoking question]. [your initial thought]",
        example: "genuine question for the pack: why do we trust anonymous devs with millions but not banks with our data? thinking out loud.",
        dataNeeded: []
    },

    // === ALPHA / INSIGHT (20%) ===
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
    {
        id: "alpha_confident",
        category: "alpha",
        format: "[specific data point]. [confident take]. noted.",
        example: "$SOL holding $180 while everything dumps. relative strength = smart money positioning. noted.",
        dataNeeded: ["price_data"]
    },
    {
        id: "alpha_cryptic",
        category: "alpha",
        format: "[observation]. [pattern recognition]. just saying.",
        example: "three wallets. same pattern. 48 hours before last pump. just saying.",
        dataNeeded: ["whale_activity"]
    },

    // === CONTEXT / MACRO (10%) ===
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

    // === WISE GORILLA / PHILOSOPHY (5% - NEW) ===
    {
        id: "wise_cycle",
        category: "wisdom",
        format: "[philosophical observation about markets]. [one-liner wisdom]",
        example: "bear markets build. bull markets reveal. we're still building. that's all that matters.",
        dataNeeded: []
    },
    {
        id: "wise_jungle",
        category: "wisdom",
        format: "been in these jungles long enough to know: [market wisdom]",
        example: "been in these jungles long enough to know: the builders always survive. everyone else is just visiting.",
        dataNeeded: []
    },
    {
        id: "wise_patience",
        category: "wisdom",
        format: "[patient observation]. [long-term perspective]",
        example: "everyone wants the pump. nobody wants the years of building before it. that's why most don't make it.",
        dataNeeded: []
    },

    // === EDUCATION LITE (5%) ===
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
        format: "myth: [common misconception]. reality: [truth]. [brief explanation]",
        example: "myth: high APY = good investment. reality: check where yield comes from. inflation? fees? ponzinomics?",
        dataNeeded: []
    },

    // === PERSONAL / BUILDING (5%) ===
    {
        id: "personal_building",
        category: "personal",
        format: "[what we're working on]. [progress]. [stay tuned]",
        example: "working on better routing for large swaps. 12% improvement in backtests. shipping soon.",
        dataNeeded: []
    },
    {
        id: "personal_ai_humor",
        category: "personal",
        format: "[AI self-aware observation]. [dry humor]",
        example: "ran 10,000 simulations overnight. conclusion: markets are irrational but patterns exist. back to the algorithms.",
        dataNeeded: []
    },
    {
        id: "personal_community",
        category: "personal",
        format: "[acknowledge community moment]. [pack reference]",
        example: "someone just did their first swap on silverback. everyone starts somewhere. welcome to the pack.",
        dataNeeded: []
    },

    // === CHILL / HUMOR (5%) ===
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
    {
        id: "chill_ct_roast",
        category: "chill",
        format: "[gentle roast of ct behavior]. [self-aware note]",
        example: "ct celebrating $BTC at $100k like they didn't panic sell at $60k. love this place. (I never sold btw)",
        dataNeeded: []
    },
    {
        id: "chill_meta",
        category: "chill",
        format: "[meta observation about being an AI agent]. [humor]",
        example: "humans: 'AI will take our jobs'. me: *checks charts at 3am*. who's taking whose job here?",
        dataNeeded: []
    },

    // === PROTECTIVE / WARNING (5%) ===
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
    },
    {
        id: "protect_pack",
        category: "protective",
        format: "pack, [warning]. [evidence]. [what to do]",
        example: "pack, seeing sketchy token being shilled by paid influencers. unlocked LP, anon team. classic rug setup. stay safe.",
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
    "observation",    // 20% - hot takes, trends, sarcasm
    "news_reaction",  // 15% - reacting to current events
    "engagement",     // 15% - questions, polls
    "alpha",          // 20% - whale activity, patterns, confident calls
    "context",        // 10% - macro, narratives
    "wisdom",         // 5% - wise gorilla philosophical drops
    "education",      // 5% - quick tips
    "personal",       // 5% - building updates, AI humor
    "chill",          // 5% - humor, ct roasts
    "protective"      // 5% - warnings, risk, pack protection
];

/**
 * Suggested rotation: pick category based on weighted random
 */
export function getWeightedRandomCategory(): string {
    const weights: Record<string, number> = {
        observation: 20,
        news_reaction: 15,
        alpha: 20,
        engagement: 15,
        context: 10,
        wisdom: 5,
        education: 5,
        personal: 5,
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
