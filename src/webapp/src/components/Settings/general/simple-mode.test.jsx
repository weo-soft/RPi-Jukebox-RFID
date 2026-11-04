import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import SimpleModeContext from '../../../context/simple-mode/context';
import SimpleMode from './simple-mode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

test('the switch changes the simple mode of this device', async () => {
  const user = userEvent.setup();
  const setSimpleMode = vi.fn();

  render(
    <SimpleModeContext.Provider value={{ setSimpleMode, simpleMode: false }}>
      <SimpleMode />
    </SimpleModeContext.Provider>,
  );

  await user.click(screen.getByRole('switch', {
    name: 'settings.general.simple_mode.title',
  }));

  expect(setSimpleMode).toHaveBeenCalledWith(true);
});
