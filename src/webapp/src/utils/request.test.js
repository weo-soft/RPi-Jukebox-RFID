import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';


vi.mock('../sockets', () => ({
  socketRequest: vi.fn(),
}));


let now = 100000;

const load = async () => {
  vi.resetModules();
  const sockets = await import('../sockets');
  const requestModule = await import('./request');
  return {
    request: requestModule.default,
    socketRequest: sockets.socketRequest,
  };
};

const activityCalls = (socketRequest) => socketRequest.mock.calls.filter(
  call => call[1] === 'activity',
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  now = 100000;
  vi.restoreAllMocks();
});

test('passive commands do not send an activity ping', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockResolvedValue({});

  await request('getVolume');

  expect(socketRequest).toHaveBeenCalledTimes(1);
  expect(activityCalls(socketRequest)).toHaveLength(0);
});

test('interactive commands send one activity ping', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockResolvedValue({});

  await request('play');

  expect(socketRequest).toHaveBeenCalledTimes(2);
  expect(socketRequest).toHaveBeenLastCalledWith(
    'display',
    'activity',
    null,
    {},
  );
});

test('throttles activity pings to one per second', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockResolvedValue({});

  await request('play');
  await request('pause');
  expect(activityCalls(socketRequest)).toHaveLength(1);

  now += 1000;
  await request('next_song');
  expect(activityCalls(socketRequest)).toHaveLength(2);
});

test('display commands never send an activity ping', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockResolvedValue({});

  await request('displaySetPower', { on: false });

  expect(socketRequest).toHaveBeenCalledTimes(1);
  expect(activityCalls(socketRequest)).toHaveLength(0);
});

test('a failing activity ping does not affect the command', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockImplementation((_package, plugin) => (
    plugin === 'activity'
      ? Promise.reject(new Error('activity unavailable'))
      : Promise.resolve({ ok: true })
  ));

  await expect(request('play')).resolves.toEqual({
    result: { ok: true },
  });
});

test('a failed command does not send an activity ping', async () => {
  const { request, socketRequest } = await load();
  socketRequest.mockRejectedValue(new Error('rpc failed'));

  const result = await request('play');

  expect(result.error).toBeInstanceOf(Error);
  expect(activityCalls(socketRequest)).toHaveLength(0);
});
