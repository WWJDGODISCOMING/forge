// Delayed deletes with Undo: queue(id) holds the write for `ms`; undo(id) cancels it; flush() writes everything now
// (app hidden, navigating away). A second queue() while one is waiting writes the first one straight away.
// Pure (timers are injectable), so it is unit-tested.

export function createPendingDelete({ commit, ms = 4200, setT = setTimeout, clearT = clearTimeout }) {
  const timers = new Map();
  const write = (id) => {
    if (!timers.has(id)) return;
    clearT(timers.get(id));
    timers.delete(id);
    commit(id);
  };
  return {
    queue(id) {
      this.flush();
      timers.set(id, setT(() => write(id), ms));
    },
    /** true if it was still waiting (so the row can come back) */
    undo(id) {
      if (!timers.has(id)) return false;
      clearT(timers.get(id));
      timers.delete(id);
      return true;
    },
    flush() { for (const id of [...timers.keys()]) write(id); },
    has: (id) => timers.has(id),
    get size() { return timers.size; },
  };
}
