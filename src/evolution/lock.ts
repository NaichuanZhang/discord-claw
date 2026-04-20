// ---------------------------------------------------------------------------
// Evolution Lock — in-process async mutex for evolution operations
// ---------------------------------------------------------------------------
// Prevents race conditions when multiple concurrent sessions try to
// start/cancel/finalize evolutions simultaneously.
// ---------------------------------------------------------------------------

/**
 * A simple async mutex. Only one caller can hold the lock at a time.
 * Others wait in a FIFO queue.
 */
class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }

    // Wait until the lock is released
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      // Hand the lock to the next waiter
      const next = this._queue.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }

  /**
   * Execute a function while holding the lock.
   * Automatically releases the lock when done (even on error).
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get isLocked(): boolean {
    return this._locked;
  }

  get queueLength(): number {
    return this._queue.length;
  }
}

/**
 * Global evolution lock — guards all state-mutating evolution operations
 * (start, finalize, cancel) to prevent race conditions.
 */
export const evolutionLock = new AsyncMutex();
