import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import request from '../../utils/request';
import SettingsJellyfin from './jellyfin';

vi.mock('../../utils/request', () => ({
  default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

const baseSettings = {
  enabled: false,
  host: '',
  has_api_key: true,
  username: '',
  has_password: false,
  catalog_cache_ttl: 300,
  request_timeout: 30,
};

const renderJellyfin = () => render(<SettingsJellyfin />);

describe('SettingsJellyfin', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ result: baseSettings, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('loads the settings and renders secret fields empty and masked', async () => {
    renderJellyfin();

    expect(await screen.findByLabelText('settings.jellyfin.host'))
      .toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('getJellyfinSettings');

    const apiKey = screen.getByLabelText('settings.jellyfin.api-key');
    const password = screen.getByLabelText('settings.jellyfin.password');
    // Secrets must never be pre-filled and must be masked inputs.
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveValue('');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('');
  });

  test('shows a configured indicator only for secrets that are set', async () => {
    renderJellyfin();

    await screen.findByLabelText('settings.jellyfin.host');
    // api_key is configured (has_api_key), password is not.
    expect(screen.getByTestId('jellyfin-secret-lock'))
      .toBeInTheDocument();
  });

  test('saves without transmitting empty secret fields', async () => {
    const user = userEvent.setup();
    renderJellyfin();
    await screen.findByLabelText('settings.jellyfin.host');

    await user.click(
      screen.getByRole('button', { name: 'settings.jellyfin.save' }),
    );

    expect(request).toHaveBeenCalledWith('setJellyfinSettings', {
      settings: {
        enabled: false,
        host: '',
        username: '',
        catalog_cache_ttl: 300,
        request_timeout: 30,
      },
    });
    expect(await screen.findByText('settings.jellyfin.saved'))
      .toBeInTheDocument();
  });

  test('transmits newly typed secrets and clears the fields afterwards', async () => {
    const user = userEvent.setup();
    renderJellyfin();
    await screen.findByLabelText('settings.jellyfin.host');

    await user.type(
      screen.getByLabelText('settings.jellyfin.api-key'),
      'new-key',
    );
    await user.type(
      screen.getByLabelText('settings.jellyfin.password'),
      'new-pw',
    );
    await user.click(
      screen.getByRole('button', { name: 'settings.jellyfin.save' }),
    );

    expect(request).toHaveBeenCalledWith('setJellyfinSettings', {
      settings: expect.objectContaining({
        api_key: 'new-key',
        password: 'new-pw',
      }),
    });
    expect(await screen.findByText('settings.jellyfin.saved'))
      .toBeInTheDocument();
    expect(screen.getByLabelText('settings.jellyfin.api-key')).toHaveValue('');
    expect(screen.getByLabelText('settings.jellyfin.password')).toHaveValue('');
  });

  test('shows backend errors from the save request', async () => {
    request.mockResolvedValueOnce({ result: baseSettings, error: null });
    request.mockResolvedValueOnce({
      result: null,
      error: 'Jellyfin is enabled but no server host is set',
    });
    const user = userEvent.setup();
    renderJellyfin();
    await screen.findByLabelText('settings.jellyfin.host');

    await user.click(
      screen.getByRole('button', { name: 'settings.jellyfin.save' }),
    );

    expect(
      await screen.findByText(
        'Jellyfin is enabled but no server host is set',
      ),
    ).toBeInTheDocument();
  });
});
