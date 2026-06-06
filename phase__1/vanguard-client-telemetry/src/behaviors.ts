import { Page } from 'playwright';
import { ElementInfo } from './types.js';
import { randomDelay } from './helpers.js';

/**
 * Rage click: rapid clicks on the same element.
 * telemetry.js detects ≥3 clicks within 500 ms on the same target and emits rage_click.
 */
export async function rageClick(
  page: Page,
  element: ElementInfo,
  clickCount: number = 5
): Promise<void> {
  const locator = page.locator(element.selector).first();

  for (let i = 0; i < clickCount; i++) {
    try {
      await locator.click({ timeout: 1000 }).catch(() => {});
      await randomDelay(50, 150);
    } catch (_e) {
      break;
    }
  }
}

/**
 * Dead click: a single click that produces no visible change.
 * telemetry.js detects the absence of URL/DOM change and emits dead_click.
 */
export async function performDeadClick(
  page: Page,
  element: ElementInfo
): Promise<void> {
  try {
    await page.locator(element.selector).first().click({ timeout: 2000 });
  } catch (_e) {
    // Element might not be clickable — telemetry.js still captures the attempt
  }
}

/**
 * Normal click — waits for network idle so the next interaction lands on a stable page.
 */
export async function performClick(
  page: Page,
  element: ElementInfo
): Promise<void> {
  try {
    await page.locator(element.selector).first().click({ timeout: 3000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } catch (_e) {
    // Click may fail on dynamic elements
  }
}

/**
 * Refocus click: click an element, blur it via Tab, then click it again.
 *
 * The original two-click approach could land both clicks on an already-focused
 * element, so telemetry.js never saw a focusout → focusin pair. Inserting a
 * keyboard Tab between the clicks guarantees a genuine focusout fires before
 * the second click, which is what telemetry.js needs to emit 'refocus'.
 *
 * Event sequence:
 *   locator.click()          → focusin  on element (lastFocusedId set)
 *   keyboard.press('Tab')    → focusout on element (lastBlurTs set)
 *   randomDelay(500–1500)    → within REFOCUS_WINDOW_MS (5000 ms)
 *   locator.click()          → focusin  on same element → emit 'refocus'
 */
export async function refocusClick(
  page: Page,
  element: ElementInfo
): Promise<void> {
  const locator = page.locator(element.selector).first();

  try {
    await locator.click({ timeout: 3000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } catch (_e) {
    return;
  }

  // blur() fires focusout without overwriting lastFocusedId (same fix as triggerRefocus)
  await randomDelay(300, 700);
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.blur();
  }, element.selector);

  // Stay away within the 5000 ms REFOCUS_WINDOW_MS
  await randomDelay(500, 1500);

  // Click back — focusin on the same element → telemetry.js emits 'refocus'
  try {
    await locator.click({ timeout: 2000 });
  } catch (_e) {
    // Element may no longer be available
  }
}

/**
 * Deterministic blur → refocus cycle that reliably fires the focusin/focusout
 * pair telemetry.js needs to emit 'refocus'.
 *
 * Why keyboard Tab/Shift+Tab fails:
 *   Tab fires focusout on the target (setting lastBlurTs) but also fires focusin
 *   on the NEXT field (overwriting lastFocusedId). Shift+Tab then focuses back on
 *   the target, but lastFocusedId now holds the next field's id — so the
 *   `lastFocusedId === id` guard in telemetry.js never passes.
 *
 * Fix — use element.blur() instead of Tab:
 *   Calling .blur() on the element fires focusout (so telemetry.js records
 *   lastBlurTs) but focus returns to document.body, which has no id attribute.
 *   telemetry.js's focusin handler returns early when id is empty, so
 *   lastFocusedId is NOT overwritten. The subsequent page.focus() then finds
 *   lastFocusedId === targetId and emits 'refocus'.
 *
 * Event sequence:
 *   page.focus(selector)   → focusin  on target   (lastFocusedId = targetId)
 *   keyboard.type('test')  → simulated edit
 *   element.blur()         → focusout on target   (lastBlurTs set)
 *                          → focusin  on body     (id='', handler returns early — lastFocusedId unchanged)
 *   wait 1000 ms           → away-window; well within REFOCUS_WINDOW_MS (5000 ms)
 *   page.focus(selector)   → focusin  on target   → lastFocusedId === targetId ✓ → emits 'refocus'
 *
 * @param page           - Playwright page
 * @param targetSelector - CSS selector of the input (must carry an `id` attribute)
 */
export async function triggerRefocus(
  page: Page,
  targetSelector: string
): Promise<void> {
  try {
    await page.focus(targetSelector);
  } catch (_e) {
    return;
  }

  await page.keyboard.type('test');
  await randomDelay(300, 500);

  // blur() fires focusout without moving focus to another named element,
  // so telemetry.js records lastBlurTs but keeps lastFocusedId = targetId
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.blur();
  }, targetSelector);

  // Stay away within REFOCUS_WINDOW_MS (5000 ms)
  await randomDelay(1000, 1000);

  // focusin fires on the same element → telemetry.js emits 'refocus'
  await page.focus(targetSelector).catch(() => {});
  await page.keyboard.type('a');
}

/**
 * @deprecated Use `triggerRefocus` instead — it simulates a richer interaction
 * and accepts any selector. Kept for backward compatibility.
 *
 * Uses element.blur() (not Tab) so lastFocusedId is not overwritten before
 * the second focus — same fix as triggerRefocus.
 */
export async function simulateRefocus(
  page: Page,
  selector: string = '#username'
): Promise<void> {
  await page.focus(selector);
  await randomDelay(100, 200);
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.blur();
  }, selector);
  await randomDelay(400, 700);
  await page.focus(selector).catch(() => {});
}
