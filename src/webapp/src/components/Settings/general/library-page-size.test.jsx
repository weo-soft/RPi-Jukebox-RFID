import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import AppSettingsContext from '../../../context/appsettings/context';
import request from '../../../utils/request';
import LibraryPageSize from './library-page-size';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));

const renderSetting = ({ setSettings = vi.fn() } = {}) => render(
  <AppSettingsContext.Provider
    value={{
      setSettings,
      settings: { library_page_size: 100 },
    }}
  >
    <LibraryPageSize />
  </AppSettingsContext.Provider>,
);

test('the default page size is stored in the box configuration', async () => {
  const user = userEvent.setup();
  const setSettings = vi.fn();
  request.mockResolvedValue({});
  renderSetting({ setSettings });

  await user.selectOptions(
    screen.getByLabelText('settings.general.library_page_size.title'),
    '200',
  );

  expect(request).toHaveBeenCalledWith('setAppSettings', {
    settings: { library_page_size: 200 },
  });
  const update = setSettings.mock.calls[0][0];
  expect(update({ show_covers: true })).toEqual({
    library_page_size: 200,
    show_covers: true,
  });
});
