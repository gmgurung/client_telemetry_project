#!/usr/bin/env node

import { runSessions } from './dist/runner.js';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    baseUrl: 'http://localhost:8000',
    sessions: 50,
    concurrency: 4,
    scenarioMix: {
      normal: 0.4,
      frustrated: 0.3,
      lost: 0.2,
      error: 0.1
    },
    outputFile: undefined,
    telemetryJsOnly: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--baseUrl' && i + 1 < args.length) {
      config.baseUrl = args[i + 1];
      i++;
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      config.concurrency = Math.max(1, parseInt(args[i + 1], 10));
      i++;
    } else if (arg === '--sessions' && i + 1 < args.length) {
      config.sessions = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--scenarioMix' && i + 1 < args.length) {
      const mixStr = args[i + 1];
      const parts = mixStr.split(',');
      const mix = { normal: 0, frustrated: 0, lost: 0, error: 0 };
      
      parts.forEach(part => {
        const [scenario, prob] = part.split(':');
        const probability = parseFloat(prob);
        if (scenario === 'normal') mix.normal = probability;
        else if (scenario === 'frustrated') mix.frustrated = probability;
        else if (scenario === 'lost') mix.lost = probability;
        else if (scenario === 'error') mix.error = probability;
      });
      
      // Normalize to sum to 1.0
      const sum = mix.normal + mix.frustrated + mix.lost + mix.error;
      if (sum > 0) {
        mix.normal /= sum;
        mix.frustrated /= sum;
        mix.lost /= sum;
        mix.error /= sum;
      }
      
      config.scenarioMix = mix;
      i++;
    } else if (arg === '--output' && i + 1 < args.length) {
      config.outputFile = args[i + 1];
      i++;
    } else if (arg === '--telemetry-js-only') {
      config.telemetryJsOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node run.js [options]

Options:
  --baseUrl <url>         Base URL of the website (default: http://localhost:8000)
  --sessions <number>     Number of sessions to run (default: 50)
  --concurrency <number>  Max parallel browser sessions (default: 4)
  --scenarioMix <mix>     Scenario mix in format: normal:0.4,frustrated:0.3,lost:0.2,error:0.1
  --output <file>         Output file for logs (default: sessions_<timestamp>.jsonl)
  --telemetry-js-only     Use only page telemetry.js to capture events (no Node-side logging; same as teammate's method)
  --help, -h              Show this help message

Examples:
  node run.js --sessions 1000 --concurrency 6
  node run.js --baseUrl http://localhost:8000 --sessions 50 --scenarioMix normal:0.4,frustrated:0.3,lost:0.2,error:0.1
      `);
      process.exit(0);
    }
  }

  return config;
}

/**
 * Main entry point
 */
async function main() {
  try {
    const config = parseArgs();
    await runSessions(config);
  } catch (error) {
    console.error('Error running sessions:', error);
    process.exit(1);
  }
}

main();
