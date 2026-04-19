// ---------------------------------------------------------------------------
// Per-session lock — ensures only one message is processed at a time per session.
// When a second message arrives for the same session, it waits in a queue.
// ---------------------------------------------------------------------------

import { createLogger } from "../logging/logger.js";

const log = createLogger("session-lock");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueEntry {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface SessionLockState {
  /** Whether a message is currently being processed for this session */
  active: boolean;
  /** AbortController for the currently active processing */
  abortController: AbortController | null;
  /** Queue of waiting messages */
  queue: QueueEntry[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const locks = new Map<string, SessionLockState>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire a lock for a session. If the session is already being processed,
 * the returned promise will resolve only when the previous processing is done.
 *
 * Returns an AbortSignal that the processing loop should check — if the
 * session is aborted (e.g. via /stop), the signal will be triggered.
 *
 * Usage:
 * ```
 * const { signal, release } = await acquireSessionLock(sessionId);
 * try {
 *   // do work, checking signal.aborted periodically
 * } finally {
 *   release();
 * }
 * ```
 */
export async function acquireSessionLock(
  sessionId: string,
): Promise<{ signal: AbortSignal; release: () => void }> {
  let state = locks.get(sessionId);

  if (!state) {
    state = { active: false, abortController: null, queue: [] };
    locks.set(sessionId, state);
  }

  if (state.active) {
    // Wait in queue until the current processing is done
    log.info(`Session ${sessionId} is busy — queuing message`);
    await new Promise<void>((resolve, reject) => {
      state!.queue.push({ resolve, reject });
    });
  }

  // Now it's our turn
  state.active = true;
  const abortController = new AbortController();
  state.abortController = abortController;

  const release = () => {
    const s = locks.get(sessionId);
    if (!s) return;

    s.active = false;
    s.abortController = null;

    // Wake up the next in queue
    if (s.queue.length > 0) {
      const next = s.queue.shift()!;
      next.resolve();
    } else {
      // No one waiting — clean up
      locks.delete(sessionId);
    }
  };

  return { signal: abortController.signal, release };
}

/**
 * Abort a specific session's active processing.
 * The active processMessage will see its AbortSignal triggered.
 * Also rejects all queued waiters so they don't run.
 */
export function abortSession(sessionId: string): boolean {
  const state = locks.get(sessionId);
  if (!state) return false;

  // Abort the active processing
  if (state.abortController) {
    state.abortController.abort();
  }

  // Reject all queued entries
  for (const entry of state.queue) {
    entry.reject(new SessionAbortedError(sessionId));
  }
  state.queue = [];

  // Clean up — the release() call from the active processing will be a no-op
  // since we're removing the state here
  locks.delete(sessionId);

  log.info(`Session ${sessionId} aborted`);
  return true;
}

/**
 * Abort ALL active sessions. Returns the number of sessions aborted.
 */
export function abortAllSessions(): number {
  const sessionIds = [...locks.keys()];
  let count = 0;

  for (const sessionId of sessionIds) {
    if (abortSession(sessionId)) {
      count++;
    }
  }

  log.info(`Aborted ${count} active session(s)`);
  return count;
}

/**
 * Get the number of currently active (locked) sessions.
 */
export function getActiveSessionCount(): number {
  return locks.size;
}

/**
 * Get info about all active sessions (for debugging / status).
 */
export function getActiveSessionInfo(): Array<{
  sessionId: string;
  queueLength: number;
}> {
  const result: Array<{ sessionId: string; queueLength: number }> = [];
  for (const [sessionId, state] of locks) {
    if (state.active) {
      result.push({ sessionId, queueLength: state.queue.length });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SessionAbortedError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session ${sessionId} was aborted`);
    this.name = "SessionAbortedError";
    this.sessionId = sessionId;
  }
}
