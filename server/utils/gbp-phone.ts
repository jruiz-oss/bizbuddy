/**
 * Pull the phone number out of a GBP location's `phoneNumbers` field.
 * The API returns an object ({ primaryPhone, additionalPhones }), not an array,
 * so `phoneNumbers[0].number` is always undefined. Falls back to the first
 * additional phone when no primary is set.
 */
export function getGbpPhone(location: any): string {
  const pn = location?.phoneNumbers;
  if (!pn) return '';
  const primary = typeof pn.primaryPhone === 'string' ? pn.primaryPhone.trim() : '';
  if (primary) return primary;
  const extra = Array.isArray(pn.additionalPhones) ? pn.additionalPhones.find((p: any) => typeof p === 'string' && p.trim()) : '';
  return extra ? extra.trim() : '';
}
