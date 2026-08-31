/**
 * Keeps the screen awake for the length of a drill.
 *
 * A speed drill is minutes of speaking at a glyph and never touching the
 * screen, which is exactly what a phone reads as "idle" — so it dims and
 * locks mid-session. The Screen Wake Lock API is the fix, with one catch
 * worth knowing: the platform releases the lock whenever the page stops
 * being visible, so holding it is not a single call but a subscription.
 */

/** The slice of WakeLockSentinel we use — kept structural so it can be faked. */
export interface WakeLockHandle {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export type WakeLockRequest = () => Promise<WakeLockHandle>;

export function browserWakeLock(): WakeLockRequest | null {
  const api = (
    navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockHandle> } }
  ).wakeLock;
  return api ? () => api.request('screen') : null;
}

export type WakeLockState = 'idle' | 'held' | 'unsupported' | 'refused';

export class ScreenWakeLock {
  private handle: WakeLockHandle | null = null;
  /** Whether a caller currently wants the screen awake. */
  private wanted = false;
  private state: WakeLockState = 'idle';

  private readonly onVisible = () => {
    // The lock is dropped every time the page is hidden — a notification, a
    // glance at another app — and must be taken again on the way back.
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  constructor(private readonly request: WakeLockRequest | null = browserWakeLock()) {}

  get status(): WakeLockState {
    return this.state;
  }

  async hold(): Promise<void> {
    if (this.request === null) {
      this.state = 'unsupported';
      return;
    }
    this.wanted = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible);
    }
    await this.acquire();
  }

  async release(): Promise<void> {
    this.wanted = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    const handle = this.handle;
    this.handle = null;
    if (this.state === 'held') this.state = 'idle';
    // A lock the platform already dropped rejects on release; nothing to fix.
    await handle?.release().catch(() => {});
  }

  private async acquire(): Promise<void> {
    if (this.handle || this.request === null) return;
    try {
      const handle = await this.request();
      // Lost the race with release() — let go again rather than leaking it.
      if (!this.wanted) {
        await handle.release().catch(() => {});
        return;
      }
      this.handle = handle;
      this.state = 'held';
      handle.addEventListener('release', () => {
        this.handle = null;
        if (this.wanted) this.state = 'idle';
      });
    } catch {
      // Two very different failures land here. Asking while the page is
      // hidden is always refused («The requesting page is not visible») and
      // fixes itself on the way back — the visibility listener will ask
      // again, so this is pending, not a verdict. Anything else is a real
      // refusal worth telling the user about.
      this.state = this.hidden() ? 'idle' : 'refused';
    }
  }

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState !== 'visible';
  }
}
