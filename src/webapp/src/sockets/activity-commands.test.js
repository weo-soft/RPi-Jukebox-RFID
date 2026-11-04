import { expect, test } from 'vitest';

import commands from '../commands';
import {
  INTERACTIVE_COMMANDS,
  PASSIVE_COMMANDS,
} from './activity-commands';


test('classifies every command exactly once', () => {
  const keys = Object.keys(commands);

  keys.forEach((key) => {
    const passive = PASSIVE_COMMANDS.has(key);
    const interactive = INTERACTIVE_COMMANDS.has(key);
    expect(passive || interactive, `${key} is unclassified`).toBe(true);
    expect(passive && interactive, `${key} is classified twice`).toBe(false);
  });

  expect(PASSIVE_COMMANDS.size + INTERACTIVE_COMMANDS.size).toBe(keys.length);
});

test('keeps polling commands passive', () => {
  expect(PASSIVE_COMMANDS.has('getVolume')).toBe(true);
  expect(PASSIVE_COMMANDS.has('playerstatus')).toBe(true);
  expect(PASSIVE_COMMANDS.has('timer_shutdown.get_state')).toBe(true);
});

test('keeps user actions interactive', () => {
  expect(INTERACTIVE_COMMANDS.has('play')).toBe(true);
  expect(INTERACTIVE_COMMANDS.has('setVolume')).toBe(true);
  expect(INTERACTIVE_COMMANDS.has('timer_shutdown')).toBe(true);
});

test('classifies the display commands as interactive', () => {
  Object.keys(commands)
    .filter(key => key.startsWith('display'))
    .forEach((key) => {
      expect(INTERACTIVE_COMMANDS.has(key), key).toBe(true);
    });
});
