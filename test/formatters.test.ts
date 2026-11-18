import { formatLimitTime, formatTimeUntil } from "../src/utils/formatters";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const WINDOW_5H = 5 * HOUR;
const WINDOW_7D = 7 * 24 * HOUR;

/** An ISO instant for a window that ends `windowMs * (1 - elapsed)` from now. */
function resetsAtFor(elapsed: number, windowMs: number): string {
  return new Date(Date.now() + windowMs * (1 - elapsed)).toISOString();
}

describe("formatLimitTime", () => {
  it("always gives time until the window resets, even with a reserve", () => {
    // Half of a 5h window gone, 12% spent: no wall ahead, the reset is 2h30m away.
    expect(formatLimitTime(12, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBe("↻2h30");
  });

  it("adds time to the wall, marked with !, when the limit runs out before the reset", () => {
    // 55% spent in 30% of a 5h window: 1h13m of burn left, reset is 3h30m away.
    expect(formatLimitTime(55, resetsAtFor(0.3, WINDOW_5H), WINDOW_5H)).toBe("↻3h30 !1h13");
  });

  it("shows only the reset once the limit is nearly spent", () => {
    expect(formatLimitTime(94, resetsAtFor(0.7, WINDOW_5H), WINDOW_5H)).toBe("↻1h30");
  });

  it("counts a long wait in days, not in dozens of hours", () => {
    // 91% of the week spent, 62% of the window gone: 2d15h until it resets.
    expect(formatLimitTime(91, resetsAtFor(0.62, WINDOW_7D), WINDOW_7D)).toBe("↻2d15h");
  });

  it("gives the reset but no forecast while the window is too young", () => {
    // 9% spent in the first 8% of 5h: a forecast would be noise, the reset is 4h36m away.
    expect(formatLimitTime(9, resetsAtFor(0.08, WINDOW_5H), WINDOW_5H)).toBe("↻4h36");
  });

  it("gives the reset but no forecast at zero utilization", () => {
    expect(formatLimitTime(0, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBe("↻2h30");
  });

  // --- rejected input ---
  it("returns null without a utilization figure", () => {
    expect(formatLimitTime(null, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

  it("returns null without a reset instant", () => {
    expect(formatLimitTime(95, null, WINDOW_5H)).toBeNull();
  });

  it("returns null for a window that has already ended", () => {
    expect(formatLimitTime(95, resetsAtFor(1.2, WINDOW_5H), WINDOW_5H)).toBeNull();
  });
});

describe("formatTimeUntil", () => {
  it("counts a wait over a day in days and hours", () => {
    expect(formatTimeUntil(new Date(Date.now() + 56 * HOUR + 50 * MIN).toISOString())).toBe("2d8h");
  });

  it("keeps hours and minutes below a day", () => {
    expect(formatTimeUntil(new Date(Date.now() + 90 * MIN).toISOString())).toBe("1h30m");
  });

  it("drops the minutes when there are none", () => {
    expect(formatTimeUntil(new Date(Date.now() + 3 * HOUR + 1000).toISOString())).toBe("3h");
  });

  // --- rejected input ---
  it("returns null for an instant already past", () => {
    expect(formatTimeUntil(new Date(Date.now() - HOUR).toISOString())).toBeNull();
  });

  it("returns null for no instant at all", () => {
    expect(formatTimeUntil(null)).toBeNull();
  });
});
