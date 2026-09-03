/**
 * Decide whether an error reflects a genuine GOOGLE auth problem — the agency's
 * one shared Google connection being expired or revoked — as opposed to:
 *   - a content/API error (a 500 INTERNAL, an image below GBP's minimum size),
 *     which re-auth does nothing for, or
 *   - this browser's own app session having expired, which is fixed by logging
 *     back in as yourself, NOT by reconnecting Google.
 *
 * That second case matters: everyone on the team signs in with their own
 * local-user account under one shared Google connection. Treating a plain
 * session 401 as a Google failure told coworkers "ask a super admin to
 * reconnect Google" when all they needed to do was log in again.
 *
 * Only errors matched here should surface the "Re-authenticate with Google" CTA.
 */

/** Messages this app produces for its OWN expired/missing app session. */
function isAppSessionError(text: string): boolean {
  return (
    text.includes("authentication required") ||
    text.includes("no user session found") ||
    text.includes("session has expired") ||
    text.includes("session expired") ||
    text.includes("please log in")
  );
}

export function isGoogleAuthError(error: unknown): boolean {
  if (!error) return false;
  const t = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Our own session messages are never a Google problem — check first, because
  // they often arrive alongside a 401 status code.
  if (isAppSessionError(t)) return false;

  return (
    t.includes("invalid_grant") ||
    t.includes("permission_denied") ||
    t.includes("unauthenticated") ||
    t.includes("invalid credentials") ||
    t.includes("invalid authentication") ||
    t.includes("token has been expired or revoked") ||
    t.includes("re-authenticate") ||
    t.includes("reauthenticate") ||
    // A bare 401/403 from a route that talks to Google. Kept last so the
    // app-session messages above win.
    /\b(401|403)\b/.test(t)
  );
}

/** True when the fix is "log back into BizBuddy", not "reconnect Google". */
export function isSessionExpiredError(error: unknown): boolean {
  if (!error) return false;
  const t = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return isAppSessionError(t);
}
