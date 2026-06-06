import { Page, Locator } from 'playwright';
import { ElementInfo } from './types.js';

/**
 * Find clickable elements on the page
 */
export async function findClickableElements(page: Page): Promise<ElementInfo[]> {
  const elements: ElementInfo[] = [];
  
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input[type="button"]:not([disabled])',
    'input[type="submit"]:not([disabled])',
    '[role="button"]:not([disabled])',
    'select:not([disabled])',
    'input[type="checkbox"]:not([disabled])',
    'input[type="radio"]:not([disabled])',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])'
  ];

  for (const selector of selectors) {
    try {
      const locators = await page.locator(selector).all();
      for (const locator of locators) {
        if (await locator.isVisible()) {
          const tagName = await locator.evaluate(el => el.tagName.toLowerCase());
          const text = await locator.textContent().catch(() => undefined);
          const boundingBox = await locator.boundingBox().catch(() => undefined);
          
          if (boundingBox) {
            elements.push({
              selector: selector,
              tagName,
              text: text?.trim(),
              boundingBox
            });
          }
        }
      }
    } catch (e) {
      // Ignore errors for individual selectors
    }
  }

  // Remove duplicates based on position
  const uniqueElements: ElementInfo[] = [];
  const seen = new Set<string>();
  
  for (const el of elements) {
    if (el.boundingBox) {
      const key = `${el.boundingBox.x},${el.boundingBox.y},${el.boundingBox.width},${el.boundingBox.height}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueElements.push(el);
      }
    }
  }

  return uniqueElements;
}

/**
 * Get a random element from array
 */
export function randomChoice<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const delay = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Check if click causes visible change (simplified detection)
 */
export async function isDeadClick(
  page: Page,
  beforeUrl: string,
  beforeHtml: string
): Promise<boolean> {
  await randomDelay(100, 300);
  
  const afterUrl = page.url();
  const afterHtml = await page.content();
  
  // Dead click if: no URL change AND no significant DOM change
  const urlChanged = beforeUrl !== afterUrl;
  const htmlChanged = beforeHtml !== afterHtml;
  
  return !urlChanged && !htmlChanged;
}

/**
 * Simulate mouse shake: back-and-forth movement so telemetry.js detects ≥3 direction flips in 500ms
 */
export async function simulateMouseShake(
  page: Page,
  iterations: number = 5
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const step = 80;
  for (let i = 0; i < Math.max(iterations, 6); i++) {
    const x = cx + (i % 2 === 0 ? step : -step);
    const y = cy + (i % 2 === 0 ? 0 : 20);
    await page.mouse.move(x, y, { steps: 2 });
    await randomDelay(25, 45);
  }
}

/**
 * Simulate erratic scrolling: ≥4 scroll steps with ≥3 direction flips in 2s for telemetry.js
 */
export async function simulateErraticScroll(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const amount = randomInt(80, 200);
  const steps = [1, -1, 1, -1, 1];
  for (const dir of steps) {
    await page.evaluate(({ a, d }: { a: number; d: number }) => {
      window.scrollBy(0, a * d);
    }, { a: amount, d: dir });
    await randomDelay(80, 180);
  }
}

/**
 * Scroll to 25%, 50%, 75%, 100% to trigger scroll_depth milestones in telemetry.js
 */
export async function simulateScrollDepth(page: Page): Promise<void> {
  const milestones = [0.25, 0.5, 0.75, 1];
  for (const pct of milestones) {
    await page.evaluate((ratio: number) => {
      const doc = document.documentElement;
      const maxScroll = doc.scrollHeight - doc.clientHeight;
      if (maxScroll > 0) window.scrollTo(0, maxScroll * ratio);
    }, pct);
    await randomDelay(150, 350);
  }
}

/**
 * Get current page HTML snapshot (simplified)
 */
export async function getHtmlSnapshot(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return document.body.innerHTML;
  });
}

