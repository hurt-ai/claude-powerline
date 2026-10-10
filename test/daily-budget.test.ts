import { stepDay, formatDailyBudget, DayRecord } from "../src/utils/daily-budget";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** A week window that opened at `start`; `at(d)` is `d` days into it. */
const start = Date.parse("2026-10-07T23:00:00Z");
const resetsAt = new Date(start + WEEK).toISOString();
const at = (days: number) => start + days * DAY;

describe("stepDay: what today has spent, as a share of a seventh of the week", () => {
  it("counts the first day of a window from zero, since the window opened with it", () => {
    // 5% of the week by midday of day 0: 5 / (100/7) = 35% of the day's norm.
    const { budget } = stepDay(5, resetsAt, null, at(0.5));
    expect(Math.round(budget!.todayPct)).toBe(35);
  });

  it("keeps the morning's baseline for the rest of the same day", () => {
    const first = stepDay(10, resetsAt, null, at(0.2));
    const later = stepDay(20, resetsAt, first.record, at(0.9));
    // Day 0 started at zero, so all 20 points are today's: 140% of the norm.
    expect(Math.round(later.budget!.todayPct)).toBe(140);
  });

  it("starts the next day from the last value seen the day before", () => {
    const yesterday = stepDay(12, resetsAt, null, at(0.95));
    const today = stepDay(15, resetsAt, yesterday.record, at(1.1));
    // 3 points since the last sight yesterday: 3 / (100/7) = 21%.
    expect(Math.round(today.budget!.todayPct)).toBe(21);
  });

  it("does not invent a morning it never saw: a first sight mid-week counts today from now", () => {
    const { budget } = stepDay(40, resetsAt, null, at(3.4));
    expect(budget!.todayPct).toBe(0);
  });

  it("drops a record left from another window instead of subtracting across a reset", () => {
    const old: DayRecord = {
      resetsAt: new Date(start).toISOString(),
      dayStart: start - DAY,
      baseline: 80,
      lastUtil: 95,
    };
    const { budget } = stepDay(3, resetsAt, old, at(0.1));
    expect(Math.round(budget!.todayPct)).toBe(21);
  });

  it("treats a reset instant that drifts by a second as the same window and the same day", () => {
    // The API reports 23:00:00.203 on one call and 22:59:59.545 on the next for one window.
    const drifted = new Date(start + WEEK - 658).toISOString();
    const first = stepDay(10, resetsAt, null, at(2.2));
    const later = stepDay(17, drifted, first.record, at(2.6));
    // Baseline kept from the morning (10): 7 points today, 49% of the norm.
    expect(Math.round(later.budget!.todayPct)).toBe(49);
  });

  it("never reports a negative spend when the API answers with a lower number", () => {
    const first = stepDay(20, resetsAt, null, at(2.0));
    const { budget } = stepDay(19, resetsAt, first.record, at(2.3));
    expect(budget!.todayPct).toBe(0);
  });
});

describe("stepDay: the reserve, in days of the norm", () => {
  it("shows two idle days as two days of reserve", () => {
    const { budget } = stepDay(0, resetsAt, null, at(2.0));
    expect(budget!.reserveDays).toBeCloseTo(2.0, 5);
  });

  it("goes negative when the week is spent faster than the even line", () => {
    // Two days in, half the week gone: 2 - 50 * 7 / 100 = -1.5 days.
    const { budget } = stepDay(50, resetsAt, null, at(2.0));
    expect(budget!.reserveDays).toBeCloseTo(-1.5, 5);
  });

  it("caps the reserve at the days left, since what is unspent at the reset is lost", () => {
    const { budget } = stepDay(0, resetsAt, null, at(6.5));
    expect(budget!.reserveDays).toBeCloseTo(0.5, 5);
  });
});

describe("stepDay: nothing to say", () => {
  it("returns no budget without a utilization", () => {
    expect(stepDay(null, resetsAt, null, at(1)).budget).toBeNull();
  });

  it("returns no budget without a reset instant, or with one it cannot read", () => {
    expect(stepDay(10, null, null, at(1)).budget).toBeNull();
    expect(stepDay(10, "not-a-date", null, at(1)).budget).toBeNull();
  });

  it("returns no budget outside the window the reset instant describes", () => {
    expect(stepDay(10, resetsAt, null, at(7.2)).budget).toBeNull();
  });
});

describe("formatDailyBudget", () => {
  it("prints the day's share as a whole percent and the reserve with one decimal", () => {
    expect(formatDailyBudget({ todayPct: 63.4, reserveDays: 2.04 })).toEqual({
      today: "63%",
      reserve: "+2.0d",
      todayOver: false,
      reserveOver: false,
    });
  });

  it("marks an overspent day and a negative reserve as over", () => {
    expect(formatDailyBudget({ todayPct: 180, reserveDays: -1.26 })).toEqual({
      today: "180%",
      reserve: "-1.3d",
      todayOver: true,
      reserveOver: true,
    });
  });

  it("prints a reserve that rounds to zero without a minus sign", () => {
    expect(formatDailyBudget({ todayPct: 100, reserveDays: -0.04 }).reserve).toBe("+0.0d");
    expect(formatDailyBudget({ todayPct: 100, reserveDays: -0.04 }).reserveOver).toBe(false);
  });
});

import { SegmentRenderer } from "../src/segments/renderer";

describe("the daily budget in the rate-limit segment", () => {
  const symbols = { rate_limit_5h: "5h", rate_limit_7d: "7d", rate_limit_day: "day" } as any;
  // Truecolor forced, so the colour is in the text and can be read back as its RGB triple.
  const renderer = new SegmentRenderer({ display: { colorCompatibility: "truecolor" } } as any, symbols);
  const colors = { rateLimitBg: "", rateLimitFg: "<fg>", rateLimitBgHex: "#2d2d2d" } as any;
  const info = (todayPct: number, reserveDays: number) => ({
    session: null, sessionResetsAt: null, week: null, weekResetsAt: null,
    weekSonnet: null, weekSonnetResetsAt: null, daily: { todayPct, reserveDays },
  });
  const dayText = (segs: Array<{ text: string }>) => segs.map((s) => s.text).join(" | ");
  const WARN_ON_DARK = "240;136;62"; // #f0883e
  const UNDER_ON_DARK = "166;227;161"; // #a6e3a1

  it("is absent unless asked for", () => {
    const segs = renderer.renderRateLimit(info(63, 2), colors, { enabled: true } as any);
    expect(dayText(segs)).not.toContain("day");
  });

  it("shows today's share and the reserve when asked", () => {
    const segs = renderer.renderRateLimit(info(63, 2.04), colors, { enabled: true, showDailyBudget: true } as any);
    expect(dayText(segs)).toContain("63%");
    expect(dayText(segs)).toContain("+2.0d");
  });

  it("paints an overspent day and a negative reserve in the warning colour", () => {
    const text = dayText(renderer.renderRateLimit(info(180, -1.3), colors, { enabled: true, showDailyBudget: true } as any));
    expect(text).toContain(`${WARN_ON_DARK}m180%`);
    expect(text).toContain(`${WARN_ON_DARK}m-1.3d`);
  });

  it("keeps a day within the norm in the segment colour and a reserve in green", () => {
    const text = dayText(renderer.renderRateLimit(info(63, 2), colors, { enabled: true, showDailyBudget: true } as any));
    expect(text).not.toContain(`${WARN_ON_DARK}m63%`);
    expect(text).toContain(`${UNDER_ON_DARK}m+2.0d`);
  });
});
