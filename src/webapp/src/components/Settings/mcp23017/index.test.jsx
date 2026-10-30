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
    t: (key, options) => {
      const templates = {
        'settings.mcp23017.title': 'MCP23017 buttons',
        'settings.mcp23017.add': 'Add assignment',
        'settings.mcp23017.empty': 'No buttons are assigned yet.',
        'settings.mcp23017.edit': 'Edit {{pin}}',
        'settings.mcp23017.delete': 'Delete {{pin}}',
        'settings.mcp23017.remove-title': 'Remove assignment?',
        'settings.mcp23017.remove': 'Remove',
        'settings.mcp23017.cancel': 'Cancel',
        'settings.mcp23017.save': 'Save',
        'settings.mcp23017.dialog-add-title': 'Add button assignment',
        'settings.mcp23017.dialog-edit-title': 'Change button assignment',
        'settings.mcp23017.mode-direct': 'Choose input and action',
        'settings.mcp23017.mode-learn': 'Assign by pressing',
        'settings.mcp23017.learn-start': 'Start learning',
        'settings.mcp23017.pin': 'Input',
        'settings.mcp23017.action': 'Action',
        'settings.mcp23017.choose-action': 'Choose an action',
        'settings.mcp23017.actions.play_pause': 'Play/Pause',
        'settings.mcp23017.actions.next': 'Next title',
        'settings.mcp23017.actions.previous': 'Previous title',
      };
      const template = templates[key] ?? options?.defaultValue ?? key;
      return options
        ? template.replace(/{{(\w+)}}/g, (_match, name) => options[name] ?? '')
        : template;
    },
  }),
}));

const basePins = () => (
  Array.from({ length: 16 }, (_, pin) => ({
    pin,
    name: pin < 8 ? `GPA${pin}` : `GPB${pin - 8}`,
    assigned: false,
    button: null,
    action_id: null,
    type: null,
    advanced: false,
    valid: true,
    error: null,
  }))
);

const makeSettings = (overrides = {}) => {
  const pins = basePins();
  pins[0] = {
    ...pins[0],
    assigned: true,
    button: 'play_pause',
    action_id: 'play_pause',
    type: 'momentary',
  };
  pins[2] = {
    ...pins[2],
    assigned: true,
    button: 'previous',
    action_id: 'previous',
    type: 'momentary',
  };
  return {
    state: 'running',
    enabled: true,
    bus: 1,
    address: '0x20',
    config_file: '/home/phoniebox/shared/settings/mcp23017.yaml',
    last_error: null,
    actions: [
      { id: 'play_pause', label: 'Play/Pause', type: 'momentary' },
      { id: 'next', label: 'Next title', type: 'momentary' },
      { id: 'previous', label: 'Previous title', type: 'momentary' },
    ],
    pins,
    ...overrides,
  };
};

const assignedSettings = (pin, actionId) => {
  const settings = makeSettings();
  const pins = settings.pins.map(entry => (
    entry.pin === pin
      ? {
        ...entry,
        action_id: actionId,
        assigned: true,
        button: `button_${pin}`,
        type: 'momentary',
      }
      : entry
  ));
  return makeSettings({ pins });
};

const removedSettings = pin => {
  const settings = makeSettings();
  const pins = settings.pins.map(entry => (
    entry.pin === pin
      ? { ...entry, action_id: null, assigned: false, button: null, type: null }
      : entry
  ));
  return makeSettings({ pins });
};

beforeEach(() => {
  request.mockImplementation(async (command, payload = {}) => {
    if (command === 'mcp23017Settings') {
      return { result: makeSettings() };
    }
    if (command === 'mcp23017SetButton') {
      return { result: assignedSettings(payload.pin, payload.action_id) };
    }
    if (command === 'mcp23017ClearButton') {
      return { result: removedSettings(payload.pin) };
    }
    if (command === 'mcp23017StartLearn') {
      return { result: { state: 'waiting', action_id: payload.action_id, pin: null } };
    }
    if (command === 'mcp23017LearnState') {
      return { result: { state: 'learned', action_id: 'next', pin: 4 } };
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

test('shows only the assigned buttons and offers an add action', async () => {
  render(<SettingsMcp23017 />);

  expect(await screen.findByText('GPA0')).toBeInTheDocument();
  expect(screen.getByText('Play/Pause')).toBeInTheDocument();
  expect(screen.getByText('GPA2')).toBeInTheDocument();
  expect(screen.getByText('Previous title')).toBeInTheDocument();
  expect(screen.queryByText('GPA1')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add assignment' })).toBeInTheDocument();
});

test('changes the action of an assigned button', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  await user.click(await screen.findByRole('button', { name: 'Edit GPA0' }));
  expect(await screen.findByText('Change button assignment')).toBeInTheDocument();

  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: 'Next title' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      'mcp23017SetButton', { pin: 0, action_id: 'next' });
  });
  expect(await screen.findByText('Next title')).toBeInTheDocument();
});

test('adds an assignment by choosing an input and an action', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  await user.click(await screen.findByRole('button', { name: 'Add assignment' }));
  expect(await screen.findByText('Add button assignment')).toBeInTheDocument();

  const selects = screen.getAllByRole('combobox');
  await user.click(selects[0]);
  await user.click(await screen.findByRole('option', { name: 'GPA1' }));
  await user.click(screen.getAllByRole('combobox')[1]);
  await user.click(await screen.findByRole('option', { name: 'Next title' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      'mcp23017SetButton', { pin: 1, action_id: 'next' });
  });
});

test('removes an assignment after confirmation', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  await user.click(await screen.findByRole('button', { name: 'Delete GPA2' }));
  expect(await screen.findByText('Remove assignment?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('mcp23017ClearButton', { pin: 2 });
  });
  await waitFor(() => {
    expect(screen.queryByText('GPA2')).not.toBeInTheDocument();
  });
});

test('learns the input from a button press', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  await user.click(await screen.findByRole('button', { name: 'Add assignment' }));
  await user.click(screen.getByRole('tab', { name: 'Assign by pressing' }));
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: 'Next title' }));
  await user.click(screen.getByRole('button', { name: 'Start learning' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      'mcp23017SetButton', { pin: 4, action_id: 'next' });
  });
  await waitFor(() => {
    expect(screen.queryByText('Add button assignment')).not.toBeInTheDocument();
  });
});


test('moves the assignment when editing learns another input', async () => {
  const user = userEvent.setup();
  render(<SettingsMcp23017 />);

  await user.click(await screen.findByRole('button', { name: 'Edit GPA0' }));
  await user.click(screen.getByRole('tab', { name: 'Assign by pressing' }));
  await user.click(screen.getByRole('button', { name: 'Start learning' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      'mcp23017SetButton', { pin: 4, action_id: 'play_pause' });
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('mcp23017ClearButton', { pin: 0 });
  });
});
