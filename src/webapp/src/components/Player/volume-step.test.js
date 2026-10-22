import { expect, test } from 'vitest';

import { nextVolume } from './volume-step';

test('an off-step volume moves up to the next multiple of five', () => {
  expect(nextVolume(42, 5)).toBe(45);
  expect(nextVolume(41, 5)).toBe(45);
  expect(nextVolume(40, 5)).toBe(45);
});

test('an off-step volume moves down to the previous multiple of five', () => {
  expect(nextVolume(42, -5)).toBe(40);
  expect(nextVolume(41, -5)).toBe(40);
  expect(nextVolume(40, -5)).toBe(35);
});

test('the step stops at zero and at the configured maximum', () => {
  expect(nextVolume(2, -5)).toBe(0);
  expect(nextVolume(0, -5)).toBe(0);
  expect(nextVolume(78, 5, 80)).toBe(80);
  expect(nextVolume(42, 5, 43)).toBe(43);
});
