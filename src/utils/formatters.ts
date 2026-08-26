interface TokenBreakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number | null): string {
  if (tokens === null) return "0 tokens";
  if (tokens === 0) return "0 tokens";
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
}

export function formatTokenBreakdown(breakdown: TokenBreakdown | null): string {
  if (!breakdown) return "0 tokens";

  const parts: string[] = [];

  if (breakdown.input > 0) {
    parts.push(`${formatTokens(breakdown.input).replace(" tokens", "")}in`);
  }

  if (breakdown.output > 0) {
    parts.push(`${formatTokens(breakdown.output).replace(" tokens", "")}out`);
  }

  if (breakdown.cacheCreation > 0 || breakdown.cacheRead > 0) {
    const totalCached = breakdown.cacheCreation + breakdown.cacheRead;
    parts.push(`${formatTokens(totalCached).replace(" tokens", "")}cached`);
  }

  return parts.length > 0 ? parts.join(" + ") : "0 tokens";
}

export function formatTimeSince(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  } else if (seconds < 3600) {
    return `${(seconds / 60).toFixed(0)}m`;
  } else if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)}h`;
  } else {
    return `${(seconds / 86400).toFixed(1)}d`;
  }
}

export function formatTimeUntil(isoDate: string | null): string | null {
  if (!isoDate) return null;

  try {
    const target = new Date(isoDate);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();

    if (diffMs <= 0) return null;

    const diffMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours > 0) {
      return `${hours}h${minutes > 0 ? minutes + "m" : ""}`;
    }
    return `${minutes}m`;
  } catch {
    return null;
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Below this much of the window elapsed, the pace figure is noise: an hour of heavy work early
 * on projects to several hundred per cent and means nothing by evening. */
const PACE_MIN_ELAPSED = 0.15;

/**
 * How the week is going, not just how much of it is gone.
 *
 * `delta` is the gap between the even burn line (the integral of the allowed constant rate) and
 * what was actually spent, in percentage points: positive means a reserve was built up, negative
 * means the week is being overspent. It is the number the night budget is drawn from, so it
 * belongs on screen next to the raw percentage rather than only inside the gate.
 *
 * Needs no stored history: both terms come from the same API answer and describe the same window.
 */
export function formatWeekPace(
  utilization: number | null,
  resetsAt: string | null
): string | null {
  if (utilization === null || !resetsAt) return null;

  try {
    const end = new Date(resetsAt).getTime();
    if (Number.isNaN(end)) return null;
    const start = end - WEEK_MS;
    const elapsed = (Date.now() - start) / WEEK_MS;
    if (elapsed <= 0 || elapsed > 1) return null;

    const delta = 100 * elapsed - utilization;
    const rounded = Math.round(delta);
    const sign = rounded > 0 ? "+" : "";
    // Early in the window the arrow would be pure noise, so only the gap is shown.
    if (elapsed < PACE_MIN_ELAPSED) return `${sign}${rounded}`;
    return `${sign}${rounded}${delta < 0 ? "↑" : "↓"}`;
  } catch {
    return null;
  }
}
