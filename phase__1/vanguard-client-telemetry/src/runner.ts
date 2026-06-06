import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { RunConfig, ScenarioType, ScenarioMix } from './types.js';
import { runScenario } from './scenarios.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function selectScenario(mix: ScenarioMix): ScenarioType {
  const rand = Math.random();
  let cumulative = 0;
  if (rand < (cumulative += mix.normal))    return 'normal_user';
  if (rand < (cumulative += mix.frustrated)) return 'frustrated_user';
  if (rand < (cumulative += mix.lost))       return 'lost_user';
  return 'error_user';
}

/**
 * Generate a session ID in the S<timestamp>-<rand> format used by telemetry.js
 * so that IDs are visually consistent in the database.
 */
function generateSessionId(index: number): string {
  const random = Math.floor(Math.random() * 10000);
  return `S-pw${index}-${Date.now()}-${random}`;
}

// ─── progress bar ─────────────────────────────────────────────────────────────

const BAR_WIDTH = 40;

function renderProgress(
  completed: number,
  total: number,
  active: number,
  errors: number
): void {
  const pct       = total > 0 ? Math.floor((completed / total) * 100) : 0;
  const filled    = Math.floor((pct / 100) * BAR_WIDTH);
  const bar       = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const line =
    `\r[${bar}] ${String(pct).padStart(3)}% ` +
    `| ${String(completed).padStart(5)}/${total} done ` +
    `| ${String(active).padStart(2)} active ` +
    `| ${errors} error${errors !== 1 ? 's' : ''}`;
  process.stdout.write(line);
}

// ─── single session ───────────────────────────────────────────────────────────

/**
 * Run one simulated browser session and always close the context when done.
 *
 * Session-ID sync strategy
 * ────────────────────────
 * context.addInitScript() injects a tiny script that runs in the browser
 * sandbox *before* any page script (including telemetry.js).  It writes the
 * Playwright-assigned sessionId and userId into sessionStorage so that when
 * telemetry.js calls _initSession() it finds the pre-seeded values and never
 * generates its own S<timestamp>-... / U-guest identities.
 */
async function runSingleSession(
  browser:      Browser,
  config:       RunConfig,
  scenario:     ScenarioType,
  sessionIndex: number
): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    viewport:  { width: 1920, height: 1080 },
    userAgent:
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Session${sessionIndex}`
  });

  const sessionId = generateSessionId(sessionIndex);
  const userId    = `U-playwright-${sessionIndex}`;

  await context.addInitScript(
    ({ sid, uid }: { sid: string; uid: string }) => {
      sessionStorage.setItem('sessionId', sid);
      sessionStorage.setItem('userId',    uid);
    },
    { sid: sessionId, uid: userId }
  );

  const page: Page = await context.newPage();

  try {
    await runScenario(scenario, page, config.baseUrl);
  } finally {
    // Always close the context so browser resources are freed.
    await context.close();
  }
}

// ─── worker pool ─────────────────────────────────────────────────────────────

/**
 * Run all sessions in parallel up to `concurrency` at a time.
 *
 * Each worker stalls for (workerId × 500 ms) before picking up its first task
 * so that browsers are launched in a staggered fashion instead of all hitting
 * the CPU at the same millisecond.
 */
export async function runSessions(config: RunConfig): Promise<void> {
  const concurrency = Math.max(1, config.concurrency ?? 4);
  const total       = config.sessions;

  console.log(`Starting ${total} sessions  |  concurrency: ${concurrency}  |  stagger: 500 ms/worker`);
  console.log(`Base URL:       ${config.baseUrl}`);
  console.log(`Scenario mix:   normal=${config.scenarioMix.normal}  frustrated=${config.scenarioMix.frustrated}  lost=${config.scenarioMix.lost}  error=${config.scenarioMix.error}`);
  console.log('');

  const browser: Browser = await chromium.launch({ headless: true });

  // Shared mutable state – safe in JS single-threaded event loop because every
  // mutation happens between await boundaries (no true concurrency here).
  let nextSessionIndex = 0; // number of sessions claimed so far (0-based counter)
  let completed        = 0;
  let active           = 0;
  let errors           = 0;

  renderProgress(completed, total, active, errors);

  async function worker(workerId: number): Promise<void> {
    // Staggered ramp-up: worker 0 starts immediately, worker 1 waits 500 ms, etc.
    if (workerId > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, workerId * 500));
    }

    while (nextSessionIndex < total) {
      // Claim the next session index atomically (no await between check + claim).
      const sessionIndex = ++nextSessionIndex; // 1-based, 1…total
      if (sessionIndex > total) break;         // guard in case of over-run

      active++;
      const scenario = selectScenario(config.scenarioMix);
      renderProgress(completed, total, active, errors);

      try {
        await runSingleSession(browser, config, scenario, sessionIndex);
      } catch (err) {
        errors++;
        // Print the error on its own line so it scrolls above the progress bar.
        process.stdout.write(`\n[Session ${sessionIndex}/${total}] error: ${(err as Error).message}\n`);
      } finally {
        active--;
        completed++;
        renderProgress(completed, total, active, errors);
      }
    }
  }

  try {
    const workers = Array.from({ length: concurrency }, (_, id) => worker(id));
    await Promise.all(workers);
  } finally {
    await browser.close();
  }

  // Move the cursor past the progress bar before printing the summary.
  process.stdout.write('\n\n');
  console.log(`Done. ${completed} sessions completed, ${errors} error${errors !== 1 ? 's' : ''}.`);
}
