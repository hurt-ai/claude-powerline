/**
 * The seven-day limit read as seven days: how much of today's seventh is gone, and how many days
 * of the norm are banked.
 *
 * Days are cut from the window, not from the calendar: day 0 opens at the window's start
 * (`resets_at` minus a week), so a reset always falls on a day boundary and seven norms add up to
 * the week exactly. A calendar day would leave a short first and last day whose norm is not a
 * seventh of anything.
 *
 * The API hands out the accumulated utilization of the window and nothing else, so what today has
 * spent needs a baseline kept between repaints. The baseline of a day is the last utilization seen
 * on the day before it; on the window's first day it is zero, since the window opened with it. A
 * first sight in the middle of a window has no morning to start from and counts today from that
 * sight rather than inventing one. The limit is shared by every client of the plan, so spending
 * from elsewhere before the first repaint of a day lands in the day before.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The API reports one window's reset as 23:00:00.203 on one call and 22:59:59.545 on the next.
 * Rounded to this grain, a window and its days keep one identity across calls; real windows are a
 * week apart, so no two of them can round together. */
const RESET_GRAIN_MS = 10 * 60 * 1000;
const WEEK_DAYS = 7;
const NORM_PCT = 100 / WEEK_DAYS;

export interface DayRecord {
  /** The window this record belongs to, as its rounded reset instant; a record from another window
   * is dropped, not reused. */
  resetsAt: string;
  /** Start of the window day the baseline was taken for, in epoch ms. */
  dayStart: number;
  /** Utilization of the window at the start of that day, as far as it could be known. */
  baseline: number;
  /** The last utilization seen, which becomes the next day's baseline. */
  lastUtil: number;
}

export interface DailyBudget {
  /** Today's spend as a percentage of the day's norm, a seventh of the week. */
  todayPct: number;
  /** Distance from the even burn line in days of the norm, capped at the days left. */
  reserveDays: number;
}

export function stepDay(
  utilization: number | null,
  resetsAt: string | null,
  prev: DayRecord | null,
  now: number
): { budget: DailyBudget | null; record: DayRecord | null } {
  const none = { budget: null, record: null };
  if (utilization === null || !resetsAt) return none;
  const reported = Date.parse(resetsAt);
  if (Number.isNaN(reported)) return none;
  const end = Math.round(reported / RESET_GRAIN_MS) * RESET_GRAIN_MS;
  const windowId = new Date(end).toISOString();
  const start = end - WEEK_DAYS * DAY_MS;
  if (now < start || now >= end) return none;

  const elapsedDays = (now - start) / DAY_MS;
  const dayIndex = Math.floor(elapsedDays);
  const dayStart = start + dayIndex * DAY_MS;

  const sameWindow = prev !== null && prev.resetsAt === windowId;
  let baseline: number;
  if (sameWindow && prev!.dayStart === dayStart) {
    baseline = prev!.baseline;
  } else if (sameWindow && prev!.dayStart < dayStart) {
    baseline = prev!.lastUtil;
  } else if (dayIndex === 0) {
    baseline = 0;
  } else {
    baseline = utilization;
  }

  const record: DayRecord = { resetsAt: windowId, dayStart, baseline, lastUtil: utilization };
  const todayPct = (Math.max(0, utilization - baseline) / NORM_PCT) * 100;
  const reserve = elapsedDays - utilization / NORM_PCT;
  const reserveDays = Math.min(reserve, WEEK_DAYS - elapsedDays);
  return { budget: { todayPct, reserveDays }, record };
}

export function formatDailyBudget(budget: DailyBudget): {
  today: string;
  reserve: string;
  todayOver: boolean;
  reserveOver: boolean;
} {
  const tenths = Math.round(budget.reserveDays * 10);
  const sign = tenths < 0 ? "-" : "+";
  return {
    today: `${Math.round(budget.todayPct)}%`,
    reserve: `${sign}${(Math.abs(tenths) / 10).toFixed(1)}d`,
    todayOver: budget.todayPct > 100,
    reserveOver: tenths < 0,
  };
}
