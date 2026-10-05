/**
 * Normalizes a stored gbpLocationId to the "locations/{id}" form the Business
 * Information API expects. Stored IDs come in three shapes: a bare id, "locations/{id}",
 * or the full "accounts/{acct}/locations/{id}". Prefixing the full form with
 * "locations/" produces a path Google answers with a 404.
 */
export function toLocationResource(gbpId: string): string {
  const match = gbpId.match(/locations\/[^/]+$/);
  if (match) return match[0];
  return `locations/${gbpId.split('/').pop()}`;
}
