import { GameWorker } from "@virtuals-protocol/game";
import {
    postTweetFunction,
    postDailyStatsFunction,
    replyToTweetFunction,
    searchMentionsFunction
} from "./twitter-functions";

export const twitterWorker = new GameWorker({
    id: "silverback_twitter",
    name: "Silverback Twitter Worker",
    description: "Manages Twitter/X social media presence for Silverback DEX. Can post updates, reply to community questions, search for mentions, and share daily statistics.",
    functions: [
        postTweetFunction,
        postDailyStatsFunction,
        replyToTweetFunction,
        searchMentionsFunction
    ]
});
