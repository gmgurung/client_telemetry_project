import { EventLogInput, Phase1EventLog } from './types.js';
import { createWriteStream, WriteStream } from 'fs';

/**
 * Derive pageRoute from URL (e.g. .../trade.html -> "trade", .../index.html -> "home")
 */
function getPageRoute(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() || '';
    if (base === 'index.html' || base === '' || base === '/') return 'home';
    if (url === 'about:blank') return 'blank';
    return base.replace(/\.html$/, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface SessionLoggerOptions {
  sessionId: string;
  outputFile?: string;
  userId?: string;
  /** When set, events are POSTed to Phase 1 server (same as telemetry.js) for automated data collection. */
  baseUrl?: string;
}

export class SessionLogger {
  private stream: WriteStream | null = null;
  private sessionId: string;
  private userId: string;
  private baseUrl: string | null = null;

  constructor(
    sessionIdOrOptions: string | SessionLoggerOptions,
    outputFile?: string,
    userId?: string
  ) {
    if (typeof sessionIdOrOptions === 'object') {
      this.sessionId = sessionIdOrOptions.sessionId;
      this.userId = sessionIdOrOptions.userId ?? 'U-playwright';
      this.baseUrl = sessionIdOrOptions.baseUrl ?? null;
      if (sessionIdOrOptions.outputFile) {
        this.stream = createWriteStream(sessionIdOrOptions.outputFile, { flags: 'a' });
      }
    } else {
      this.sessionId = sessionIdOrOptions;
      this.userId = userId ?? 'U-playwright';
      if (outputFile) {
        this.stream = createWriteStream(outputFile, { flags: 'a' });
      }
    }
  }

  log(event: EventLogInput): void {
    const now = new Date().toISOString();
    const logEntry: Phase1EventLog = {
      serverReceivedAt: now,
      sessionId: this.sessionId,
      userId: this.userId,
      pageRoute: getPageRoute(event.url),
      eventType: event.event_type,
      timestamp: now,
      url: event.url,
      metadata: event.metadata ?? {},
    };
    if (event.selector != null) {
      logEntry.elementId = event.selector;
    }

    const line = JSON.stringify(logEntry) + '\n';

    if (this.stream) {
      this.stream.write(line);
    } else if (!this.baseUrl) {
      console.log(line.trim());
    }

    if (this.baseUrl) {
      const telemetryUrl = this.baseUrl.replace(/\/$/, '') + '/api/telemetry';
      const body = { ...logEntry };
      fetch(telemetryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch((err) => {
        console.error('[SessionLogger] POST failed:', err.message);
      });
    }
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
    }
  }
}

/**
 * No-op logger for --telemetry-js-only mode: Playwright only drives the browser,
 * all events are captured and sent by the page's telemetry.js (same as teammate's method).
 */
export class NoOpLogger {
  log(_event: EventLogInput): void {}
  close(): void {}
}
