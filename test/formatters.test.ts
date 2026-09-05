import { formatPace, formatLimitTime, formatTimeUntil } from "../src/utils/formatters";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const WINDOW_5H = 5 * HOUR;
const WINDOW_7D = 7 * 24 * HOUR;

/** An ISO instant for a window that ends `windowMs * (1 - elapsed)` from now. */
function resetsAtFor(elapsed: number, windowMs: number): string {
  return new Date(Date.now() + windowMs * (1 - elapsed)).toISOString();
}

describe("formatPace", () => {
  it("reads the window it is given, not a hardcoded week", () => {
    // 30% of a 5h window gone, 10% of the limit spent: 20 points of reserve.
    expect(formatPace(10, resetsAtFor(0.3, WINDOW_5H), WINDOW_5H)).toBe("+20↓");
  });

  it("marks overspending with an up arrow and no plus sign", () => {
    expect(formatPace(55, resetsAtFor(0.3, WINDOW_5H), WINDOW_5H)).toBe("-25↑");
  });

  it("says nothing while the window is too young to judge", () => {
    expect(formatPace(2, resetsAtFor(0.08, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

  it("works the same on a seven-day window", () => {
    expect(formatPace(6, resetsAtFor(0.55, WINDOW_7D), WINDOW_7D)).toBe("+49↓");
  });

  // --- rejected input ---
  it("returns null without a utilization figure", () => {
    expect(formatPace(null, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

  it("returns null without a reset instant", () => {
    expect(formatPace(30, null, WINDOW_5H)).toBeNull();
  });

  it("returns null when the reset instant is unparseable", () => {
    expect(formatPace(30, "not-a-date", WINDOW_5H)).toBeNull();
  });

  it("returns null for a window that has already ended", () => {
    expect(formatPace(30, resetsAtFor(1.2, WINDOW_5H), WINDOW_5H)).toBeNull();
  });
});

describe("formatLimitTime", () => {
  it("says nothing while there is a reserve", () => {
    // Half the window gone, 12% spent: the limit outlasts the window.
    expect(formatLimitTime(12, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

  it("gives time to the wall, marked with !, when the limit runs out first", () => {
    // 55% spent in 30% of a 5h window: 1h13m of burn left, reset is 3h30m away.
    expect(formatLimitTime(55, resetsAtFor(0.3, WINDOW_5H), WINDOW_5H)).toBe("!1h13m");
  });

  it("switches to time until reset, in brackets, once the limit is nearly spent", () => {
    expect(formatLimitTime(94, resetsAtFor(0.7, WINDOW_5H), WINDOW_5H)).toBe("(1h30m)");
  });

  it("counts a long wait in days, not in dozens of hours", () => {
    // 91% of the week spent, 62% of the window gone: 2d15h until it resets.
    expect(formatLimitTime(91, resetsAtFor(0.62, WINDOW_7D), WINDOW_7D)).toBe("(2d15h)");
  });

  it("says nothing while the window is too young to forecast from", () => {
    expect(formatLimitTime(9, resetsAtFor(0.08, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

  // --- rejected input ---
  it("returns null on zero utilization, which forecasts nothing", () => {
    expect(formatLimitTime(0, resetsAtFor(0.5, WINDOW_5H), WINDOW_5H)).toBeNull();
  });

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
