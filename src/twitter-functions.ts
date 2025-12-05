import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { twitterClient, postDailyStats, announceNewPool, getOwnUserId } from "./twitter";
import { stateManager } from "./state/state-manager";

// Track tweets we've already replied to (in-memory cache + database)
let repliedTweetIds: Set<string> = new Set();
let repliedIdsLoaded = false;

// Initialize from database on first access
async function loadRepliedTweetIds(): Promise<Set<string>> {
    if (!repliedIdsLoaded) {
        try {
            repliedTweetIds = await stateManager.getRepliedTweetIds();
            repliedIdsLoaded = true;
            console.log(`📝 Loaded ${repliedTweetIds.size} replied tweet IDs from database`);
        } catch (e) {
            console.error('Failed to load replied tweet IDs:', e);
        }
    }
    return repliedTweetIds;
}

// Mark tweet as replied (saves to both memory and database)
async function markTweetAsReplied(tweetId: string): Promise<void> {
    repliedTweetIds.add(tweetId);
    await stateManager.markTweetReplied(tweetId);
}

// Check if already replied
async function hasRepliedToTweet(tweetId: string): Promise<boolean> {
    await loadRepliedTweetIds();
    if (repliedTweetIds.has(tweetId)) return true;
    return await stateManager.hasRepliedToTweet(tweetId);
}

// BANNED PHRASES - these make tweets sound like a bot/marketing
const BANNED_PHRASES = [
    '#',  // No hashtags at all
    'did you know',
    'learn more',
    'learn about',
    'check out',
    'discover how',
    'find out',
    'total tvl',
    'tvl of $',
    'ecosystem has a total',
    'ecosystem metrics',
    'top protocols like',
    'top protocols include',
    'leading the way',
    'currently, the',
    'non-inflationary tokenomics',
    'benefits you',
    'ensures no new supply',
    'preventing dilution',
    "silverback dex's approach",
    "silverback dex's",
    'notusinghash',
    'not using hash',
];

// Clean old database entries every hour
setInterval(async () => {
    try {
        await stateManager.cleanOldRepliedTweets();
        console.log('🧹 Cleaned old replied tweet records from database');
    } catch (e) {
        console.error('Failed to clean old records:', e);
    }
}, 3600000);

/**
 * Check for banned phrases that make tweets sound robotic
 */
function containsBannedPhrase(content: string): string | null {
    const lower = content.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
        if (lower.includes(phrase.toLowerCase())) {
            return phrase;
        }
    }
    return null;
}

/**
 * Detect the topic of a tweet
 */
function detectTopic(content: string): string {
    const lower = content.toLowerCase();

    // Detect promotional/marketing content (still blocked)
    if (lower.includes("silverback dex's") || lower.includes('silverback approach') ||
        lower.includes('tokenomics') || lower.includes('learn about silverback')) return 'silverback_promo';

    // Price movement topics (PRIORITIZE THESE)
    if ((lower.includes('pump') || lower.includes('dump') || lower.includes('rip') || lower.includes('dip')) &&
        (lower.includes('%') || lower.includes('price'))) return 'price_swing';
    if (lower.includes('breakout') || lower.includes('breakdown') || lower.includes('resistance') || lower.includes('support')) return 'technical';
    if (lower.includes('ath') || lower.includes('all-time') || lower.includes('all time')) return 'price_ath';
    if ((lower.includes('up ') || lower.includes('down ')) && lower.includes('%')) return 'price_move';
    if (lower.includes('rally') || lower.includes('crash') || lower.includes('moon') || lower.includes('tank')) return 'price_action';

    // TVL/DeFi - now regular topics (not blocked, just rotated)
    if (lower.includes('tvl') || lower.includes('total value locked')) return 'tvl';
    if (lower.includes('defi') && (lower.includes('metric') || lower.includes('ecosystem'))) return 'defi_metrics';

    // Other market topics
    if (lower.includes('fear') && lower.includes('greed')) return 'fear_greed';
    if (lower.includes('btc') || lower.includes('bitcoin')) return 'btc';
    if (lower.includes('eth') || lower.includes('ethereum')) return 'eth';
    if (lower.includes('dominance')) return 'dominance';
    if (lower.includes('whale') || lower.includes('accumul')) return 'whales';
    if (lower.includes('base') && (lower.includes('chain') || lower.includes('l2'))) return 'base';
    if (lower.includes('keeta')) return 'keeta';
    if (lower.includes('aave') || lower.includes('uniswap') || lower.includes('lido')) return 'defi_protocols';
    if (lower.includes('meme') || lower.includes('pepe') || lower.includes('doge') || lower.includes('shib') || lower.includes('bonk') || lower.includes('wif')) return 'memecoins';
    if (lower.includes('sol') || lower.includes('solana')) return 'solana';
    if (lower.includes('yield') || lower.includes('apy') || lower.includes('apr')) return 'yields';
    if (lower.includes('arb') || lower.includes('arbitrum') || lower.includes('optimism') || lower.includes(' op ')) return 'l2s';
    if (lower.includes('ai ') || lower.includes('render') || lower.includes('fetch') || lower.includes('bittensor') || lower.includes('tao')) return 'ai_tokens';
    if (lower.includes('volume') || lower.includes('liquidity')) return 'volume';
    if (lower.includes('narrative') || lower.includes('sector') || lower.includes('rotation')) return 'narratives';

    return 'general';
}

/**
 * Check if tweet should be blocked (uses database for persistence)
 */
async function shouldBlockTweet(newContent: string): Promise<{ block: boolean; reason?: string }> {
    // Check for banned phrases first
    const bannedPhrase = containsBannedPhrase(newContent);
    if (bannedPhrase) {
        return {
            block: true,
            reason: `BLOCKED: Contains "${bannedPhrase}". No hashtags, no marketing speak. Be natural - try a hot take, question, or observation.`
        };
    }

    const newTopic = detectTopic(newContent);

    // Block promotional content
    if (newTopic === 'silverback_promo') {
        return {
            block: true,
            reason: `BLOCKED: Too promotional. Don't shill Silverback. Just share market insights or observations naturally.`
        };
    }

    // Note: TVL/DeFi metrics are now allowed but will be rotated via topic tracking

    // Check if same topic was posted recently (from database)
    const recentTopics = await stateManager.getRecentTopics(5);
    if (recentTopics.includes(newTopic) && newTopic !== 'general') {
        return {
            block: true,
            reason: `BLOCKED: Already posted about "${newTopic}". Pick a DIFFERENT topic.`
        };
    }

    // Check word similarity against recent tweets from database
    const normalizedNew = newContent.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const newWords = new Set(normalizedNew.split(/\s+/).filter(w => w.length > 3));

    const recentTweets = await stateManager.getRecentPostedTweets(4); // Last 4 hours
    for (const recent of recentTweets) {
        const normalizedRecent = recent.content.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

        if (normalizedNew === normalizedRecent) {
            return { block: true, reason: "BLOCKED: Exact duplicate" };
        }

        const recentWords = new Set(normalizedRecent.split(/\s+/).filter(w => w.length > 3));
        const overlap = [...newWords].filter(w => recentWords.has(w)).length;
        const overlapRatio = overlap / Math.max(newWords.size, recentWords.size);

        if (overlapRatio > 0.4) {
            return { block: true, reason: `BLOCKED: ${Math.round(overlapRatio * 100)}% similar to recent tweet. Be more creative.` };
        }
    }

    return { block: false };
}

/**
 * Post a tweet with DEX updates or insights
 */
export const postTweetFunction = new GameFunction({
    name: "post_tweet",
    description: "Post a tweet. IMPORTANT: You MUST vary your content! Do NOT post about the same topic twice. If you posted about DeFi/TVL, next post about something completely different like memecoins, yields, L2s, or a hot take. AVOID hashtags.",
    args: [
        {
            name: "content",
            description: "Tweet content (max 280 chars). MUST be different topic from recent posts. If blocked for similarity, try: altcoins, memecoins, yields, L2 comparison, market observation, or building update."
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.content || args.content.length === 0) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Tweet content cannot be empty"
                );
            }

            if (args.content.length > 280) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `Tweet too long (${args.content.length} chars). Max 280 characters.`
                );
            }

            // Check for blocked content (banned phrases, duplicate topics, similarity)
            const blockCheck = await shouldBlockTweet(args.content);
            if (blockCheck.block) {
                logger(`Blocked: ${blockCheck.reason}`);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    blockCheck.reason || "Content blocked"
                );
            }

            // Detect and track topic
            const topic = detectTopic(args.content);

            logger(`Posting tweet (topic: ${topic}): "${args.content}"`);
            const result = await twitterClient.v2.tweet(args.content);

            // Track this tweet in database for persistence across restarts
            await stateManager.recordPostedTweet(args.content, topic);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    tweetId: result.data.id,
                    text: args.content,
                    topic: topic,
                    url: `https://x.com/user/status/${result.data.id}`
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to post tweet: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Post daily DEX statistics
 */
export const postDailyStatsFunction = new GameFunction({
    name: "post_daily_stats",
    description: "Post daily Silverback DEX statistics to Twitter, including active pools, total liquidity, and network info. Use this for regular community updates.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Posting daily DEX statistics to Twitter");
            await postDailyStats();

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    message: "Daily stats posted successfully"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to post daily stats: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Reply to a tweet
 */
export const replyToTweetFunction = new GameFunction({
    name: "reply_to_tweet",
    description: "Reply to a specific tweet. Use this to answer questions about Silverback DEX, engage with community, or provide helpful information.",
    args: [
        {
            name: "tweetId",
            description: "The ID of the tweet to reply to"
        },
        {
            name: "content",
            description: "The reply content (max 280 characters)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.tweetId || !args.tweetId.trim()) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Tweet ID is required"
                );
            }

            if (!args.content || args.content.length === 0) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Reply content cannot be empty"
                );
            }

            if (args.content.length > 280) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `Reply too long (${args.content.length} chars). Max 280 characters.`
                );
            }

            const tweetId = args.tweetId;
            const content = args.content;

            // Check if we've already replied to this tweet (checks both memory and database)
            if (await hasRepliedToTweet(tweetId)) {
                logger(`Blocked duplicate reply to tweet ${tweetId} - already replied`);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Already replied to this tweet. Find a different tweet to engage with."
                );
            }

            // Check if this is our own tweet - don't reply to ourselves
            try {
                const tweet = await twitterClient.v2.singleTweet(tweetId, { 'tweet.fields': ['author_id'] });
                const ownId = await getOwnUserId();
                if (tweet.data.author_id === ownId) {
                    logger(`Blocked self-reply to own tweet ${tweetId}`);
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        "Cannot reply to own tweets - find other users to engage with instead"
                    );
                }
            } catch (lookupError) {
                // If we can't verify, proceed but log warning
                logger(`Warning: Could not verify tweet author, proceeding with reply`);
            }

            logger(`Replying to tweet ${tweetId}: "${content}"`);
            const result = await twitterClient.v2.reply(content, tweetId);

            // Track this reply to prevent duplicates (saves to database for persistence)
            await markTweetAsReplied(tweetId);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    tweetId: result.data.id,
                    inReplyTo: args.tweetId,
                    text: args.content
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to reply to tweet: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Search recent tweets mentioning Silverback
 */
export const searchMentionsFunction = new GameFunction({
    name: "search_mentions",
    description: "Search for recent tweets mentioning Silverback DEX or related keywords. Use this to find community discussions and engagement opportunities.",
    args: [
        {
            name: "query",
            description: "Search query (e.g., 'Silverback DEX', '@silverbackdex', '#DeFi Keeta')"
        },
        {
            name: "maxResults",
            description: "Maximum number of tweets to return (default 10, max 100)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.query || !args.query.trim()) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Search query is required"
                );
            }

            const maxResults = Math.min(parseInt(args.maxResults || "10"), 100);
            const query = args.query;

            logger(`Searching Twitter for: "${query}" (max ${maxResults} results)`);

            // Get own user ID to filter out self-tweets
            const ownId = await getOwnUserId();

            const searchResults = await twitterClient.v2.search(query, {
                max_results: maxResults,
                'tweet.fields': ['created_at', 'public_metrics', 'author_id']
            });

            const allTweets = searchResults.data.data || [];

            // Filter out own tweets to prevent self-replies
            const tweets = allTweets.filter((t: any) => t.author_id !== ownId);
            const filteredCount = allTweets.length - tweets.length;

            if (filteredCount > 0) {
                logger(`Filtered out ${filteredCount} own tweet(s) from results`);
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    count: tweets.length,
                    tweets: tweets.map((t: any) => ({
                        id: t.id,
                        text: t.text,
                        author_id: t.author_id,
                        created_at: t.created_at,
                        likes: t.public_metrics?.like_count || 0,
                        retweets: t.public_metrics?.retweet_count || 0,
                        replies: t.public_metrics?.reply_count || 0
                    }))
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to search mentions: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get direct mentions and replies to our account
 * This is the PRIMARY function for finding people to engage with
 */
export const getMentionsFunction = new GameFunction({
    name: "get_mentions",
    description: "Get tweets that directly mention or reply to you. USE THIS FIRST before posting! This finds people asking questions or talking to you. Returns tweets you haven't replied to yet.",
    args: [
        {
            name: "maxResults",
            description: "Maximum number of mentions to return (default 10, max 50)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const maxResults = Math.min(parseInt(args.maxResults || "10"), 50);

            // Get own user ID
            const ownId = await getOwnUserId();
            if (!ownId) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Could not get authenticated user ID"
                );
            }

            logger(`Fetching mentions for user ${ownId} (max ${maxResults})`);

            // Get mentions timeline - tweets that mention the authenticated user
            const mentions = await twitterClient.v2.userMentionTimeline(ownId, {
                max_results: maxResults,
                'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'conversation_id', 'in_reply_to_user_id'],
                expansions: ['author_id'],
                'user.fields': ['username', 'name']
            });

            const allMentions = mentions.data.data || [];
            const users = mentions.data.includes?.users || [];

            // Create a map of user IDs to usernames
            const userMap = new Map(users.map((u: any) => [u.id, { username: u.username, name: u.name }]));

            // Filter out mentions we've already replied to (checks database for persistence across restarts)
            const repliedChecks = await Promise.all(allMentions.map((t: any) => hasRepliedToTweet(t.id)));
            const unrepliedMentions = allMentions.filter((_: any, i: number) => !repliedChecks[i]);
            const alreadyRepliedCount = allMentions.length - unrepliedMentions.length;

            if (alreadyRepliedCount > 0) {
                logger(`Filtered out ${alreadyRepliedCount} mentions already replied to`);
            }

            // Format the response with user info
            const formattedMentions = unrepliedMentions.map((t: any) => {
                const user = userMap.get(t.author_id) || { username: 'unknown', name: 'Unknown' };
                return {
                    id: t.id,
                    text: t.text,
                    author_id: t.author_id,
                    author_username: user.username,
                    author_name: user.name,
                    created_at: t.created_at,
                    conversation_id: t.conversation_id,
                    is_reply: !!t.in_reply_to_user_id,
                    likes: t.public_metrics?.like_count || 0,
                    retweets: t.public_metrics?.retweet_count || 0,
                    replies: t.public_metrics?.reply_count || 0
                };
            });

            if (formattedMentions.length === 0) {
                logger("No new mentions to respond to");
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        success: true,
                        count: 0,
                        message: "No new mentions or replies to respond to. You can post original content.",
                        mentions: []
                    })
                );
            }

            logger(`Found ${formattedMentions.length} mentions to respond to`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    count: formattedMentions.length,
                    message: `Found ${formattedMentions.length} people talking to you! Reply to them before posting new content.`,
                    mentions: formattedMentions
                })
            );
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'Unknown error';
            // Don't expose API errors - just say no mentions found
            if (errorMsg.includes('429') || errorMsg.includes('rate')) {
                logger("Rate limited when fetching mentions");
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        success: true,
                        count: 0,
                        message: "Could not check mentions right now. You can post original content.",
                        mentions: []
                    })
                );
            }
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get mentions: ${errorMsg}`
            );
        }
    }
});

/**
 * Post a Twitter thread (multiple connected tweets)
 */
export const postThreadFunction = new GameFunction({
    name: "post_thread",
    description: "Post a Twitter thread where each tweet replies to the previous one. Use this for multi-part educational content or detailed explanations. Maximum 5 tweets per thread.",
    args: [
        {
            name: "tweets",
            description: "Array of tweet contents. Each tweet max 280 characters. Will be posted as a connected thread."
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.tweets) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Tweets array is required"
                );
            }

            let tweetsArray: string[];
            try {
                tweetsArray = typeof args.tweets === 'string' ? JSON.parse(args.tweets) : args.tweets;
            } catch {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Tweets must be a valid JSON array of strings"
                );
            }

            if (!Array.isArray(tweetsArray) || tweetsArray.length === 0) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Tweets must be a non-empty array"
                );
            }

            if (tweetsArray.length > 5) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Maximum 5 tweets per thread. Keep threads concise."
                );
            }

            // Validate all tweets before posting
            for (let i = 0; i < tweetsArray.length; i++) {
                if (!tweetsArray[i] || tweetsArray[i].length === 0) {
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Tweet ${i + 1} is empty`
                    );
                }
                if (tweetsArray[i].length > 280) {
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Tweet ${i + 1} is too long (${tweetsArray[i].length} chars). Max 280.`
                    );
                }
            }

            logger(`Posting thread with ${tweetsArray.length} tweets`);

            const results = [];
            let replyToId: string | undefined = undefined;

            for (let i = 0; i < tweetsArray.length; i++) {
                const content = tweetsArray[i];
                logger(`Posting tweet ${i + 1}/${tweetsArray.length}: "${content.substring(0, 50)}..."`);

                let result;
                if (replyToId) {
                    // Reply to previous tweet to create thread
                    result = await twitterClient.v2.reply(content, replyToId);
                } else {
                    // First tweet in thread
                    result = await twitterClient.v2.tweet(content);
                }

                replyToId = result.data.id;
                results.push({
                    tweetNumber: i + 1,
                    tweetId: result.data.id,
                    text: content,
                    url: `https://x.com/user/status/${result.data.id}`
                });
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    threadLength: tweetsArray.length,
                    firstTweetId: results[0].tweetId,
                    firstTweetUrl: results[0].url,
                    allTweets: results
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to post thread: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
