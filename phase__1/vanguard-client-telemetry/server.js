/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TELEMETRY INGESTION SERVER (Phase 1 Backend)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Acts as the server-side "write-only" API for telemetry data.
 * 
 * Architecture:
 *   - Receives JSON payloads from the client-side SDK (telemetry.js)
 *   - Appends events as NDJSON (newline-delimited JSON) for efficient streaming
 *   - Persists to logs/telemetry_logs.ndjson for downstream ML/analytics pipelines
 * 
 * Design Rationale:
 *   - NDJSON format enables line-by-line parsing without loading entire file into memory
 *   - No database dependency simplifies deployment and reduces latency (<5ms per write)
 *   - Serverless-ready architecture (can be ported to Lambda/Cloud Functions)
 * 
 * Data Flow:
 *   Client Event → POST /api/telemetry → Append to NDJSON → 200 Response
 * 
 * File Structure:
 *   logs/telemetry_logs.ndjson - One JSON object per line, no commas or brackets
 *   Example:
 *     {"serverReceivedAt":"2026-02-08T20:00:00.123Z","eventType":"click",...}
 *     {"serverReceivedAt":"2026-02-08T20:00:01.456Z","eventType":"scroll_depth",...}
 * 
 * For new developers:
 *   1. Start server: node server.js
 *   2. Open http://localhost:3000 in browser
 *   3. Interact with pages → events auto-append to logs/telemetry_logs.ndjson
 *   4. Read logs: cat logs/telemetry_logs.ndjson | jq '.' (requires jq tool)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { startAutomatedSync, uploadOnShutdown } from './s3Uploader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION: Ensure logs directory exists
// ─────────────────────────────────────────────────────────────────────────────
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log('✓ Created logs directory.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE STACK
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors());                              // Allow cross-origin requests (dev only)
app.use(express.json());                      // Parse JSON request bodies
app.use(express.static(path.join(__dirname, 'public')));  // Serve HTML/CSS/JS files

// ─────────────────────────────────────────────────────────────────────────────
// TELEMETRY INGESTION ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/telemetry
// 
// Request Body Schema (enforced by telemetry.js):
//   {
//     sessionId: string,
//     userId: string,
//     pageRoute: string,
//     eventType: string,
//     timestamp: ISO 8601 string,
//     url: string,
//     elementId?: string,  // Optional, extracted from metadata.id
//     metadata: object     // Event-specific data
//   }
// 
// Response: { status: 'success' } or { status: 'error' }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/telemetry', async (req, res) => {
  const eventData = req.body;
  
  // Add server-side timestamp (for clock skew detection and latency analysis)
  const logEntry = {
    serverReceivedAt: new Date().toISOString(),
    ...eventData
  };
  
  // Convert to NDJSON format (single line with \n terminator)
  const logString = JSON.stringify(logEntry) + '\n';
  const logPath = path.join(__dirname, 'logs', 'telemetry_logs.ndjson');

  try {
    // Append to file (async, non-blocking with fs.promises)
    await fsPromises.appendFile(logPath, logString);
    
    // Console log for real-time monitoring during development
    console.log(`[Telemetry] ${eventData.eventType} | ${eventData.pageRoute}`);
    res.json({ status: 'success' });
  } catch (err) {
    // Error isolation: S3 sync failures won't affect telemetry ingestion
    console.error('❌ Error writing to file:', err);
    res.status(500).json({ status: 'error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
  console.log(`✓ Telemetry endpoint: POST http://localhost:${PORT}/api/telemetry`);
  console.log(`✓ Log file: ${path.join(__dirname, 'logs', 'telemetry_logs.ndjson')}`);
  
  // Start automated S3 synchronization (uploads every 5 minutes)
  startAutomatedSync(5);
});

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
// Ensures final log upload before process termination
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Received SIGINT (Ctrl+C). Uploading remaining logs...');
  await uploadOnShutdown();
  console.log('[Shutdown] Graceful shutdown complete.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Shutdown] Received SIGTERM. Uploading remaining logs...');
  await uploadOnShutdown();
  console.log('[Shutdown] Graceful shutdown complete.');
  process.exit(0);
});
