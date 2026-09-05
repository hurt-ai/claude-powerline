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

/** Below this much of the window elapsed, the pace figure is noise: an hour of heavy work early
 * on projects to several hundred per cent and means nothing by evening. */
const PACE_MIN_ELAPSED = 0.15;

/**
 * How the window is going, not just how much of it is gone. Same shape for either window: the
 * five-hour limit and the seven-day one differ by their length and nothing else.
 *
 * `delta` is the gap between the even burn line (the integral of the allowed constant rate) and
 * what was actually spent, in percentage points: positive means a reserve was built up, negative
 * means the week is being overspent. It is the number the night budget is drawn from, so it
 * belongs on screen next to the raw percentage rather than only inside the gate.
 *
 * Needs no stored history: both terms come from the same API answer and describe the same window.
 */
export function formatPace(
  utilization: number | null,
  resetsAt: string | null,
  windowMs: number
): string | null {
  if (utilization === null || !resetsAt) return null;

  try {
    const end = new Date(resetsAt).getTime();
    if (Number.isNaN(end)) return null;
    const start = end - windowMs;
    const elapsed = (Date.now() - start) / windowMs;
    if (elapsed <= 0 || elapsed > 1) return null;

    const delta = 100 * elapsed - utilization;
    const rounded = Math.round(delta);
    const sign = rounded > 0 ? "+" : "";
    // Early in the window the figure is noise, and a bare number with no arrow reads as a broken
    // segment rather than as "no pace yet". Nothing at all is the honest rendering.
    if (elapsed < PACE_MIN_ELAPSED) return null;
    return `${sign}${rounded}${delta < 0 ? "↑" : "↓"}`;
  } catch {
    return null;
  }
}


/** Past this much of the limit, a forecast is beside the point: what is wanted is how long the
 * wait is, not when the wall arrives. */
const EXHAUSTED_PCT = 90;

/**
 * The one figure that answers "should I slow down", and it is deliberately absent most of the time.
 *
 * Time until reset used to be printed always, which put a permanent counter on the line that
 * changes no decision: at 6% of a week spent, seventy-five hours is a fact about the calendar.
 * The question a rate limit actually raises is whether the CURRENT burn outlasts the window, and
 * that is a comparison of two instants — when the limit runs out at this rate, and when it resets.
 *
 * So three states, and each prints what that state makes actionable:
 *   - nearly spent (>= EXHAUSTED_PCT) -> time until reset, in brackets: how long to sit it out.
 *   - burning too fast -> time until the wall, marked `!`: slow down now, and by how much notice.
 *   - a reserve -> nothing at all. There is no decision to take, so the line stays short.
 *
 * The rate is the AVERAGE since the window opened, because the API hands out an accumulated
 * percentage and nothing else; a burst in the last hour therefore shows up damped. Reading it as
 * "if it goes on as it has gone" is exactly right and no more than that.
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

    if (utilization >= EXHAUSTED_PCT) {
      return `(${formatSpan(untilResetMs / 60000)})`;
    }

    // Too early to forecast from, and too early is not the same as "no wall ahead".
    if (elapsed < PACE_MIN_ELAPSED || utilization <= 0) return null;

    // At the average rate so far, this much of the window is left before the limit is gone.
    const untilWall = elapsed * ((100 - utilization) / utilization);
    if (untilWall >= 1 - elapsed) return null;

    return `!${formatSpan((untilWall * windowMs) / 60000)}`;
  } catch {
    return null;
  }
}
