import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';

import request from '../../../utils/request';
import SettingsMcp23017 from './index';

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => ({
      'settings.mcp23017.title': 'MCP23017 buttons',
      'settings.mcp23017.assignment-title': 'Pin assignment',
      'settings.mcp23017.learn-start': 'Start learning',
      'settings.mcp23017.learn-waiting': 'Press a button now…',
      'settings.mcp23017.learn-done': 'assigned',
      'settings.mcp23017.unassigned': 'Not assigned',
    })[key] || options?.defaultValue || key,
  }),
}));

const makeSettings = (overrides = {}) => ({
  state: 'running',
  enabled: true,
  bus: 1,
  address: '0x20',
  config_file: '/home/phoniebox/shared/settings/mcp23017.yaml',
  last_error: null,
  actions: [
    { id: 'play_pause', label: 'Play/Pause', type: 'momentary' },
    { id: 'next', label: 'Next title', type: 'momentary', danger: false },
  ],
  pins: Array.from({ length: 16 }, (_, pin) => ({
    pin,
    name: pin < 8 ? `GPA${pin}` : `GPB${pin - 8}`,
    assigned: false,
    button: null,
    action_id: null,
    type: null,
    advanced: false,
    valid: true,
    error: null,
  })),
  ...overrides,
});

beforeEach(() => {
  request.mockImplementation(async command => {
    if (command === 'mcp23017Settings') {
      return { result: makeSettings() };
    }
    if (command === 'mcp23017StartLearn') {
      return { result: { state: 'waiting', action_id: 'play_pause', pin: null } };
    }
    if (command === 'mcp23017LearnState') {
      return { result: { state: 'learned', action_id: 'play_pause', pin: 3 } };
    }
    if (command === 'mcp23017SetButton') {
      const pins = makeSettings().pins.map(entry => (
        entry.pin === 3
          ? { ...entry, assigned: true, action_id: 'play_pause', type: 'momentary' }
          : entry
      ));
      return { result: makeSettings({ pins }) };
    }
    if (command === 'mcp23017CancelLearn') {
      return { result: { state: 'idle', action_id: null, pin: null } };
    }
    return { result: null };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

test('renders all pins and the action catalog', async () => {
  render(<SettingsMcp23017 />);

  expect(await screen.findByText('GPA0')).toBeInTheDocument();
  expect(screen.getByText('GPB7')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('mcp23017Settings');
});

test('learning an action assigns the pressed button', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  const start = await screen.findByRole('button', { name: 'Start learning' });
  await user.click(start);

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      'mcp23017SetButton', { pin: 3, action_id: 'play_pause' });
  });
  expect(request).toHaveBeenCalledWith('mcp23017CancelLearn');
  expect(await screen.findByText(/GPA3/)).toBeInTheDocument();
});
