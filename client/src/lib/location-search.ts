// Location search that understands US states.
// Typing "az" or "arizona" matches every location in Arizona.
// Addresses from GBP sync end in ", <state> [zip]" (e.g. "123 Main St, Mesa, AZ").

const STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia",
  fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon",
  pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia",
  wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  pr: "puerto rico",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATES).map(([code, name]) => [name, code]),
);

// State codes the query refers to: exact code ("az"), exact name ("arizona"),
// or a name prefix of 4+ chars ("arizo", "north" -> ND + NC).
function stateCodesForQuery(q: string): string[] {
  if (STATES[q]) return [q];
  if (NAME_TO_CODE[q]) return [NAME_TO_CODE[q]];
  if (q.length >= 4) {
    return Object.entries(STATES)
      .filter(([, name]) => name.startsWith(q))
      .map(([code]) => code);
  }
  return [];
}

function addressHasState(address: string, code: string): boolean {
  return new RegExp(`(^|[\\s,])${code}(?=$|[\\s,]|\\d)`, "i").test(address);
}

function termMatches(
  rawQuery: string,
  loc: { name?: string | null; address?: string | null; city?: string | null },
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const name = (loc.name || "").toLowerCase();
  const city = (loc.city || "").toLowerCase();
  const address = (loc.address || "");

  // 2-letter state codes: whole-word only, so "az" doesn't hit "Plaza" or "Lazy".
  if (STATES[q]) {
    return [name, city, address.toLowerCase()].some((t) => addressHasState(t, q));
  }

  if (name.includes(q) || city.includes(q)) return true;

  const codes = stateCodesForQuery(q);
  if (codes.some((c) => addressHasState(address, c))) return true;
  return address.toLowerCase().includes(q);
}

// Multi-term search: every word must match (name, city, address or state).
// "smith az" -> locations with "smith" that are in Arizona.
// The whole phrase is tried first so "new york" still works as a state.
export function locationMatchesSearch(
  rawQuery: string,
  loc: { name?: string | null; address?: string | null; city?: string | null },
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (termMatches(q, loc)) return true;
  const terms = q.split(/\s+/);
  if (terms.length < 2) return false;
  return terms.every((t) => termMatches(t, loc));
}
