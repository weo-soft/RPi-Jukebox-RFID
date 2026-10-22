import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import AppSettingsContext from '../../../context/appsettings/context';
import NavigationVisibilityContext from '../../../context/navigation/context';
import request from '../../../utils/request';
import NavigationVisibility from './navigation-visibility';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));

const renderSettings = ({
  globalVisible = false,
  localVisible = true,
  setLocalVisibility = vi.fn(),
  setSettings = vi.fn(),
} = {}) => render(
  <AppSettingsContext.Provider
    value={{
      setSettings,
      settings: { navigation_visible_global: globalVisible },
    }}
  >
    <NavigationVisibilityContext.Provider
      value={{ localVisible, setLocalVisibility }}
    >
      <NavigationVisibility />
    </NavigationVisibilityContext.Provider>
  </AppSettingsContext.Provider>,
);

test('the local switch stores the visibility of this device', async () => {
  const user = userEvent.setup();
  const setLocalVisibility = vi.fn();
  renderSettings({ localVisible: true, setLocalVisibility });

  await user.click(screen.getByRole('switch', {
    name: 'settings.general.navigation_local.title',
  }));

  expect(setLocalVisibility).toHaveBeenCalledWith(false);
});

test('the global switch is stored in the box configuration', async () => {
  const user = userEvent.setup();
  const setSettings = vi.fn();
  request.mockResolvedValue({});
  renderSettings({ globalVisible: false, setSettings });

  await user.click(screen.getByRole('switch', {
    name: 'settings.general.navigation_global.title',
  }));

  expect(request).toHaveBeenCalledWith('setAppSettings', {
    settings: { navigation_visible_global: true },
  });
  const update = setSettings.mock.calls[0][0];
  expect(update({ show_covers: true })).toEqual({
    navigation_visible_global: true,
    show_covers: true,
  });
});

test('the local switch is disabled while the global flag is on', () => {
  renderSettings({ globalVisible: true, localVisible: false });

  expect(screen.getByRole('switch', {
    name: 'settings.general.navigation_local.title',
  })).toBeDisabled();
});
