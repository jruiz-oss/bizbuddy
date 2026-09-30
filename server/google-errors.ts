/**
 * Turns raw Google Business Profile / OAuth / network errors into short,
 * plain-language reasons a person can act on.
 *
 * Errors reach us in three shapes:
 *  1. gaxios errors:  err.response.data.error = { code, status, message, details[] }
 *  2. our own fetch wrappers: Error("GMB API Error: 400 - {json body}")
 *  3. app-level Errors ("No shared Google connection", "Hours data not found"...)
 *
 * explainGoogleError() normalises all three, matches known cases, and always
 * keeps Google's own wording as a trailing "(Google: ...)" so nothing is lost
 * when a case isn't mapped yet.
 */

export interface ExplainedError {
  /** Stable machine code, handy for grouping in reports. */
  code: string;
  /** Short human reason. Single line. */
  message: string;
  /** Google's own wording (trimmed), if we found any. */
  detail?: string;
  /** True only when reconnecting Google is the fix. */
  isAuth: boolean;
  /** False for errors that will fail the same way every time. */
  retryable: boolean;
}

export type GoogleOp = "post" | "hours" | "photo" | "social" | "location" | "review" | "update" | "other";

interface Parsed {
  http?: number;
  status?: string; // Google status, e.g. INVALID_ARGUMENT
  reason?: string; // ErrorInfo reason, e.g. SERVICE_DISABLED
  text: string; // Google's message
  violations: string[]; // field-level descriptions
  raw: string; // everything, lower-cased, for matching
}

const MAX_DETAIL = 220;

function oneLine(s: string, max = MAX_DETAIL): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function parseGoogleError(err: unknown): Parsed {
  const e: any = err;
  const msg: string = e instanceof Error ? e.message : typeof err === "string" ? err : String(err ?? "");

  let body: any = e?.response?.data?.error ?? e?.errors?.[0] ?? null;
  let http: number | undefined =
    typeof e?.response?.status === "number" ? e.response.status : typeof e?.code === "number" ? e.code : undefined;

  // "GMB API Error: 400 - {...}" style: pull status + embedded JSON.
  const prefix = msg.match(/\b(?:API Error|Error):?\s*(\d{3})\b/i);
  if (!http && prefix) http = Number(prefix[1]);
  if (!body) {
    const j = msg.match(/\{[\s\S]*\}/);
    if (j) {
      try {
        const parsed = JSON.parse(j[0]);
        body = parsed.error ?? parsed;
      } catch {
        /* not JSON */
      }
    }
  }

  const violations: string[] = [];
  let reason: string | undefined;
  for (const d of Array.isArray(body?.details) ? body.details : []) {
    if (d?.reason && !reason) reason = String(d.reason);
    for (const v of d?.fieldViolations ?? []) {
      violations.push(`${v.field ? v.field + ": " : ""}${v.description ?? ""}`.trim());
    }
    // Some GBP errors nest a second level of details.
    for (const dd of Array.isArray(d?.errorDetails) ? d.errorDetails : []) {
      if (dd?.message) violations.push(String(dd.message));
    }
  }

  if (!http && typeof body?.code === "number") http = body.code;
  // Last resort: a bare status code in free text ("Request failed: 500 INTERNAL").
  if (!http) {
    const bare = msg.match(/\b(400|401|403|404|409|429|5\d\d)\b/);
    if (bare) http = Number(bare[1]);
  }
  let text = String(body?.message ?? msg ?? "");
  // Drop our own "GMB API Error: 404 - " wrapper and empty bodies from the display text.
  text = text.replace(/^[A-Za-z0-9 ]*Error:?\s*\d{3}\s*-\s*/, "");
  if (/^\{\s*\}$/.test(text.trim())) text = "";
  const status =
    body?.status
      ? String(body.status)
      : (msg.match(/\b(INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|INVALID_ARGUMENT|PERMISSION_DENIED|NOT_FOUND|RESOURCE_EXHAUSTED|FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS)\b/)?.[1]);

  return {
    http,
    status,
    reason,
    text,
    violations,
    raw: [msg, text, status, reason, ...violations].filter(Boolean).join(" | ").toLowerCase(),
  };
}

const has = (p: Parsed, ...needles: string[]) => needles.some((n) => p.raw.includes(n.toLowerCase()));

function build(
  code: string,
  message: string,
  p: Parsed,
  opts: { isAuth?: boolean; retryable?: boolean; withDetail?: boolean } = {}
): ExplainedError {
  const detailSrc = p.violations.length ? p.violations.join("; ") : p.text;
  const detail = opts.withDetail === false ? undefined : detailSrc ? oneLine(detailSrc) : undefined;
  return { code, message, detail, isAuth: !!opts.isAuth, retryable: !!opts.retryable };
}

export function explainGoogleError(err: unknown, op: GoogleOp = "other"): ExplainedError {
  const p = parseGoogleError(err);
  const http = p.http;

  // ---- App-level: no usable Google connection ----
  if (has(p, "no shared google connection", "user not authenticated", "not authenticated. please log in")) {
    return build("NO_GOOGLE_CONNECTION", "Google isn't connected. Reconnect Google and run it again.", p, {
      isAuth: true,
      withDetail: false,
    });
  }

  // ---- Auth: token dead / revoked / wrong scope ----
  if (
    has(p, "invalid_grant", "token has been expired or revoked", "unauthenticated", "invalid credentials", "invalid authentication credentials") ||
    http === 401
  ) {
    return build("GOOGLE_AUTH_EXPIRED", "Google connection expired or was revoked. Reconnect Google.", p, {
      isAuth: true,
      withDetail: false,
    });
  }
  if (has(p, "access_token_scope_insufficient", "insufficient authentication scopes", "insufficient permission")) {
    return build("GOOGLE_SCOPE_MISSING", "The Google connection is missing a permission. Reconnect Google and accept every checkbox.", p, {
      isAuth: true,
      withDetail: false,
    });
  }

  // ---- App-level data problems (not Google's fault) ----
  if (has(p, "location name not found in job item")) {
    return build("LOCATION_NOT_LINKED", "This location has no Google location ID saved. Run Sync from Google, then retry.", p, { withDetail: false });
  }
  if (has(p, "hours data not found", "post data not found")) {
    return build("MISSING_PAYLOAD", "The job item had no data to send. Recreate the job.", p, { withDetail: false });
  }
  if (has(p, "no business accounts found")) {
    return build("NO_BUSINESS_ACCOUNT", "The connected Google account has no Business Profile accounts.", p, { withDetail: false });
  }
  if (has(p, "invalid location name format")) {
    return build("BAD_LOCATION_ID", "The saved Google location ID is malformed. Run Sync from Google.", p, { withDetail: false });
  }

  // ---- API / project level ----
  if (has(p, "service_disabled", "has not been used in project", "api has not been used") ||
      (p.reason && p.reason.toUpperCase() === "SERVICE_DISABLED")) {
    return build("API_NOT_ENABLED", "A Google Business Profile API isn't enabled on the Google Cloud project.", p);
  }
  if (http === 429 || has(p, "resource_exhausted", "quota", "rate limit", "rate_limit_exceeded", "too many requests")) {
    return build("RATE_LIMITED", "Google rate limit or quota hit. Wait a few minutes and retry.", p, { retryable: true });
  }

  // ---- Permission / location state ----
  if (has(p, "suspended", "disabled location", "location is disabled")) {
    return build("LOCATION_SUSPENDED", "This location is suspended on Google, so edits are blocked.", p);
  }
  if (has(p, "not verified", "unverified", "verification required", "needs verification", "pending verification")) {
    return build("LOCATION_UNVERIFIED", "This location isn't verified on Google, so this edit isn't allowed.", p);
  }
  if (http === 403 || p.status === "PERMISSION_DENIED") {
    return build(
      "NO_ACCESS_TO_LOCATION",
      "The connected Google account can't edit this location (not an owner/manager, or it moved to another account).",
      p
    );
  }

  // ---- Not found ----
  if (http === 404 || p.status === "NOT_FOUND") {
    const what = op === "post" ? "post or location" : "location";
    return build("NOT_FOUND", `Google can't find this ${what}. It may have been deleted, merged, or removed from the account. Try Sync from Google.`, p);
  }

  // ---- Conflict / state ----
  if (http === 409 || p.status === "ABORTED" || p.status === "ALREADY_EXISTS") {
    return build("CONFLICT", "Google is busy with another change on this location, or it already exists. Retry in a bit.", p, { retryable: p.status === "ABORTED" });
  }
  if (p.status === "FAILED_PRECONDITION") {
    return build("LOCATION_STATE", "Google blocked this because of the location's current state (pending edits, unverified, or closed).", p);
  }

  // ---- 400s: figure out what was wrong ----
  if (http === 400 || p.status === "INVALID_ARGUMENT") {
    if (op === "post" || has(p, "localpost", "callToAction", "summary")) {
      if (has(p, "phone number")) return build("POST_PHONE_NUMBER", "Post rejected: Google doesn't allow phone numbers in post text.", p);
      if (has(p, "summary") && has(p, "length", "too long", "1500", "exceed", "max")) {
        return build("POST_TOO_LONG", "Post rejected: text is too long (Google's limit is 1,500 characters).", p);
      }
      if (has(p, "calltoaction") && has(p, "url")) {
        return build("POST_BAD_BUTTON_URL", "Post rejected: the button link is invalid or unreachable. Use a full https:// URL.", p);
      }
      if (has(p, "calltoaction", "actiontype")) {
        return build("POST_BAD_BUTTON", "Post rejected: the button type isn't valid for this post.", p);
      }
      if (has(p, "event", "starttime", "endtime", "startdate", "enddate") && has(p, "before", "after", "invalid", "past")) {
        return build("POST_BAD_DATES", "Post rejected: the event/offer dates are invalid (ended before it starts, or in the past).", p);
      }
      if (has(p, "media", "sourceurl", "image", "photo")) {
        return build("POST_BAD_IMAGE", "Post rejected: Google couldn't use the image (wrong format, too small, or the URL isn't reachable).", p);
      }
      if (has(p, "policy", "prohibited", "violat", "spam", "inappropriate", "profan")) {
        return build("POST_POLICY", "Post rejected by Google's content policy. Reword it.", p);
      }
    }
    if (op === "hours" || has(p, "regularhours", "specialhours", "opentime", "closetime", "periods")) {
      if (has(p, "overlap")) return build("HOURS_OVERLAP", "Hours rejected: two time periods overlap on the same day.", p);
      if (has(p, "specialhours")) return build("SPECIAL_HOURS_INVALID", "Special hours rejected: check the dates and open/close times.", p);
      if (has(p, "opentime", "closetime", "open_time", "close_time", "periods", "regularhours")) {
        return build("HOURS_INVALID", "Hours rejected: check that every day closes after it opens and no periods overlap.", p);
      }
    }
    if (op === "social" || has(p, "attribute")) {
      if (has(p, "attribute")) {
        return build("SOCIAL_NOT_ACCEPTED", "Google didn't accept that social link for this location's category or URL format.", p);
      }
    }
    if (has(p, "title", "name") && has(p, "policy", "violat", "not allowed")) {
      return build("NAME_POLICY", "Google rejected the business name/title under its naming policy.", p);
    }
    if (has(p, "phone")) return build("BAD_PHONE", "Google rejected a phone number. Check the format.", p);
    if (has(p, "website", "uri", "url")) return build("BAD_URL", "Google rejected a URL. Use a full https:// link that loads.", p);
    if (has(p, "address", "postal", "region")) return build("BAD_ADDRESS", "Google rejected the address. Check street, city, state and ZIP.", p);
    if (has(p, "policy", "prohibited", "violat")) return build("POLICY", "Google rejected this under its content policy.", p);
    return build("INVALID_REQUEST", "Google rejected the request as invalid.", p);
  }

  // ---- Photos: GBP returns a bare 500 INTERNAL for bad images ----
  if (op === "photo" && (http === 500 || p.status === "INTERNAL")) {
    return build("PHOTO_REJECTED", "Google couldn't process the photo (often too small or an unsupported format).", p);
  }

  // ---- Transient Google / network ----
  if (http && http >= 500) {
    return build("GOOGLE_SERVER_ERROR", "Google had a temporary error. Retry in a few minutes.", p, { retryable: true });
  }
  if (has(p, "etimedout", "econnreset", "econnrefused", "enotfound", "eai_again", "timed out", "timeout", "socket hang up", "fetch failed", "network")) {
    return build("NETWORK", "Network problem reaching Google. Retry.", p, { retryable: true, withDetail: false });
  }

  // ---- Unmapped: keep Google's words so it's still diagnosable ----
  {
    const src = p.violations.length ? p.violations.join("; ") : p.text;
    return build("UNMAPPED", src ? oneLine(src, 300) : "Unknown error with no details from Google.", p, { retryable: true, withDetail: false });
  }
}

/** Single-line text stored on job items and shown in the UI. */
export function formatExplainedError(x: ExplainedError): string {
  return x.detail ? `${x.message} (Google: ${x.detail})` : x.message;
}

/** Convenience: err -> stored text. */
export function explainToText(err: unknown, op: GoogleOp = "other"): string {
  return formatExplainedError(explainGoogleError(err, op));
}
