import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { throttle } from "../../utils/throttle";

describe("throttle utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the function immediately on first invocation", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("throttles subsequent calls within the delay", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a");
    throttled("b");
    throttled("c");

    // Only the first call should have executed immediately
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("sends trailing call after delay", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate
    throttled("b"); // scheduled as trailing

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("allows a new call after the delay has passed", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a");
    vi.advanceTimersByTime(100);
    throttled("b");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("replaces pending trailing call with latest args", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate
    throttled("b"); // scheduled
    throttled("c"); // replaces "b"

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("c");
  });

  it("can cancel a pending trailing call", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate
    throttled("b"); // trailing pending
    throttled.cancel();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("flush fires a pending trailing call immediately", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate
    throttled("b"); // queued as trailing

    // flush before the timer fires — should call fn("b") right now
    throttled.flush();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");

    // timer no longer pending — advancing time should not fire again
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("flush is a no-op when no trailing call is pending", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate, no pending trailing call
    throttled.flush();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush then cancel does not double-fire", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a"); // immediate
    throttled("b"); // trailing pending
    throttled.flush();  // fires "b" now
    throttled.cancel(); // nothing left to cancel

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });
});
