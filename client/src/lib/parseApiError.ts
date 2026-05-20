/**
 * Extracts the most human-readable error message from an API error.
 *
 * Handles formats like:
 *  - Plain Error objects
 *  - "500: {\"error\":\"...\",\"message\":\"...\"}" (apiRequest throw format)
 *  - "500: Some plain message"
 *  - Raw JSON strings
 */
export function parseApiError(error: unknown, fallback?: string): string {
  if (!error) return fallback || "An unexpected error occurred.";

  const raw = error instanceof Error ? error.message : String(error);

  // Try to extract JSON payload from messages like "500: {...}"
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const inner = parsed.message || parsed.error || parsed.detail;
      if (inner && typeof inner === "string") return inner;
    } catch {
      // fall through
    }
  }

  // Strip leading status code prefix: "500: Some message" → "Some message"
  const statusMatch = raw.match(/^\d{3}:\s*([\s\S]+)$/);
  if (statusMatch) {
    const stripped = statusMatch[1].trim();
    if (stripped) return stripped;
  }

  return raw || fallback || "An unexpected error occurred.";
}
