import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import PubSubContext from '../../../context/pubsub/context';
import StatusBattery from './battery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const strings = {
        'general.loading': 'Loading',
        'settings.status.battery.details': '{{voltage}} V · {{current}} A · {{power}} W',
        'settings.status.battery.states.charging': 'Charging',
        'settings.status.battery.states.discharging': 'Discharging',
        'settings.status.battery.states.idle': 'Idle',
        'settings.status.battery.states.unknown': 'Unknown',
        'settings.status.battery.title': 'Battery',
        'settings.status.battery.unavailable': 'Unavailable',
      };
      const template = strings[key] ?? key;
      if (!options) {
        return template;
      }
      return Object.entries(options).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

const batteryStatus = {
  available: true,
  charging: true,
  current_ma: 450,
  power_w: 5.4,
  soc: 76,
  state: 'charging',
  voltage: 12005,
  voltage_v: 12.5,
};

const renderRow = (state) => render(
  <PubSubContext.Provider value={{ setState: vi.fn(), state }}>
    <StatusBattery />
  </PubSubContext.Provider>,
);

const loadedPlugins = { 'core.plugins.loaded': { battmon: 'battery_monitor.batt_mon_json_file' } };

test('shows charge, state and details', async () => {
  const { container } = renderRow({ ...loadedPlugins, 'batt_status': batteryStatus });

  expect(await screen.findByText('76%')).toBeInTheDocument();
  expect(container.textContent).toContain('Charging');
  expect(container.textContent).toContain('12.50 V · 0.45 A · 5.4 W');
});

test('shows the unavailable label without a reading', async () => {
  renderRow({
    ...loadedPlugins,
    'batt_status': { available: false, charging: false, state: 'unavailable' },
  });

  expect(await screen.findByText('Unavailable')).toBeInTheDocument();
});

test('keeps the loading placeholder before the first publication', async () => {
  renderRow({ ...loadedPlugins });

  expect(await screen.findByText('Loading ...')).toBeInTheDocument();
});

test('renders nothing without the battery plugin', () => {
  const { container } = renderRow({ 'core.plugins.loaded': {} });

  expect(container).toBeEmptyDOMElement();
});
