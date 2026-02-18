export type ThrottledFunction<T extends (...args: any[]) => void> =
  ((...args: Parameters<T>) => void) & {
    cancel: () => void;
    /** Fire any pending trailing call immediately instead of waiting for the timer. */
    flush: () => void;
  };

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): ThrottledFunction<T> {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      // Enough time has passed — fire immediately, clear any queued trailing call.
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      pendingArgs = null;
      lastCall = now;
      fn(...args);
      return;
    }

    // Schedule a trailing call so the last value is always sent.
    pendingArgs = args;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      lastCall = Date.now();
      timeoutId = null;
      const a = pendingArgs;
      pendingArgs = null;
      if (a) fn(...a);
    }, delay - timeSinceLastCall);
  }) as ThrottledFunction<T>;

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    pendingArgs = null;
  };

  /** Immediately fire any pending trailing call, then clear the timer. */
  throttled.flush = () => {
    if (timeoutId !== null && pendingArgs !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastCall = Date.now();
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
    }
  };

  return throttled;
}
