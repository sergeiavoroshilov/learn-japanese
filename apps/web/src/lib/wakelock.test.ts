import { describe, expect, test } from 'bun:test';
import { ScreenWakeLock, type WakeLockHandle } from './wakelock';

function fake() {
  const state = { requests: 0, released: 0, listeners: [] as (() => void)[] };
  const handle: WakeLockHandle = {
    release: async () => {
      state.released++;
    },
    addEventListener: (_type, listener) => state.listeners.push(listener),
  };
  return {
    state,
    request: async () => {
      state.requests++;
      return handle;
    },
  };
}

describe('ScreenWakeLock', () => {
  test('takes the lock once while held', async () => {
    const { state, request } = fake();
    const lock = new ScreenWakeLock(request);
    await lock.hold();
    await lock.hold();
    expect(state.requests).toBe(1);
    expect(lock.status).toBe('held');
  });

  test('lets go on release', async () => {
    const { state, request } = fake();
    const lock = new ScreenWakeLock(request);
    await lock.hold();
    await lock.release();
    expect(state.released).toBe(1);
    expect(lock.status).toBe('idle');
  });

  test('a lock the platform dropped is not counted as held', async () => {
    // The phone releases it whenever the page is hidden; the object stays but
    // the screen no longer stays awake.
    const { state, request } = fake();
    const lock = new ScreenWakeLock(request);
    await lock.hold();
    state.listeners.forEach((l) => l());
    expect(lock.status).toBe('idle');
  });

  test('a browser without the API says so instead of failing silently', async () => {
    const lock = new ScreenWakeLock(null);
    await lock.hold();
    expect(lock.status).toBe('unsupported');
  });

  test('a refusal is reported, not thrown', async () => {
    const lock = new ScreenWakeLock(async () => {
      throw new Error('NotAllowedError');
    });
    await lock.hold();
    expect(lock.status).toBe('refused');
  });

  test('releasing during the request does not leak the lock', async () => {
    const { state, request } = fake();
    const lock = new ScreenWakeLock(request);
    const holding = lock.hold();
    await lock.release();
    await holding;
    expect(state.released).toBeGreaterThan(0);
    expect(lock.status).not.toBe('held');
  });
});

describe('a refusal while the page is hidden', () => {
  test('is pending rather than a verdict — it self-corrects on return', async () => {
    // Chrome rejects with NotAllowedError whenever document.hidden is true.
    // Reporting that as «the browser will not keep your screen on» would put
    // a false warning on the drill of anyone who started it in a background
    // tab; the visibility listener asks again as soon as they look at it.
    const previous = globalThis.document;
    // @ts-expect-error minimal stand-in for a hidden document
    globalThis.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
    try {
      const lock = new ScreenWakeLock(async () => {
        throw Object.assign(new Error('The requesting page is not visible'), {
          name: 'NotAllowedError',
        });
      });
      await lock.hold();
      expect(lock.status).toBe('idle');
    } finally {
      globalThis.document = previous;
    }
  });
});
