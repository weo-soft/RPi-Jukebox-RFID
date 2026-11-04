import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import PubSubContext from '../../../context/pubsub/context';
import request from '../../../utils/request';
import SettingsDisplay from './index';
import de from '../../../../public/locales/de/translation.json';
import en from '../../../../public/locales/en/translation.json';


const { translations } = vi.hoisted(() => ({
  translations: {
    'settings.display.title': 'Display',
    'settings.display.state': 'State',
    'settings.display.state-active': 'On',
    'settings.display.state-dimmed': 'Dimmed',
    'settings.display.state-standby': 'Standby',
    'settings.display.source': 'Source',
    'settings.display.source-sysfs': 'Backlight',
    'settings.display.source-ddc': 'DDC/CI',
    'settings.display.source-x11': 'Software dimming (gamma)',
    'settings.display.source-none': 'None',
    'settings.display.device': 'Device',
    'settings.display.brightness': 'Brightness',
    'settings.display.dim-brightness': 'Dim brightness',
    'settings.display.dim-timeout': 'Dim after (minutes)',
    'settings.display.standby-timeout': 'Standby after (minutes)',
    'settings.display.music-mode': 'While music is playing',
    'settings.display.music-mode-normal': 'Normal',
    'settings.display.music-mode-on': 'Stay on while playing',
    'settings.display.music-mode-dim': 'Dim while playing',
    'settings.display.standby-mechanic': 'Standby mechanic',
    'settings.display.standby-mechanic-auto': 'Automatic',
    'settings.display.standby-mechanic-backlight': 'Dark',
    'settings.display.standby-mechanic-power-off': 'Off',
    'settings.display.power': 'Display on',
    'settings.display.busy': 'Applying…',
    'settings.display.unavailable': 'Display cannot be controlled.',
    'settings.display.no-backlight': 'No backlight device found.',
    'settings.display.no-input': 'No permission to read input devices.',
    'settings.display.software-dim': 'Software dimming (gamma).',
    'settings.display.errors': 'Errors',
    'settings.display.tap-to-wake': 'Touch to wake',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: key => translations[key] || key,
  }),
}));

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));

const STATUS = {
  state: 'active',
  power: true,
  brightness_percent: 60,
  dim_brightness_percent: 5,
  dim_timeout_min: 2,
  standby_timeout_min: 5,
  music_mode: 'normal',
  standby_mechanic: 'auto',
  standby_mechanic_active: 'backlight',
  brightness_source: 'sysfs',
  max_brightness: 255,
  backlight_device: 'panel',
  dim_available: true,
  busy: false,
  errors: [],
};

const provider = (state, child) => (
  <PubSubContext.Provider value={{ state, setState: vi.fn() }}>
    {child}
  </PubSubContext.Provider>
);

beforeEach(() => {
  window.localStorage.setItem('settingsCollapsedSections', '[]');
  vi.clearAllMocks();
  request.mockResolvedValue({ result: STATUS });
});

test('defines the display translations under settings', () => {
  [en, de].forEach((i18n) => {
    expect(i18n.settings.display.title).toBeTruthy();
    expect(i18n.settings.display.brightness).toBeTruthy();
    expect(i18n.settings.display['source-x11']).toBeTruthy();
    expect(i18n.settings.display.unavailable).toBeTruthy();
  });
});

test('renders controls from the initial status', async () => {
  render(provider({}, <SettingsDisplay />));

  await waitFor(() => expect(request).toHaveBeenCalledWith('displayStatus'));
  const brightness = await screen.findByRole('slider', { name: 'Brightness' });
  await waitFor(() => expect(brightness).toBeEnabled());
  expect(screen.getByRole('slider', { name: 'Dim brightness' })).toBeEnabled();
  expect(screen.getByText(/Source:/).textContent).toContain('Backlight');
});

test('shows the unavailable hint without controls', async () => {
  request.mockResolvedValue({
    result: {
      ...STATUS,
      brightness_source: null,
      dim_available: false,
      errors: ['no_display_control'],
    },
  });

  render(provider({}, <SettingsDisplay />));

  expect(
    await screen.findByText(/Display cannot be controlled/),
  ).toBeVisible();
  expect(screen.queryByRole('slider', { name: 'Brightness' })).toBeNull();
});

test('disables the sliders without a backlight and shows a hint', async () => {
  request.mockResolvedValue({
    result: {
      ...STATUS,
      brightness_source: null,
      dim_available: false,
      errors: ['no_backlight_device'],
    },
  });

  render(provider({}, <SettingsDisplay />));

  expect(await screen.findByText(/No backlight device found/)).toBeVisible();
  expect(screen.getByRole('slider', { name: 'Brightness' })).toBeDisabled();
  expect(screen.getByRole('slider', { name: 'Dim brightness' })).toBeDisabled();
});

test('shows the software dimming hint for the x11 source', async () => {
  request.mockResolvedValue({
    result: {
      ...STATUS,
      brightness_source: 'x11',
      errors: [],
    },
  });

  render(provider({}, <SettingsDisplay />));

  expect((await screen.findAllByText(/Software dimming/)).length).toBeGreaterThan(0);
});

test('commits the brightness slider', async () => {
  render(provider({}, <SettingsDisplay />));
  const slider = await screen.findByRole('slider', { name: 'Brightness' });
  await waitFor(() => expect(slider).toBeEnabled());

  fireEvent.keyDown(slider, { key: 'ArrowRight' });

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('displaySetBrightness', {
      percent: 61,
    });
  });
});

test('commits both timeouts from the number fields', async () => {
  render(provider({}, <SettingsDisplay />));
  const field = await screen.findByRole('spinbutton', {
    name: 'Dim after (minutes)',
  });

  fireEvent.change(field, { target: { value: '3' } });
  fireEvent.blur(field);

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('displaySetTimeouts', {
      dim_min: 3,
      standby_min: 5,
    });
  });
});

test('sends the music mode selection', async () => {
  const user = userEvent.setup();
  render(provider({}, <SettingsDisplay />));
  const select = await screen.findByRole('combobox', {
    name: 'While music is playing',
  });

  fireEvent.mouseDown(select);
  const option = await screen.findByText('Dim while playing');
  await user.click(option);

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('displaySetMusicMode', {
      mode: 'dim_while_playing',
    });
  });
});

test('toggles the display power', async () => {
  render(provider({}, <SettingsDisplay />));
  const toggle = await screen.findByLabelText('Display on');

  fireEvent.click(toggle);

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('displaySetPower', { on: false });
  });
});

test('applies a published standby state', async () => {
  request.mockReturnValue(new Promise(() => {}));
  const { rerender } = render(provider({}, <SettingsDisplay />));

  rerender(provider({
    'display.status': {
      ...STATUS,
      state: 'standby',
      power: false,
    },
  }, <SettingsDisplay />));

  await waitFor(() => {
    expect(screen.getByLabelText('Display on')).not.toBeChecked();
  });
});

test('shows the unavailable hint when the status call fails', async () => {
  request.mockResolvedValue({ error: 'plugin not loaded' });

  render(provider({}, <SettingsDisplay />));

  expect(
    await screen.findByText(/Display cannot be controlled/),
  ).toBeVisible();
  expect(screen.getByText(/plugin not loaded/)).toBeVisible();
});
