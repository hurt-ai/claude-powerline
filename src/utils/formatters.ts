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

/**
 * A span in the largest unit that still reads at a glance.
 *
 * Above a day the hour count stops being legible: `56h50m` has to be divided in the head before
 * it means anything, while `2d8h` is read. Minutes are dropped there for the same reason — at
 * that distance they are noise, not precision.
 */
function formatSpan(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (24 * 60));
  if (days > 0) {
    const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
    return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes) % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatTimeUntil(isoDate: string | null): string | null {
  if (!isoDate) return null;

  try {
    const target = new Date(isoDate);
    const diffMs = target.getTime() - Date.now();
    if (Number.isNaN(diffMs) || diffMs <= 0) return null;
    return formatSpan(diffMs / 60000);
  } catch {
    return null;
  }
}

/** Below this much of the window elapsed, a forecast is noise: an hour of heavy work early on
 * projects a wall within minutes that by evening never came. */
const FORECAST_MIN_ELAPSED = 0.15;

/** Past this much of the limit, the wall is already here and only the wait for the reset matters. */
const EXHAUSTED_PCT = 90;

/** A limit span: `3h50`, `4h`, `2d15h` — minutes keep no `m`, the `h` before them says what they are. */
function formatLimitSpan(totalMinutes: number): string {
  return formatSpan(totalMinutes).replace(/h(\d+)m$/, "h$1");
}

/**
 * When the window resets, and — only if the current burn gets there first — when the limit runs out.
 *
 * `↻<span>` is printed for every window: without the reset there is nothing to weigh the wall
 * against, and "how long until it refills" is what a person reading the line actually asks.
 * `!<span>` follows it when, at the AVERAGE rate since the window opened, the limit is gone before
 * the reset; the API gives an accumulated percentage and nothing else, so a recent burst shows up
 * damped. No forecast early in the window, at zero spend, or once the limit is nearly spent.
 */
export function formatLimitTime(
  utilization: number | null,
  resetsAt: string | null,
  windowMs: number
): string | null {
  if (utilization === null || !resetsAt) return null;

  try {
    const end = new Date(resetsAt).getTime();
    if (Number.isNaN(end)) return null;
    const untilResetMs = end - Date.now();
    if (untilResetMs <= 0) return null;

    const elapsed = (windowMs - untilResetMs) / windowMs;
    if (elapsed <= 0 || elapsed > 1) return null;

    const reset = `↻${formatLimitSpan(untilResetMs / 60000)}`;
    if (
      utilization >= EXHAUSTED_PCT ||
      utilization <= 0 ||
      elapsed < FORECAST_MIN_ELAPSED
    ) {
      return reset;
    }

    const untilWall = elapsed * ((100 - utilization) / utilization);
    if (untilWall >= 1 - elapsed) return reset;

    return `${reset} !${formatLimitSpan((untilWall * windowMs) / 60000)}`;
  } catch {
    return null;
  }
}
