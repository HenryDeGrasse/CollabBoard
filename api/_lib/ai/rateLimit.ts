/**
 * In-memory sliding-window rate limiter for the AI endpoint.
 *
 * Limits requests per user to prevent runaway usage. State lives in memory
 * so it resets on cold starts — acceptable for serverless where the goal is
 * preventing abuse within a single instance lifetime, not hard quotas.
 *
 * Environment variables:
 *   AI_RATE_LIMIT_MAX      — Max requests per window (default: 20)
 *   AI_RATE_LIMIT_WINDOW_S — Window size in seconds (default: 60)
 */

const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_WINDOW_SECONDS = 60;

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

/** Periodically evict stale entries so the Map doesn't grow unbounded. */
const GC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let gcTimer: ReturnType<typeof setInterval> | null = null;

function ensureGC() {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    const windowMs = getWindowMs();
    for (const [key, entry] of windows) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) windows.delete(key);
    }
  }, GC_INTERVAL_MS);
  // Don't block process exit in serverless
  if (gcTimer && typeof gcTimer === "object" && "unref" in gcTimer) {
    gcTimer.unref();
  }
}

function getMaxRequests(): number {
  const envVal = parseInt(process.env.AI_RATE_LIMIT_MAX ?? "", 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_MAX_REQUESTS;
}

function getWindowMs(): number {
  const envVal = parseInt(process.env.AI_RATE_LIMIT_WINDOW_S ?? "", 10);
  const seconds = Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_WINDOW_SECONDS;
  return seconds * 1000;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Seconds until the oldest request in the window expires. */
  retryAfterSeconds: number;
}

/**
 * Check and consume a rate-limit slot for the given user.
 *
 * Returns `{ allowed: true }` if the request should proceed, or
 * `{ allowed: false, retryAfterSeconds }` if the user has exceeded the limit.
 */
export function checkRateLimit(userId: string): RateLimitResult {
  ensureGC();

  const now = Date.now();
  const maxRequests = getMaxRequests();
  const windowMs = getWindowMs();

  let entry = windows.get(userId);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(userId, entry);
  }

  // Slide window: remove expired entries
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = windowMs - (now - oldest);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  // Consume a slot
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterSeconds: 0,
  };
}

/** Reset all rate limit state (for testing). */
export function resetRateLimits(): void {
  windows.clear();
}
