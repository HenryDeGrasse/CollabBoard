export type ThrottledFunction<T extends (...args: any[]) => void> =
  ((...args: Parameters<T>) => void) & {
    cancel: () => void;
  };

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): ThrottledFunction<T> {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn(...args);
      return;
    }

    // Schedule a trailing call so the last value is always sent
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      lastCall = Date.now();
      timeoutId = null;
      fn(...args);
    }, delay - timeSinceLastCall);
  }) as ThrottledFunction<T>;

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return throttled;
}
