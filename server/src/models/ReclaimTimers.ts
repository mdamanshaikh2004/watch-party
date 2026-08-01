const DEFAULT_WINDOW_MS = 45_000;

/**
 * Owns every pending reclaim deadline, so no handler has to keep its own Map.
 *
 * A dropped participant is held rather than removed, and something has to remove them
 * if they never come back. A lazy sweep cannot do it — nothing else need happen in a
 * quiet room — so this is the one place in the server that uses a timer.
 *
 * It exists as a shared dependency rather than a private field because more than one
 * handler ends a participant's window: they may reconnect, leave, or be removed by the
 * host. A handler that could not cancel would leave a timer holding a Room that
 * nothing else can reach.
 */
export class ReclaimTimers {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** Overridable so tests do not have to sleep out the real window. */
  constructor(
    readonly windowMs: number = Number(process.env.RECLAIM_WINDOW_MS) || DEFAULT_WINDOW_MS,
  ) {}

  /** Replaces any deadline already running for this participant. */
  schedule(participantId: string, onExpiry: () => void): void {
    this.cancel(participantId);

    const timer = setTimeout(() => {
      this.timers.delete(participantId);
      onExpiry();
    }, this.windowMs);

    // Never hold the process open just to expire somebody: without this a shutdown
    // would stall behind every pending window, and the smoke test would hang on exit.
    timer.unref?.();
    this.timers.set(participantId, timer);
  }

  /** Returns whether there was anything to cancel, which is useful in logs. */
  cancel(participantId: string): boolean {
    const timer = this.timers.get(participantId);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(participantId);
    return true;
  }

  /** For shutdown: stop waiting on people who will never reconnect to this process. */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  get pending(): number {
    return this.timers.size;
  }
}
