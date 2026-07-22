/**
 * Decide whether an error reflects a genuine Google auth problem
 * (expired/revoked session) that re-authenticating would actually fix — as
 * opposed to a content/API error like a 500 INTERNAL (e.g. an image below GBP's
 * minimum size), which re-auth does nothing for.
 *
 * Only errors matched here should surface the "Re-authenticate with Google" CTA.
 * Kept in sync with the server-side `isGoogleAuthError` in server/routes.ts.
 */
export function isGoogleAuthError(error: unknown): boolean {
  if (!error) return false;
  const t = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    /\b(401|403)\b/.test(t) ||
    t.includes("unauthenticated") ||
    t.includes("unauthorized") ||
    t.includes("permission_denied") ||
    t.includes("invalid_grant") ||
    t.includes("invalid credentials") ||
    t.includes("invalid authentication") ||
    t.includes("authentication required") ||
    t.includes("not authenticated") ||
    t.includes("re-authenticate") ||
    t.includes("reauthenticate") ||
    t.includes("token has been expired or revoked") ||
    t.includes("session has expired") ||
    t.includes("session expired") ||
    t.includes("please log in")
  );
}
