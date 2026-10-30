import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import PubSubContext from '../../context/pubsub/context';
import BatteryIndicator from './indicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const strings = {
        'settings.status.battery.details': '{{voltage}} V · {{current}} A · {{power}} W',
        'settings.status.battery.indicator.aria-label': 'Battery {{soc}} percent, {{state}}',
        'settings.status.battery.states.charging': 'Charging',
        'settings.status.battery.states.discharging': 'Discharging',
        'settings.status.battery.states.idle': 'Idle',
        'settings.status.battery.states.unknown': 'Unknown',
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
  charging: false,
  current_ma: 450,
  power_w: 5.4,
  soc: 76,
  state: 'discharging',
  voltage: 12005,
  voltage_v: 12.005,
};

const renderIndicator = (state) => render(
  <MemoryRouter>
    <PubSubContext.Provider value={{ setState: vi.fn(), state }}>
      <BatteryIndicator />
    </PubSubContext.Provider>
  </MemoryRouter>,
);

test('renders nothing without a battery status', () => {
  const { container } = renderIndicator({});

  expect(container).toBeEmptyDOMElement();
});

test('renders nothing while the source is unavailable', () => {
  const { container } = renderIndicator({
    'batt_status': { available: false, charging: false, state: 'unavailable' },
  });

  expect(container).toBeEmptyDOMElement();
});

test('renders nothing when the available flag is missing', () => {
  const { container } = renderIndicator({ 'batt_status': { charging: false, soc: 76 } });

  expect(container).toBeEmptyDOMElement();
});

test('shows the charge level and links to the settings', () => {
  renderIndicator({ 'batt_status': batteryStatus });

  expect(screen.getByText('76%')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Battery 76 percent, Discharging' });
  expect(link).toHaveAttribute('href', '/settings');
});
