/**
 * ACP Job Cleanup Script
 *
 * Use this to manually complete or reject stuck jobs via the ACP SDK.
 *
 * Usage:
 *   npx ts-node src/acp/cleanup-jobs.ts complete <jobId1> <jobId2> ...
 *   npx ts-node src/acp/cleanup-jobs.ts reject <jobId1> <jobId2> ...
 */

import AcpClient, {
    AcpContractClientV2,
    baseAcpConfigV2,
    DeliverablePayload
} from "@virtuals-protocol/acp-node";
import dotenv from "dotenv";

dotenv.config();

const ACP_AGENT_WALLET_ADDRESS = process.env.ACP_AGENT_WALLET_ADDRESS;
const ACP_PRIVATE_KEY = process.env.ACP_PRIVATE_KEY || process.env.WHITELISTED_WALLET_PRIVATE_KEY;
const ACP_ENTITY_ID = process.env.ACP_ENTITY_ID;
const config = baseAcpConfigV2;

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log("Usage:");
        console.log("  npx ts-node src/acp/cleanup-jobs.ts complete <jobId1> <jobId2> ...");
        console.log("  npx ts-node src/acp/cleanup-jobs.ts reject <jobId1> <jobId2> ...");
        process.exit(1);
    }

    const action = args[0];
    const jobIds = args.slice(1);

    if (action !== 'complete' && action !== 'reject') {
        console.error("Action must be 'complete' or 'reject'");
        process.exit(1);
    }

    if (!ACP_AGENT_WALLET_ADDRESS || !ACP_PRIVATE_KEY || !ACP_ENTITY_ID) {
        console.error("Missing required env vars: ACP_AGENT_WALLET_ADDRESS, ACP_PRIVATE_KEY, ACP_ENTITY_ID");
        process.exit(1);
    }

    console.log(`\n🧹 ACP Job Cleanup - ${action.toUpperCase()}`);
    console.log(`   Jobs: ${jobIds.join(', ')}\n`);

    // Initialize ACP client
    let privateKey = ACP_PRIVATE_KEY.trim();
    if (privateKey.startsWith('0x')) {
        privateKey = privateKey.slice(2);
    }
    const privateKeyWithPrefix = `0x${privateKey}` as `0x${string}`;

    const acpContractClient = await AcpContractClientV2.build(
        privateKeyWithPrefix,
        parseInt(ACP_ENTITY_ID, 10),
        ACP_AGENT_WALLET_ADDRESS as `0x${string}`,
        config
    );

    const acpClient = new AcpClient({
        acpContractClient,
        onNewTask: async () => {} // No-op for cleanup
    });

    console.log("✅ ACP client initialized\n");

    // Process each job
    for (const jobId of jobIds) {
        try {
            console.log(`📋 Processing job ${jobId}...`);

            // Fetch the job
            const jobResult = await acpClient.getJobById(parseInt(jobId, 10));

            if (!jobResult || jobResult instanceof Error) {
                console.log(`   ⚠️ Job ${jobId} not found or error: ${jobResult}`);
                continue;
            }

            const job = jobResult;

            console.log(`   Phase: ${job.phase}, Name: ${job.name || 'unknown'}`);

            if (action === 'complete') {
                // Deliver with a completion message
                const deliverable: DeliverablePayload = {
                    success: true,
                    result: "Job completed manually via cleanup script",
                    timestamp: new Date().toISOString()
                };

                await job.deliver(deliverable);
                console.log(`   ✅ Job ${jobId} marked as COMPLETE`);
            } else {
                // Reject the job
                await job.reject("Job cancelled via cleanup script");
                console.log(`   ✅ Job ${jobId} marked as REJECTED`);
            }

        } catch (err: any) {
            console.error(`   ❌ Error processing job ${jobId}:`, err.message);
        }
    }

    console.log("\n🏁 Cleanup complete\n");
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
