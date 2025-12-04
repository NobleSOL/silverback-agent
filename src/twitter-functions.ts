import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { twitterClient, postDailyStats, announceNewPool, getOwnUserId } from "./twitter";

// Track tweets we've already replied to (prevents duplicate replies)
const repliedTweetIds = new Set<string>();

// Track recent tweet content to prevent duplicate posts
const recentTweetContent: { content: string; timestamp: number }[] = [];
const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// Clear old entries every hour to prevent memory bloat (keep last 1000)
setInterval(() => {
    if (repliedTweetIds.size > 1000) {
        const entries = Array.from(repliedTweetIds);
        entries.slice(0, entries.length - 500).forEach(id => repliedTweetIds.delete(id));
    }
    // Clean up old tweet content tracking
    const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
    while (recentTweetContent.length > 0 && recentTweetContent[0].timestamp < cutoff) {
        recentTweetContent.shift();
    }
}, 3600000);

/**
 * Check if content is too similar to recent tweets
 */
function isSimilarToRecent(newContent: string): { similar: boolean; reason?: string } {
    const normalizedNew = newContent.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const newWords = new Set(normalizedNew.split(/\s+/).filter(w => w.length > 3));

    for (const recent of recentTweetContent) {
        const normalizedRecent = recent.content.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

        // Exact or near-exact match
        if (normalizedNew === normalizedRecent) {
            return { similar: true, reason: "Exact duplicate of recent tweet" };
        }

        // Check word overlap (if >70% words match, it's too similar)
        const recentWords = new Set(normalizedRecent.split(/\s+/).filter(w => w.length > 3));
        const overlap = [...newWords].filter(w => recentWords.has(w)).length;
        const overlapRatio = overlap / Math.max(newWords.size, recentWords.size);

        if (overlapRatio > 0.7) {
            return { similar: true, reason: `Too similar to recent tweet (${Math.round(overlapRatio * 100)}% overlap)` };
        }
    }

    return { similar: false };
}

/**
 * Post a tweet with DEX updates or insights
 */
export const postTweetFunction = new GameFunction({
    name: "post_tweet",
    description: "Post a tweet about Silverback DEX. Use this to share insights, market updates, trading tips, or engage with the community. Keep tweets informative and engaging. AVOID using hashtags - they don't help with reach anymore and look spammy.",
    args: [
        {
            name: "content",
            description: "The tweet content (max 280 characters). Should be informative about DeFi, Silverback DEX, or market insights."
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

            // Check for duplicate/similar content
            const similarCheck = isSimilarToRecent(args.content);
            if (similarCheck.similar) {
                logger(`Blocked duplicate tweet: ${similarCheck.reason}`);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `${similarCheck.reason}. Please create different content - vary the topic, assets, or angle.`
                );
            }

            logger(`Posting tweet: "${args.content}"`);
            const result = await twitterClient.v2.tweet(args.content);

            // Track this tweet to prevent duplicates
            recentTweetContent.push({ content: args.content, timestamp: Date.now() });

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    tweetId: result.data.id,
                    text: args.content,
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

            // Check if we've already replied to this tweet
            if (repliedTweetIds.has(tweetId)) {
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

            // Track this reply to prevent duplicates
            repliedTweetIds.add(tweetId);

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
