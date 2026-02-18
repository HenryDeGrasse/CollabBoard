import type { Intent } from "./router.js";
import type { RouteSource } from "./intentEngine.js";

interface RouteLatencySample {
  ts: number;
  source: RouteSource;
  intent: Intent;
  durationMs: number;
}

const MAX_SAMPLES = 2000;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const samples: RouteLatencySample[] = [];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function summarize(values: number[]) {
  if (values.length === 0) {
    return { count: 0, p50Ms: 0, p95Ms: 0, avgMs: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    p50Ms: Math.round(quantile(sorted, 0.5)),
    p95Ms: Math.round(quantile(sorted, 0.95)),
    avgMs: Math.round(avg),
  };
}

export function recordRouteLatency(sample: Omit<RouteLatencySample, "ts">) {
  samples.push({ ...sample, ts: Date.now() });
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

export function getRouteLatencyStats() {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = samples.filter((s) => s.ts >= cutoff);

  const bySource: Record<string, number[]> = {};
  const byIntent: Record<string, number[]> = {};

  for (const s of recent) {
    (bySource[s.source] ||= []).push(s.durationMs);
    (byIntent[s.intent] ||= []).push(s.durationMs);
  }

  const sourceStats: Record<string, ReturnType<typeof summarize>> = {};
  for (const [k, v] of Object.entries(bySource)) {
    sourceStats[k] = summarize(v);
  }

  const intentStats: Record<string, ReturnType<typeof summarize>> = {};
  for (const [k, v] of Object.entries(byIntent)) {
    intentStats[k] = summarize(v);
  }

  return {
    windowMinutes: WINDOW_MS / 60_000,
    sampleCount: recent.length,
    bySource: sourceStats,
    byIntent: intentStats,
  };
}
