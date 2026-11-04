import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';

import PubSubContext from '../../context/pubsub/context';
import { socketRequest } from '../../sockets';
import WakeOverlay from './WakeOverlay';


vi.mock('../../sockets', () => ({
  socketRequest: vi.fn(),
}));

const provider = (state, child) => (
  <PubSubContext.Provider value={{ state, setState: vi.fn() }}>
    {child}
  </PubSubContext.Provider>
);

const standby = () => provider(
  { 'display.status': { state: 'standby' } },
  <WakeOverlay />,
);

beforeEach(() => {
  vi.clearAllMocks();
  socketRequest.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

test('shows the overlay in standby and sends exactly one activity ping', () => {
  render(standby());

  const overlay = screen.getByTestId('wake-overlay');
  fireEvent.pointerDown(overlay);
  fireEvent.pointerDown(overlay);

  expect(socketRequest).toHaveBeenCalledTimes(1);
  expect(socketRequest).toHaveBeenCalledWith(
    'display',
    'activity',
    null,
    {},
  );
});

test('does not render for active, dimmed or missing status', () => {
  const { rerender } = render(provider(
    { 'display.status': { state: 'active' } },
    <WakeOverlay />,
  ));
  expect(screen.queryByTestId('wake-overlay')).toBeNull();

  rerender(provider(
    { 'display.status': { state: 'dimmed' } },
    <WakeOverlay />,
  ));
  expect(screen.queryByTestId('wake-overlay')).toBeNull();

  rerender(provider({}, <WakeOverlay />));
  expect(screen.queryByTestId('wake-overlay')).toBeNull();
});

test('swallows the tap and does not reach the content underneath', () => {
  const parentPointerDown = vi.fn();
  render(
    <div onPointerDown={parentPointerDown}>
      {standby()}
    </div>,
  );

  const overlay = screen.getByTestId('wake-overlay');
  fireEvent.pointerDown(overlay);
  fireEvent.pointerUp(overlay);
  fireEvent.click(overlay);

  expect(parentPointerDown).not.toHaveBeenCalled();
});

test('keeps swallowing the tap during the release delay', () => {
  vi.useFakeTimers();
  const { rerender } = render(standby());
  fireEvent.pointerDown(screen.getByTestId('wake-overlay'));
  expect(socketRequest).toHaveBeenCalledTimes(1);

  rerender(provider(
    { 'display.status': { state: 'active' } },
    <WakeOverlay />,
  ));
  expect(screen.getByTestId('wake-overlay')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByTestId('wake-overlay'));
  expect(socketRequest).toHaveBeenCalledTimes(1);

  act(() => {
    vi.advanceTimersByTime(599);
  });
  expect(screen.getByTestId('wake-overlay')).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByTestId('wake-overlay')).toBeNull();
});

test('sends a new wake ping after the next standby period', () => {
  const { rerender } = render(standby());
  fireEvent.pointerDown(screen.getByTestId('wake-overlay'));
  expect(socketRequest).toHaveBeenCalledTimes(1);

  rerender(provider(
    { 'display.status': { state: 'active' } },
    <WakeOverlay />,
  ));
  rerender(standby());

  fireEvent.pointerDown(screen.getByTestId('wake-overlay'));
  expect(socketRequest).toHaveBeenCalledTimes(2);
});
