import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import AppSettingsContext from '../appsettings/context';
import NavigationVisibilityProvider, { useNavigationVisibility } from './index';
import { NAVIGATION_VISIBLE_KEY } from './visibility';

const Probe = () => {
  const {
    localVisible,
    revealNavigation,
    showStartNavigation,
  } = useNavigationVisibility();

  return (
    <>
      <span data-testid="local">{String(localVisible)}</span>
      <span data-testid="show">{String(showStartNavigation)}</span>
      <button onClick={revealNavigation} type="button">reveal</button>
    </>
  );
};

const renderVisibility = ({ isLoaded = true, kiosk, settings = {} }) => render(
  <AppSettingsContext.Provider
    value={{ isLoaded, setSettings: () => {}, settings }}
  >
    <NavigationVisibilityProvider kiosk={kiosk}>
      <Probe />
    </NavigationVisibilityProvider>
  </AppSettingsContext.Provider>,
);

beforeEach(() => {
  window.localStorage.clear();
});

test('the kiosk seeds the local setting to hidden', async () => {
  renderVisibility({
    kiosk: true,
    settings: { navigation_visible_kiosk_seed: false },
  });

  await waitFor(() => {
    expect(window.localStorage.getItem(NAVIGATION_VISIBLE_KEY)).toBe('false');
  });
  expect(screen.getByTestId('local')).toHaveTextContent('false');
  expect(screen.getByTestId('show')).toHaveTextContent('false');
});

test('a desktop seeds the local setting to visible', async () => {
  renderVisibility({
    kiosk: false,
    settings: { navigation_visible_kiosk_seed: false },
  });

  await waitFor(() => {
    expect(window.localStorage.getItem(NAVIGATION_VISIBLE_KEY)).toBe('true');
  });
  expect(screen.getByTestId('local')).toHaveTextContent('true');
  expect(screen.getByTestId('show')).toHaveTextContent('true');
});

test('an existing local value is not overwritten by the seed', async () => {
  window.localStorage.setItem(NAVIGATION_VISIBLE_KEY, 'true');

  renderVisibility({
    kiosk: true,
    settings: { navigation_visible_kiosk_seed: false },
  });

  await waitFor(() => {
    expect(screen.getByTestId('local')).toHaveTextContent('true');
  });
  expect(window.localStorage.getItem(NAVIGATION_VISIBLE_KEY)).toBe('true');
});

test('the global setting shows the navigation despite a hidden local value', async () => {
  renderVisibility({
    kiosk: true,
    settings: {
      navigation_visible_global: true,
      navigation_visible_kiosk_seed: false,
    },
  });

  await waitFor(() => {
    expect(screen.getByTestId('show')).toHaveTextContent('true');
  });
  expect(screen.getByTestId('local')).toHaveTextContent('false');
});

test('the reveal stores the local visibility as visible', async () => {
  const user = userEvent.setup();
  renderVisibility({
    kiosk: true,
    settings: { navigation_visible_kiosk_seed: false },
  });

  await waitFor(() => {
    expect(screen.getByTestId('local')).toHaveTextContent('false');
  });

  await user.click(screen.getByRole('button', { name: 'reveal' }));

  expect(screen.getByTestId('local')).toHaveTextContent('true');
  expect(window.localStorage.getItem(NAVIGATION_VISIBLE_KEY)).toBe('true');
});

test('the seed waits for the server settings', async () => {
  renderVisibility({
    isLoaded: false,
    kiosk: true,
    settings: {},
  });

  expect(window.localStorage.getItem(NAVIGATION_VISIBLE_KEY)).toBeNull();
  expect(screen.getByTestId('local')).toHaveTextContent('false');
});
