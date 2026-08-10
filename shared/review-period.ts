/**
 * Single source of truth for the review-email date window.
 *
 * This used to live only inside server/scheduler.ts, with the dashboard's
 * "Reviews Covered" preview re-implementing it by hand. The preview's day arithmetic
 * was actually right, but it ignored lookbackOffset and formatted in the browser's
 * local timezone rather than Phoenix, so a "prior period" group or a non-Arizona
 * viewer saw a range that didn't match the email. Both sides now import from here so
 * the range a user is shown is exactly the range that gets sent.
 *
 * All boundaries are Phoenix midnight (UTC-7, fixed, no DST), matching the rest
 * of the scheduling code. Note there is no per-location timezone in this app: a
 * group spanning multiple zones gets one Phoenix-midnight boundary for everyone.
 */

/** UTC-7 in ms. Phoenix does not observe DST, so a fixed offset is correct year-round. */
export const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** How a group's review window is derived. Stored in review_email_groups.period_mode. */
export type ReviewPeriodMode = "rolling" | "last_calendar_month";

export interface ReviewPeriodConfig {
  periodMode?: string | null;
  lookbackDays?: number | null;
  lookbackOffset?: number | null;
}

/**
 * The computed window. `start` is inclusive, `end` is EXCLUSIVE — a review is in
 * the window when `start <= reviewDate < end`. Callers that want to display the
 * window must show `end - 1 day` as the last covered day (see formatReviewPeriodRange).
 */
export interface ReviewPeriod {
  start: Date;
  end: Date;
  /** Phoenix midnight of the day the window was computed against. */
  today: Date;
  mode: ReviewPeriodMode;
}

/** Normalizes whatever is in the DB to a known mode, defaulting to the legacy behavior. */
export function resolvePeriodMode(periodMode?: string | null): ReviewPeriodMode {
  return periodMode === "last_calendar_month" ? "last_calendar_month" : "rolling";
}

/** True when the mode derives its own boundaries and ignores lookbackDays/lookbackOffset. */
export function isCalendarPeriodMode(periodMode?: string | null): boolean {
  return resolvePeriodMode(periodMode) !== "rolling";
}

/** Phoenix midnight at or before `atMs`, expressed as a UTC instant. */
function phoenixMidnightMs(atMs: number): number {
  return Math.floor((atMs - PHOENIX_OFFSET_MS) / 86400000) * 86400000;
}

/** Phoenix wall-clock (Y, monthIdx, day, 00:00) as a UTC instant. */
function phoenixDayStartMs(y: number, monthIdx: number, day: number): number {
  return Date.UTC(y, monthIdx, day, 0, 0, 0, 0) + PHOENIX_OFFSET_MS;
}

/**
 * Compute the review window for a group.
 *
 * `atMs` should be the instant the window is anchored to. For a scheduled send that
 * is the occurrence's due time, NOT Date.now(): a retry or a startup catch-up can run
 * hours after the occurrence, and for a calendar-month window that drifts across a
 * month boundary it would otherwise email the wrong month entirely.
 *
 * - "rolling": end = Phoenix midnight today (so today's reviews are excluded),
 *   start = lookbackDays before that, both shifted back by lookbackOffset days.
 * - "last_calendar_month": the whole previous calendar month — start = the 1st at
 *   00:00, end = the 1st of the current month at 00:00. lookbackDays and
 *   lookbackOffset are ignored. A review left at 11pm on the last day of the month
 *   is included; nothing from the current month is.
 */
export function computeReviewPeriod(group: ReviewPeriodConfig, atMs: number = Date.now()): ReviewPeriod {
  const mode = resolvePeriodMode(group.periodMode);
  const midnightMs = phoenixMidnightMs(atMs);
  const today = new Date(midnightMs + PHOENIX_OFFSET_MS);

  if (mode === "last_calendar_month") {
    // Read the Phoenix calendar date, not the UTC one — at 5pm Phoenix on the 31st
    // it is already the 1st in UTC, which would pick the wrong month.
    const p = new Date(midnightMs);
    const y = p.getUTCFullYear();
    const m = p.getUTCMonth();
    // Date.UTC normalizes month -1 into the previous year, so January works.
    return {
      start: new Date(phoenixDayStartMs(y, m - 1, 1)),
      end: new Date(phoenixDayStartMs(y, m, 1)),
      today,
      mode,
    };
  }

  const lookbackDays = group.lookbackDays || 7;
  const lookbackOffset = group.lookbackOffset || 0;
  const offsetMs = lookbackOffset * 86400000;
  return {
    start: new Date(midnightMs - offsetMs - lookbackDays * 86400000 + PHOENIX_OFFSET_MS),
    end: new Date(midnightMs - offsetMs + PHOENIX_OFFSET_MS),
    today,
    mode,
  };
}

/**
 * Human-readable range for email subjects, bodies and sheet filenames.
 * `end` is exclusive, so the last covered day is end - 1.
 */
export function formatReviewPeriodRange(period: Pick<ReviewPeriod, "start" | "end">): string {
  const lastDay = new Date(period.end.getTime() - 86400000);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "America/Phoenix" };
  const start = period.start.toLocaleDateString("en-US", opts);
  const end = lastDay.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${start} – ${end}`;
}

/** e.g. "July 2026" — used when describing a calendar-month window in prose. */
export function formatCalendarMonthLabel(period: Pick<ReviewPeriod, "start">): string {
  return period.start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/Phoenix",
  });
}

/** One-line description of what a group covers, for prose in email bodies. */
export function describeReviewPeriod(group: ReviewPeriodConfig, period: ReviewPeriod): string {
  if (period.mode === "last_calendar_month") {
    return `for ${formatCalendarMonthLabel(period)}`;
  }
  const lookbackDays = group.lookbackDays || 7;
  const lookbackOffset = group.lookbackOffset || 0;
  return `for the past ${lookbackDays} days${lookbackOffset > 0 ? ` (${lookbackOffset}–${lookbackOffset + lookbackDays} days ago)` : ""}`;
}

/** Short label matching the settings dropdown, for summaries in the UI. */
export function shortPeriodLabel(group: ReviewPeriodConfig): string {
  if (isCalendarPeriodMode(group.periodMode)) return "Last month";
  const lookbackDays = group.lookbackDays || 7;
  return (group.lookbackOffset || 0) > 0 ? `Prior ${lookbackDays} days` : `Last ${lookbackDays} days`;
}

// ---------------------------------------------------------------------------
// Send-occurrence math
//
// Also shared, and for the same reason. The scheduler decides when a group is due;
// the dashboard predicts the next send to preview it. Those were separate
// implementations and the dashboard's had no monthly branch at all — it always
// advanced to the next emailDay weekday, so a monthly group was previewed with both
// the wrong send date and (once periods became named calendar months) the wrong month.
// Both now derive from the functions below.
// ---------------------------------------------------------------------------

export interface ReviewScheduleConfig {
  frequency?: string | null;
  /** YYYY-MM-DD in Phoenix time. The anchor for every cadence. */
  startDate?: string | null;
  /** Day-of-week fallback for legacy groups created before startDate existed. */
  emailDay?: string | null;
  emailTime?: string | null;
}

/** Convert a Phoenix wall-clock (Y, monthIdx, day, hh, mm) to a UTC epoch ms. */
export function phoenixWallToUtcMs(y: number, monthIdx: number, day: number, hh: number, mm: number): number {
  return Date.UTC(y, monthIdx, day, hh, mm, 0, 0) + PHOENIX_OFFSET_MS;
}

/** Most recent Phoenix weekday (0=Sun..6=Sat) at hh:mm that is <= nowMs. Only used as a
 *  fallback anchor for legacy groups created before startDate existed. */
function mostRecentWeekdayMs(nowMs: number, weekday: number, hh: number, mm: number): number {
  const p = new Date(nowMs - PHOENIX_OFFSET_MS);
  for (let back = 0; back < 8; back++) {
    const candUtc = phoenixWallToUtcMs(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() - back, hh, mm);
    const dow = new Date(candUtc - PHOENIX_OFFSET_MS).getUTCDay();
    if (dow === weekday && candUtc <= nowMs) return candUtc;
  }
  return phoenixWallToUtcMs(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), hh, mm);
}

/** The k-th monthly occurrence after the start month, clamped to the month's length
 *  (e.g. a Jan 31 anchor lands on Feb 28). */
function monthlyOccurrenceMs(startY: number, startMonthIdx: number, startDay: number, k: number, hh: number, mm: number): number {
  const total = startMonthIdx + k;
  const y = startY + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return phoenixWallToUtcMs(y, m, Math.min(startDay, daysInMonth), hh, mm);
}

/** Resolved anchor: the first-ever send instant plus its Phoenix calendar parts. */
function scheduleAnchor(group: ReviewScheduleConfig, nowMs: number) {
  const [hhS, mmS] = (group.emailTime || "09:00").split(":");
  const hh = parseInt(hhS) || 0;
  const mm = parseInt(mmS) || 0;

  if (group.startDate) {
    const [y, mo, d] = group.startDate.split("-").map(Number);
    return { hh, mm, firstSendMs: phoenixWallToUtcMs(y, mo - 1, d, hh, mm), sy: y, smIdx: mo - 1, sd: d };
  }
  // Legacy group with no startDate: anchor to the configured weekday.
  const firstSendMs = mostRecentWeekdayMs(nowMs, parseInt(group.emailDay || "1") || 1, hh, mm);
  const p = new Date(firstSendMs - PHOENIX_OFFSET_MS);
  return { hh, mm, firstSendMs, sy: p.getUTCFullYear(), smIdx: p.getUTCMonth(), sd: p.getUTCDate() };
}

/**
 * Most recent scheduled send instant (UTC ms) at or before nowMs, anchored on the group's
 * startDate + emailTime and repeating by frequency (weekly/biweekly/monthly). Returns null
 * if the first send hasn't been reached yet — which also enforces "never send before startDate".
 */
export function computeReviewEmailDueAtMs(group: ReviewScheduleConfig, nowMs: number): number | null {
  const { hh, mm, firstSendMs, sy, smIdx, sd } = scheduleAnchor(group, nowMs);
  if (nowMs < firstSendMs) return null;

  if ((group.frequency || "weekly") === "monthly") {
    let dueMs = firstSendMs, k = 0;
    for (;;) {
      const occ = monthlyOccurrenceMs(sy, smIdx, sd, k + 1, hh, mm);
      if (occ <= nowMs) { dueMs = occ; k++; } else break;
    }
    return dueMs;
  }

  const periodMs = ((group.frequency || "weekly") === "biweekly" ? 14 : 7) * 86400000;
  const n = Math.floor((nowMs - firstSendMs) / periodMs);
  return firstSendMs + n * periodMs;
}

/**
 * Next scheduled send instant strictly after nowMs — the mirror of
 * computeReviewEmailDueAtMs, for previewing an upcoming send. Same anchor and cadence
 * rules, so a preview can never disagree with what the scheduler will do.
 */
export function computeNextReviewEmailSendMs(group: ReviewScheduleConfig, nowMs: number = Date.now()): number | null {
  const { hh, mm, firstSendMs, sy, smIdx, sd } = scheduleAnchor(group, nowMs);
  if (nowMs < firstSendMs) return firstSendMs;

  if ((group.frequency || "weekly") === "monthly") {
    for (let k = 1; k <= 1200; k++) {
      const occ = monthlyOccurrenceMs(sy, smIdx, sd, k, hh, mm);
      if (occ > nowMs) return occ;
    }
    return null;
  }

  const periodMs = ((group.frequency || "weekly") === "biweekly" ? 14 : 7) * 86400000;
  const n = Math.floor((nowMs - firstSendMs) / periodMs);
  return firstSendMs + (n + 1) * periodMs;
}
