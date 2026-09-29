const STORAGE_KEY = 'felt-theory-action-timer';

export function normalizeTimer(value) {
  return {
    enabled: value?.enabled === true,
    seconds: Number.isInteger(value?.seconds) && value.seconds >= 5 && value.seconds <= 300
      ? value.seconds : 30,
  };
}

export function loadTimer(storage) {
  try { return normalizeTimer(JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return normalizeTimer(null); }
}

export function saveTimer(value) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalizeTimer(value))); }
  catch { /* The timer remains usable without storage. */ }
}

/** Keep a deadline across UI renders, with one expiry per player decision. */
export function createActionTimer(onTick, onExpire, {
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let key = null;
  let seconds = null;
  let deadline = null;
  let handle = null;
  let generation = 0;

  function stop() {
    generation++;
    if (handle !== null) cancel(handle);
    handle = null;
    key = null;
    seconds = null;
    deadline = null;
  }

  function tick() {
    handle = null;
    const remaining = Math.max(0, Math.ceil((deadline - now()) / 1000));
    onTick(remaining);
    if (remaining === 0) {
      deadline = null;
      onExpire();
    } else {
      const current = generation;
      handle = schedule(() => { if (current === generation) tick(); }, Math.min(250, deadline - now()));
    }
  }

  return {
    sync(nextKey, duration) {
      if (nextKey === null) { stop(); onTick(null); return; }
      if (key === nextKey && seconds === duration) {
        onTick(deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now()) / 1000)));
        return;
      }
      stop();
      key = nextKey;
      seconds = duration;
      deadline = now() + duration * 1000;
      tick();
    },
    stop,
  };
}
