/**
 * ACP Job Queue Manager
 * Handles concurrent job requests with PostgreSQL-backed queue
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Reuse the same pool configuration
const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
}) : null;

export interface QueuedJob {
    id: number;
    job_id: string;
    job_name: string;
    requirement: any;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    priority: number;
    created_at: Date;
    started_at?: Date;
    completed_at?: Date;
    result?: any;
    error?: string;
    retries: number;
}

// Max concurrent jobs to process
const MAX_CONCURRENT_JOBS = 3;
const MAX_RETRIES = 2;

// Track currently processing jobs
let processingCount = 0;

/**
 * Add a job to the queue
 */
export async function enqueueJob(
    jobId: string,
    jobName: string,
    requirement: any,
    priority: number = 0
): Promise<boolean> {
    if (!pool) {
        console.log('[Queue] No database - processing immediately');
        return false; // Signal to process immediately
    }

    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO acp_job_queue (job_id, job_name, requirement, priority, status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (job_id) DO NOTHING`,
            [jobId, jobName, JSON.stringify(requirement), priority]
        );
        console.log(`[Queue] Job ${jobId} (${jobName}) added to queue`);
        return true;
    } catch (e) {
        console.error('[Queue] Error enqueuing job:', e);
        return false;
    } finally {
        client.release();
    }
}

/**
 * Get next job to process (FIFO with priority)
 */
export async function dequeueJob(): Promise<QueuedJob | null> {
    if (!pool) return null;
    if (processingCount >= MAX_CONCURRENT_JOBS) {
        console.log(`[Queue] At max capacity (${processingCount}/${MAX_CONCURRENT_JOBS})`);
        return null;
    }

    const client = await pool.connect();
    try {
        // Use FOR UPDATE SKIP LOCKED to safely handle concurrent workers
        const result = await client.query(
            `UPDATE acp_job_queue
             SET status = 'processing', started_at = NOW()
             WHERE id = (
                SELECT id FROM acp_job_queue
                WHERE status = 'pending'
                ORDER BY priority DESC, created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
             )
             RETURNING *`
        );

        if (result.rows.length > 0) {
            processingCount++;
            console.log(`[Queue] Dequeued job ${result.rows[0].job_id} (processing: ${processingCount})`);
            return result.rows[0] as QueuedJob;
        }
        return null;
    } catch (e) {
        console.error('[Queue] Error dequeuing job:', e);
        return null;
    } finally {
        client.release();
    }
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId: string, result: any): Promise<void> {
    if (!pool) return;

    const client = await pool.connect();
    try {
        await client.query(
            `UPDATE acp_job_queue
             SET status = 'completed', completed_at = NOW(), result = $2
             WHERE job_id = $1`,
            [jobId, JSON.stringify(result)]
        );
        processingCount = Math.max(0, processingCount - 1);
        console.log(`[Queue] Job ${jobId} completed (processing: ${processingCount})`);
    } catch (e) {
        console.error('[Queue] Error completing job:', e);
    } finally {
        client.release();
    }
}

/**
 * Mark job as failed
 */
export async function failJob(jobId: string, error: string): Promise<boolean> {
    if (!pool) return false;

    const client = await pool.connect();
    try {
        // Check if we should retry
        const checkResult = await client.query(
            `SELECT retries FROM acp_job_queue WHERE job_id = $1`,
            [jobId]
        );

        if (checkResult.rows.length > 0 && checkResult.rows[0].retries < MAX_RETRIES) {
            // Retry - put back in pending
            await client.query(
                `UPDATE acp_job_queue
                 SET status = 'pending', retries = retries + 1, error = $2, started_at = NULL
                 WHERE job_id = $1`,
                [jobId, error]
            );
            processingCount = Math.max(0, processingCount - 1);
            console.log(`[Queue] Job ${jobId} will retry (attempt ${checkResult.rows[0].retries + 1})`);
            return true; // Will retry
        } else {
            // Max retries exceeded
            await client.query(
                `UPDATE acp_job_queue
                 SET status = 'failed', completed_at = NOW(), error = $2
                 WHERE job_id = $1`,
                [jobId, error]
            );
            processingCount = Math.max(0, processingCount - 1);
            console.log(`[Queue] Job ${jobId} failed permanently (processing: ${processingCount})`);
            return false; // No more retries
        }
    } catch (e) {
        console.error('[Queue] Error failing job:', e);
        return false;
    } finally {
        client.release();
    }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}> {
    if (!pool) {
        return { pending: 0, processing: processingCount, completed: 0, failed: 0 };
    }

    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT status, COUNT(*) as count
            FROM acp_job_queue
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY status
        `);

        const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
        for (const row of result.rows) {
            stats[row.status as keyof typeof stats] = parseInt(row.count);
        }
        return stats;
    } catch (e) {
        console.error('[Queue] Error getting stats:', e);
        return { pending: 0, processing: processingCount, completed: 0, failed: 0 };
    } finally {
        client.release();
    }
}

/**
 * Check if we can accept more jobs
 */
export function canAcceptJob(): boolean {
    return processingCount < MAX_CONCURRENT_JOBS;
}

/**
 * Get current processing count
 */
export function getProcessingCount(): number {
    return processingCount;
}

/**
 * Clean up old completed/failed jobs (run periodically)
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
    if (!pool) return 0;

    const client = await pool.connect();
    try {
        const result = await client.query(
            `DELETE FROM acp_job_queue
             WHERE status IN ('completed', 'failed')
             AND completed_at < NOW() - INTERVAL '1 day' * $1`,
            [daysOld]
        );
        console.log(`[Queue] Cleaned up ${result.rowCount} old jobs`);
        return result.rowCount || 0;
    } catch (e) {
        console.error('[Queue] Error cleaning up jobs:', e);
        return 0;
    } finally {
        client.release();
    }
}
