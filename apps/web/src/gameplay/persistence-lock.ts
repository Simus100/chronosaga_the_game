/**
 * One operation at a time, between persistence and the world.
 *
 * Save and load are asynchronous; choices and ticks are not. Without a lock the
 * two overlap in ways that are silent and expensive:
 *
 *   a save reads S1 → the player takes a turn producing S2 → the write of S1
 *   completes → the screen reports "saved" while the disk holds the older world
 *
 *   a load starts → the player takes a turn → the load completes and replaces
 *   the session → the turn that was played disappears without a message
 *
 * Both are the same defect: an authoritative action ran while an I/O operation
 * was in flight. So the fix is not to reconcile the two afterwards — it is to
 * make the overlap impossible, which also means there is no stale result to
 * detect, because the situation that produces one cannot occur.
 *
 * The flag is set synchronously before the first `await`, so a second event
 * dispatched before React's next render still sees it. A disabled button is a
 * courtesy to the player; this is what actually holds.
 */

/** What happened when work was offered to the lock. */
export type LockedRun<T> = { readonly ran: true; readonly result: T } | { readonly ran: false };

export interface PersistenceLock {
  /** True while a save or load is in flight. */
  readonly busy: boolean;
  /** Run an exclusive asynchronous operation, or refuse if one is running. */
  exclusive<T>(operation: () => Promise<T>): Promise<LockedRun<T>>;
  /** Run an authoritative action, unless persistence currently holds the lock. */
  protect<T>(action: () => T): LockedRun<T>;
}

/**
 * `onBusyChange` exists so the UI can reflect the lock without owning it. It is
 * notified, not consulted: the lock is authoritative whether or not anything
 * has re-rendered yet.
 */
export function createPersistenceLock(onBusyChange?: (busy: boolean) => void): PersistenceLock {
  let busy = false;

  const set = (next: boolean) => {
    busy = next;
    onBusyChange?.(next);
  };

  return {
    get busy() {
      return busy;
    },

    async exclusive<T>(operation: () => Promise<T>): Promise<LockedRun<T>> {
      if (busy) return { ran: false };
      set(true);
      try {
        return { ran: true, result: await operation() };
      } finally {
        // Every ending releases: success, a rejected save, a corrupted load, a
        // transport failure, an exception nobody predicted. A lock that leaks
        // on an unexpected path leaves the game permanently unplayable, which
        // is a worse failure than the race it was added to prevent.
        set(false);
      }
    },

    protect<T>(action: () => T): LockedRun<T> {
      if (busy) return { ran: false };
      return { ran: true, result: action() };
    }
  };
}
