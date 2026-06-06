export type ScenarioType = 'normal_user' | 'frustrated_user' | 'lost_user' | 'error_user';

export type EventType = 
  | 'page_navigation'
  | 'click'
  | 'dead_click'
  | 'rage_click'
  | 'scroll'
  | 'mouse_move'
  | 'console_error'
  | 'page_error'
  | 'network_error'
  | 'refocus'
  | 'u_turn'
  | 'idle'
  | 'session_start'
  | 'session_end';

/** Logger interface for scenarios (SessionLogger or NoOpLogger) */
export interface ITelemetryLogger {
  log(event: EventLogInput): void;
  close(): void;
}

/** Internal shape passed to SessionLogger.log() */
export interface EventLogInput {
  event_type: EventType | string;
  scenario: ScenarioType;
  url: string;
  selector?: string;
  metadata: Record<string, any>;
}

/** Phase 1–compatible NDJSON output (camelCase, same as server.js / telemetry.js) */
export interface Phase1EventLog {
  serverReceivedAt: string;
  sessionId: string;
  userId: string;
  pageRoute: string;
  eventType: string;
  timestamp: string;
  url: string;
  elementId?: string;
  metadata: Record<string, any>;
}

export interface ScenarioMix {
  normal: number;
  frustrated: number;
  lost: number;
  error: number;
}

export interface RunConfig {
  baseUrl: string;
  sessions: number;
  concurrency?: number;
  scenarioMix: ScenarioMix;
  outputFile?: string;
  /** When true, do not send events from Node; only the page's telemetry.js will capture and POST (same as teammate's method). */
  telemetryJsOnly?: boolean;
}

export interface ElementInfo {
  selector: string;
  tagName: string;
  text?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

