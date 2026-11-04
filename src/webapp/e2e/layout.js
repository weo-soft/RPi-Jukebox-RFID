import { expect } from '@playwright/test';

const INTERACTIVE = [
  '.MuiButtonBase-root',
  '.MuiSlider-root',
  '.MuiInputBase-root',
  'a[href]',
  'button',
  'select',
].join(',');

export const SHELL_SELECTOR = '#routes';

const TOKEN_PROPERTIES = [
  '--gutter',
  '--nav-height',
  '--touch-min',
  '--font-display',
];

// The token file is imported by the entry point; without it every var(...)
// reference falls back to its initial value.
export async function expectTokensLoaded(page) {
  await expect.poll(() => page.evaluate(properties => (
    properties.filter(property => (
      getComputedStyle(document.documentElement).getPropertyValue(property).trim() === ''
    ))
  ), TOKEN_PROPERTIES)).toEqual([]);
}
export const NAV_SELECTOR = '.MuiBottomNavigation-root';

export async function collectTouchTargets(page) {
  return page.evaluate(selector => (
    Array.from(document.querySelectorAll(selector))
      .filter(element => !element.closest('[aria-hidden="true"]'))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 60),
          testId: element.getAttribute('data-testid'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter(({ width, height }) => width > 0 && height > 0)
  ), INTERACTIVE);
}

export async function expectTouchTargets(page, { min = 48, allow = [] } = {}) {
  const tooSmall = (await collectTouchTargets(page)).filter(
    ({ label, testId, width, height }) => (
      !allow.includes(label) && !allow.includes(testId) && (width < min || height < min)
    ),
  );

  expect(tooSmall).toEqual([]);
}

export async function expectNoDeadColumns(page, tolerance = 2) {
  const { left, right } = await page.evaluate((shellSelector) => {
    const shell = document.querySelector(shellSelector);
    const style = getComputedStyle(shell);
    const shellBox = shell.getBoundingClientRect();
    const box = document.querySelector('main').getBoundingClientRect();
    return {
      left: box.left - (shellBox.left + parseFloat(style.paddingLeft)),
      right: (shellBox.right - parseFloat(style.paddingRight)) - box.right,
    };
  }, SHELL_SELECTOR);

  expect(Math.max(left, right)).toBeLessThanOrEqual(tolerance);
}

export async function expectShellFillsViewport(page, maxWidth = 1100) {
  const { shell, viewport } = await page.evaluate((shellSelector) => ({
    shell: document.querySelector(shellSelector).getBoundingClientRect().width,
    viewport: window.innerWidth,
  }), SHELL_SELECTOR);

  expect(shell).toBeCloseTo(Math.min(viewport, maxWidth), 0);
}

export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - window.innerWidth
  ));

  expect(overflow).toBeLessThanOrEqual(0);
}

export async function expectNoScroll(page) {
  const { scrollHeight, scrollWidth, innerHeight, innerWidth } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));

  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

export async function expectNoDeadRows(page, { between, and, max = 24 }) {
  const gap = await page.evaluate(({ between, and }) => {
    const top = document.querySelector(between).getBoundingClientRect();
    const bottom = document.querySelector(and).getBoundingClientRect();
    return bottom.top - top.bottom;
  }, { between, and });

  expect(gap).toBeLessThanOrEqual(max);
}

export async function expectBoxSize(page, selector, { min } = {}) {
  const box = await page.locator(selector).boundingBox();

  expect(box).not.toBeNull();
  if (min !== undefined) {
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(min);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(min);
  }

  return box;
}
