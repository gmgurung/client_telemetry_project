/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AWS S3 LOG SYNCHRONIZATION MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Automated upload of telemetry logs to AWS S3 data lake (raw tier)
 * 
 * Architecture:
 *   - Uses AWS SDK v3 (@aws-sdk/client-s3) with Default Credential Provider Chain
 *   - Implements file rotation strategy to ensure zero data loss during uploads
 *   - Follows Tiered Storage Strategy: raw/YYYY-MM-DD/telemetry_logs_TIMESTAMP.ndjson
 * 
 * Credential Resolution Order (AWS SDK Default Chain):
 *   1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 *   2. Shared credentials file (~/.aws/credentials)
 *   3. IAM role for EC2 (if running on AWS)
 *   4. IAM role from ECS task (if running in container)
 * 
 * Design Rationale:
 *   - File Rotation: Prevents race conditions between write (server.js) and read (upload)
 *   - Async/Non-blocking: Uses fs.promises to avoid blocking Express server
 *   - Error Isolation: Upload failures don't crash telemetry ingestion
 * 
 * Data Flow:
 *   logs/telemetry_logs.ndjson → Rename to temp file → Upload to S3 → Delete temp file
 * 
 * S3 Key Structure:
 *   raw/2026-02-23/telemetry_logs_1708704300.ndjson
 *   └─┬─┘ └────┬────┘ └───────────┬──────────┘
 *     │        │                    └─ Unix timestamp for uniqueness
 *     │        └─ Date-based partitioning (enables Athena/Glue queries by date)
 *     └─ Raw tier (unprocessed data from source system)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// S3 CLIENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const s3Client = new S3Client({
  region: 'us-east-1',
  // Credentials automatically loaded from AWS CLI profile or environment variables
  // No hardcoded keys - follows AWS security best practices
});

const S3_BUCKET = 'sagemaker-us-east-1-197337164107';
const LOG_FILE_NAME = 'telemetry_logs.ndjson';
const LOGS_DIR = path.join(__dirname, 'logs');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Generate S3 Key with Tiered Storage Pathing
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generates S3 object key following data lake conventions
 * Format: raw/YYYY-MM-DD/telemetry_logs_TIMESTAMP.ndjson
 * 
 * @param {number} timestamp - Unix timestamp (seconds since epoch)
 * @returns {string} S3 object key
 */
function generateS3Key(timestamp) {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `raw/${year}-${month}-${day}/telemetry_logs_${timestamp}.ndjson`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE FUNCTION: Upload Logs to S3
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Uploads current log file to S3 with file rotation for concurrency safety
 * 
 * Process:
 *   1. Check if log file exists and has content
 *   2. Rename active log to timestamped temp file (atomic operation)
 *   3. Upload temp file to S3 (server can continue writing to new log)
 *   4. Delete temp file on success
 * 
 * @returns {Promise<Object>} Upload result { success: boolean, key?: string, error?: Error }
 */
export async function uploadLogsToS3() {
  const logFilePath = path.join(LOGS_DIR, LOG_FILE_NAME);
  
  try {
    // ─── Step 1: Check if log file exists ───────────────────────────────────
    const fileExists = fsSync.existsSync(logFilePath);
    if (!fileExists) {
      console.log('[S3 Sync] No log file found. Skipping upload.');
      return { success: false, reason: 'no_file' };
    }
    
    // ─── Step 2: Check if file has content ─────────────────────────────────
    const stats = await fs.stat(logFilePath);
    if (stats.size === 0) {
      console.log('[S3 Sync] Log file is empty. Skipping upload.');
      return { success: false, reason: 'empty_file' };
    }
    
    // ─── Step 3: File Rotation (Concurrency Safety) ────────────────────────
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const tempFileName = `telemetry_logs_${timestamp}.ndjson`;
    const tempFilePath = path.join(LOGS_DIR, tempFileName);
    
    // Rename active log to temp file (atomic operation on most filesystems)
    // This allows server.js to immediately create a new log file for incoming events
    await fs.rename(logFilePath, tempFilePath);
    console.log(`[S3 Sync] Rotated log file: ${LOG_FILE_NAME} → ${tempFileName}`);
    
    // ─── Step 4: Read file content ─────────────────────────────────────────
    const fileContent = await fs.readFile(tempFilePath);
    
    // ─── Step 5: Generate S3 key with date partitioning ────────────────────
    const s3Key = generateS3Key(timestamp);
    
    // ─── Step 6: Upload to S3 ──────────────────────────────────────────────
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/x-ndjson',
      Metadata: {
        'upload-timestamp': new Date().toISOString(),
        'original-filename': tempFileName,
        'source': 'vanguard-client-telemetry'
      }
    });
    
    await s3Client.send(command);
    console.log(`✓ [S3 Sync] Successfully uploaded to s3://${S3_BUCKET}/${s3Key}`);
    console.log(`  File size: ${(stats.size / 1024).toFixed(2)} KB`);
    
    // ─── Step 7: Clean up temp file ────────────────────────────────────────
    await fs.unlink(tempFilePath);
    console.log(`✓ [S3 Sync] Deleted local temp file: ${tempFileName}`);
    
    return { 
      success: true, 
      key: s3Key,
      size: stats.size,
      timestamp: timestamp
    };
    
  } catch (error) {
    console.error('❌ [S3 Sync] Upload failed:', error.message);
    
    // If error occurred after file rotation, try to restore original filename
    const timestamp = Math.floor(Date.now() / 1000);
    const tempFilePath = path.join(LOGS_DIR, `telemetry_logs_${timestamp}.ndjson`);
    if (fsSync.existsSync(tempFilePath)) {
      try {
        await fs.rename(tempFilePath, logFilePath);
        console.log('[S3 Sync] Restored original log file after error');
      } catch (renameError) {
        console.error('[S3 Sync] Failed to restore log file:', renameError.message);
      }
    }
    
    return { 
      success: false, 
      error: error.message,
      errorCode: error.name
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER: Start Automated Sync Process
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Starts automated log synchronization on a fixed interval
 * 
 * @param {number} intervalMinutes - Upload interval in minutes (default: 5)
 * @returns {NodeJS.Timeout} Interval timer (can be cleared with clearInterval)
 */
export function startAutomatedSync(intervalMinutes = 5) {
  const intervalMs = intervalMinutes * 60 * 1000;
  
  console.log(`✓ [S3 Sync] Automated sync enabled (every ${intervalMinutes} minutes)`);
  console.log(`  Target bucket: s3://${S3_BUCKET}/raw/YYYY-MM-DD/`);
  
  // Run initial upload after 1 minute (gives time for logs to accumulate)
  setTimeout(() => {
    uploadLogsToS3().catch(err => {
      console.error('[S3 Sync] Initial upload error:', err);
    });
  }, 60 * 1000);
  
  // Schedule recurring uploads
  const intervalId = setInterval(() => {
    uploadLogsToS3().catch(err => {
      console.error('[S3 Sync] Scheduled upload error:', err);
    });
  }, intervalMs);
  
  return intervalId;
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Performs final upload before process exit
 * Call this in your server's shutdown handler
 */
export async function uploadOnShutdown() {
  console.log('[S3 Sync] Performing final upload before shutdown...');
  await uploadLogsToS3();
}
