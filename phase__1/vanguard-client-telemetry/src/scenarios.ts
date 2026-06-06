import { Page } from 'playwright';
import { ScenarioType } from './types.js';
import {
  findClickableElements,
  randomChoice,
  randomDelay,
  randomInt,
  simulateMouseShake,
  simulateErraticScroll,
  simulateScrollDepth
} from './helpers.js';
import {
  performClick,
  rageClick,
  performDeadClick,
  triggerRefocus
} from './behaviors.js';

/**
 * Normal user scenario: typical browsing behaviour.
 * Visits home then one content page so telemetry.js sees multiple pageRoutes.
 */
export async function normalUserScenario(
  page: Page,
  baseUrl: string
): Promise<void> {
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(500, 1200);

  const contentPages = ['trade.html', 'holdings.html', 'account-home-page.html'];
  const mainPage = contentPages[Math.floor(Math.random() * contentPages.length)];
  await page.goto(`${baseUrl}/${mainPage}`, { waitUntil: 'domcontentloaded' });

  // Initial hesitancy — long enough for telemetry.js idle_time detection
  const hesitancy = randomInt(2000, 5000);
  await randomDelay(hesitancy, hesitancy);

  const elements = await findClickableElements(page);
  const numActions = randomInt(3, 5);

  for (let i = 0; i < numActions; i++) {
    const element = randomChoice(elements);
    if (!element) break;

    await randomDelay(randomInt(1000, 3000), randomInt(1000, 3000));

    if (i === 0) {
      await performDeadClick(page, element);
    } else {
      await performClick(page, element);
    }

    // Occasional scroll so telemetry.js fires scroll_depth milestones
    if (Math.random() > 0.6) {
      await page.evaluate((amount: number) => {
        window.scrollBy(0, amount);
      }, randomInt(200, 500));
    }
  }

  // End-of-session idle
  await randomDelay(randomInt(2000, 4000), randomInt(2000, 4000));
}

/**
 * Frustrated user: rage clicks, erratic scrolling, mouse shake.
 * telemetry.js detects all friction signals from native DOM events.
 */
export async function frustratedUserScenario(
  page: Page,
  baseUrl: string
): Promise<void> {
  await page.goto(`${baseUrl}/trade.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(400, 900);

  await page.goto(`${baseUrl}/help.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(300, 700);

  // Scroll to depth milestones then erratic scroll — fires scroll + erratic_scroll in telemetry.js
  await simulateScrollDepth(page);
  for (let i = 0; i < 3; i++) {
    await simulateErraticScroll(page);
    await randomDelay(100, 250);
  }

  // Mouse shake: ≥3 direction flips in 500 ms → telemetry.js emits erratic_mouse
  await simulateMouseShake(page, randomInt(5, 8));

  await page.goto(`${baseUrl}/trade.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(500, 1500);

  await simulateMouseShake(page, randomInt(3, 7));

  const elements = await findClickableElements(page);
  const targetElement = randomChoice(elements);
  if (targetElement) {
    await rageClick(page, targetElement, randomInt(4, 8));
  }

  // Rapid successive clicks on different targets
  for (let i = 0; i < randomInt(3, 5); i++) {
    const element = randomChoice(elements);
    if (element) {
      await performClick(page, element);
      await randomDelay(100, 300);
    }
  }
}

/**
 * Lost user: hesitancy, page-level u-turns, organic refocus during form filling.
 * telemetry.js detects u_turn from the route history and idle_time from the 35 s pause.
 *
 * Refocus is no longer a separate hardcoded action at the end. Instead it emerges
 * naturally from the Trade form interaction: after filling the symbol field the user
 * has a 30% chance of "checking back" on it (triggerRefocus), mirroring real-world
 * second-guessing before navigating away.
 */
export async function lostUserScenario(
  page: Page,
  baseUrl: string
): Promise<void> {
  // U-turn (A → B → A) so telemetry.js emits u_turn on the return visit
  const useHoldings = Math.random() > 0.5;

  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(800, 1500);

  await page.goto(`${baseUrl}/trade.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(600, 1200);

  // Trade form interaction — fill the symbol field then optionally check back on it
  const symbolLocator = page.locator('#symbol').first();
  if (await symbolLocator.isVisible().catch(() => false)) {
    await symbolLocator.focus().catch(() => {});
    await randomDelay(200, 500);
    await page.keyboard.type('MSFT');
    await randomDelay(300, 700);

    if (Math.random() < 0.3) {
      // 30% chance: user second-guesses the ticker and checks back → refocus
      await triggerRefocus(page, '#symbol');
      await randomDelay(300, 600);
    } else {
      // Tab to next field and move on
      await page.keyboard.press('Tab');
    }
  }

  if (useHoldings) {
    await page.goto(`${baseUrl}/holdings.html`, { waitUntil: 'domcontentloaded' });
    await randomDelay(500, 1000);
  }

  // Return to index — triggers u_turn detection in telemetry.js
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

  // Long hesitancy
  const longHesitancy = randomInt(2000, 5000);
  await randomDelay(longHesitancy, longHesitancy);

  const elements = await findClickableElements(page);
  if (elements.length >= 2) {
    const elementA = randomChoice(elements);
    const elementB = randomChoice(elements.filter(e => e !== elementA));
    if (elementA && elementB) {
      await performClick(page, elementA);
      await randomDelay(1000, 2000);
      await performClick(page, elementB);
      await randomDelay(500, 1500);

      const backElement = elements.find(e =>
        e.text?.toLowerCase().includes('back') ||
        e.selector.includes('back') ||
        e === elementA
      );
      if (backElement) {
        await performClick(page, backElement);
      }
    }
  }

  await randomDelay(randomInt(3000, 7000), randomInt(3000, 7000));

  // 35 s silence → telemetry.js idle_time threshold (30 s) fires
  await randomDelay(35000, 36000);
}

/**
 * Error user: form abandonment, 404, validation errors, system error injection.
 * telemetry.js captures all friction from native DOM/window events.
 *
 * Refocus is no longer hardcoded to #username on the login page. Instead it
 * emerges organically during Create Account and Trade form filling: after each
 * field is filled there is a 30% chance the user "checks back" on a previously
 * completed field via triggerRefocus. This produces the same telemetry signal
 * while varying which field is refocused across sessions.
 */
export async function errorUserScenario(
  page: Page,
  baseUrl: string
): Promise<void> {
  // ── Create Account form ─────────────────────────────────────────────────────
  // Fill multiple fields; with 30% probability after each field, check back on
  // one already filled (triggerRefocus). Then navigate away → form_abandonment.
  await page.goto(`${baseUrl}/create-account.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(400, 800);

  const accountFields: Array<{ selector: string; value: string }> = [
    { selector: '#fullname',  value: 'Test User'        },
    { selector: '#email',     value: 'test@example.com' },
    { selector: '#password',  value: 'TestPass123!'     },
  ];

  for (const { selector, value } of accountFields) {
    const locator = page.locator(selector).first();
    if (!await locator.isVisible().catch(() => false)) continue;

    await locator.focus().catch(() => {});
    await randomDelay(150, 350);
    await locator.fill(value).catch(() => {});
    await randomDelay(300, 700);
    await page.keyboard.press('Tab');
  }

  // 30% chance: check back on the high-value #fullname field → triggers refocus
  if (Math.random() < 0.3) {
    await triggerRefocus(page, '#fullname');
    await randomDelay(200, 500);
  }

  // Navigate away without submitting → form_abandonment
  await randomDelay(300, 600);
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(500, 1000);

  // ── 404 navigation ──────────────────────────────────────────────────────────
  try {
    await page.goto(`${baseUrl}/nonexistent-page-404.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 5000
    });
  } catch (_e) {
    // Expected — server returns 404; telemetry.js on that page (if any) captures it
  }

  // ── Trade form ──────────────────────────────────────────────────────────────
  // Fill the symbol field (with 30% chance refocus), then clear it and submit
  // empty to trigger validation errors downstream.
  await page.goto(`${baseUrl}/trade.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(400, 800);

  const tradeSymbolLocator = page.locator('#symbol').first();
  if (await tradeSymbolLocator.isVisible().catch(() => false)) {
    await tradeSymbolLocator.focus().catch(() => {});
    await randomDelay(150, 400);
    await page.keyboard.type('AAPL');
    await randomDelay(300, 600);

    if (Math.random() < 0.3) {
      // 30% chance: user double-checks the ticker before submitting
      await triggerRefocus(page, '#symbol');
      await randomDelay(200, 500);
    } else {
      await page.keyboard.press('Tab');
    }

    // Clear the field so the subsequent submit hits an empty-form validation path
    await tradeSymbolLocator.fill('').catch(() => {});
    await randomDelay(200, 400);

    const nextBtn = page.locator('#nextBtn').first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await randomDelay(500, 1000);
    }
  }
  await randomDelay(400, 800);

  // ── Login page ──────────────────────────────────────────────────────────────
  await page.goto(`${baseUrl}/create-account.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(500, 1000);

  await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
  await randomDelay(300, 600);

  // 30% chance: refocus on #username — natural, not guaranteed every run
  if (Math.random() < 0.3) {
    await triggerRefocus(page, '#username');
  }

  const elements = await findClickableElements(page);

  // Mix of valid and deliberately failing clicks
  for (let i = 0; i < randomInt(2, 4); i++) {
    const element = randomChoice(elements);
    if (element) {
      if (Math.random() > 0.7) {
        await page.click('non-existent-selector-12345').catch(() => {});
      } else {
        await performClick(page, element);
      }
      await randomDelay(500, 1500);
    }
  }

  // Retry burst — telemetry.js detects repeated rapid clicks
  const retryElement = randomChoice(elements);
  if (retryElement) {
    for (let i = 0; i < 3; i++) {
      await performClick(page, retryElement);
      await randomDelay(1000, 2000);
    }
  }

  // Inject a runtime error — window.onerror fires → telemetry.js emits system_error
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('telemetry_test_system_error');
    }, 100);
  });
  await randomDelay(400, 600);
}

/**
 * Dispatch a scenario by type.
 */
export async function runScenario(
  scenario: ScenarioType,
  page: Page,
  baseUrl: string
): Promise<void> {
  switch (scenario) {
    case 'normal_user':
      await normalUserScenario(page, baseUrl);
      break;
    case 'frustrated_user':
      await frustratedUserScenario(page, baseUrl);
      break;
    case 'lost_user':
      await lostUserScenario(page, baseUrl);
      break;
    case 'error_user':
      await errorUserScenario(page, baseUrl);
      break;
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}
