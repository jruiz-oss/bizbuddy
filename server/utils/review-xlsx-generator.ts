import ExcelJS from "exceljs";

export interface ReviewForSheet {
  locationName: string;
  locationAddress?: string;
  region?: string; // derived from address or tag
  starRating: number;
  reviewer: string;
  reviewDate: string;       // ISO string
  reviewText: string;
  themes?: string[];        // AI-classified theme labels (optional)
  responseAuthor?: string;
  responseDate?: string;    // ISO string
  responseText?: string;
}

// Header style constants
const HEADER_BG: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" }, // dark slate
};

const REVIEWER_BG: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF3C7" }, // amber-50
};

const RESPONSE_BG: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE0F2FE" }, // sky-50
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const DIVIDER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
  italic: true,
};

const REVIEWER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FF92400E" }, // amber-800
  size: 10,
};

const RESPONSE_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FF075985" }, // sky-800
  size: 10,
};

const DIVIDER_REVIEWER_BG: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF59E0B" }, // amber-400
};

const DIVIDER_RESPONSE_BG: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF38BDF8" }, // sky-400
};

// Column definitions — 10 columns total
// Cols 1-6: Reviewer block (incl. Themes) | Col 7: spacer | Cols 8-10: Response block
const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Location",        key: "locationName",    width: 28 },
  { header: "Stars",           key: "starRating",      width: 14 },
  { header: "Reviewer Name",   key: "reviewer",        width: 22 },
  { header: "Review Date",     key: "reviewDate",      width: 14 },
  { header: "Review Text",     key: "reviewText",      width: 52 },
  { header: "Themes",          key: "themes",          width: 22 },
  { header: "",                key: "spacer",          width: 3  }, // visual divider
  { header: "Response By",     key: "responseAuthor",  width: 22 },
  { header: "Response Date",   key: "responseDate",    width: 14 },
  { header: "Response Text",   key: "responseText",    width: 52 },
];

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}

function starsText(n: number): string {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

function applyHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell, col) => {
    if (col === 7) {
      // spacer column — keep neutral
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      return;
    }
    const isReviewerBlock = col <= 6;
    if (col === 1) {
      cell.fill = HEADER_BG;
      cell.font = HEADER_FONT;
    } else if (isReviewerBlock) {
      cell.fill = DIVIDER_REVIEWER_BG;
      cell.font = REVIEWER_FONT;
    } else {
      cell.fill = DIVIDER_RESPONSE_BG;
      cell.font = RESPONSE_FONT;
    }
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF374151" } },
    };
  });
  // Override col 1 header
  const c1 = row.getCell(1);
  c1.fill = HEADER_BG;
  c1.font = HEADER_FONT;
}

function applyDataRow(row: ExcelJS.Row, hasResponse: boolean) {
  row.height = 60;
  row.eachCell((cell, col) => {
    cell.alignment = { vertical: "top", wrapText: true };
    if (col === 7) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      return;
    }
    if (col <= 6) {
      cell.fill = REVIEWER_BG;
    } else {
      cell.fill = hasResponse ? RESPONSE_BG : {
        type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" },
      };
    }
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  });
}

function addReviewsToSheet(ws: ExcelJS.Worksheet, reviews: ReviewForSheet[]) {
  // Set columns
  ws.columns = COLUMNS;

  // Header row
  const headerRow = ws.getRow(1);
  // Manually set header values since we use custom layout
  headerRow.values = [
    "Location", "Stars", "Reviewer Name", "Review Date", "Review Text", "Themes",
    "", // spacer
    "Response By", "Response Date", "Response Text",
  ];
  applyHeaderRow(headerRow);
  headerRow.commit();

  // Add a sub-header divider row to visually separate reviewer/response blocks
  const dividerRow = ws.addRow([
    "← Reviewer Info", "", "", "", "", "",
    "",
    "← Business Response", "", "",
  ]);
  dividerRow.height = 16;
  dividerRow.eachCell((cell, col) => {
    if (col === 1) {
      cell.fill = DIVIDER_REVIEWER_BG;
      cell.font = DIVIDER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "left" };
    } else if (col === 7) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    } else if (col === 8) {
      cell.fill = DIVIDER_RESPONSE_BG;
      cell.font = DIVIDER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "left" };
    } else if (col <= 6) {
      cell.fill = DIVIDER_REVIEWER_BG;
    } else {
      cell.fill = DIVIDER_RESPONSE_BG;
    }
  });
  dividerRow.commit();

  // Freeze top 2 rows
  ws.views = [{ state: "frozen", ySplit: 2 }];

  // Data rows
  for (const r of reviews) {
    const hasResponse = !!(r.responseText || r.responseAuthor);
    const dataRow = ws.addRow([
      r.locationName + (r.locationAddress ? `\n${r.locationAddress}` : ""),
      starsText(r.starRating),
      r.reviewer,
      formatDate(r.reviewDate),
      r.reviewText || "(no comment)",
      r.themes && r.themes.length > 0 ? r.themes.join(", ") : "",
      "", // spacer
      r.responseAuthor || "",
      formatDate(r.responseDate),
      r.responseText || (hasResponse ? "" : "No response yet"),
    ]);
    applyDataRow(dataRow, hasResponse);
    dataRow.commit();
  }
}

function deriveRegion(review: ReviewForSheet): string {
  // Try explicit region field first
  if (review.region) return review.region;
  // Fall back to address parsing
  const addr = (review.locationAddress || review.locationName || "").toLowerCase();
  if (addr.includes("arizona") || addr.includes(" az ") || addr.includes(", az") || addr.includes("phoenix") || addr.includes("scottsdale") || addr.includes("tempe") || addr.includes("mesa") || addr.includes("chandler") || addr.includes("glendale") || addr.includes("tucson")) {
    return "Arizona";
  }
  if (addr.includes("maryland") || addr.includes(" md ") || addr.includes(", md") || addr.includes("baltimore") || addr.includes("bethesda") || addr.includes("rockville") || addr.includes("silver spring")) {
    return "Maryland";
  }
  if (addr.includes("san francisco") || addr.includes("sf") || addr.includes(" ca ") || addr.includes(", ca") || addr.includes("california") || addr.includes("los angeles") || addr.includes("san jose") || addr.includes("oakland")) {
    return "San Francisco";
  }
  return "Other";
}

function addSummaryTab(
  wb: ExcelJS.Workbook,
  reviews: ReviewForSheet[],
  breakout: string,
  groupLabel: string,
  dateRange: string,
) {
  const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF1F2937" } } });
  ws.columns = [
    { header: "Group / Region / Location", key: "name",         width: 36 },
    { header: "Total Reviews",             key: "total",        width: 16 },
    { header: "Avg Stars",                 key: "avg",          width: 12 },
    { header: "Has Response",              key: "responded",    width: 16 },
    { header: "No Response",               key: "notResponded", width: 16 },
    { header: "",                          key: "spacer",       width: 3  },
    { header: "Theme",                     key: "theme",        width: 26 },
    { header: "Total Mentions",            key: "themeTotal",   width: 16 },
    { header: "Positive (4-5★)",           key: "pos",          width: 16 },
    { header: "Neutral (3★)",              key: "neu",          width: 14 },
    { header: "Negative (1-2★)",           key: "neg",          width: 16 },
  ];

  // Title rows
  const titleRow = ws.getRow(1);
  titleRow.values = [`Review Summary — ${groupLabel}`];
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F2937" } };
  titleRow.height = 24;
  titleRow.commit();

  const subRow = ws.addRow([dateRange]);
  subRow.getCell(1).font = { size: 10, color: { argb: "FF6B7280" }, italic: true };
  subRow.commit();

  ws.addRow([]); // spacer

  // ── Group stats header ────────────────────────────────────────────────────
  const hdr = ws.addRow(["Group / Region / Location", "Total Reviews", "Avg Stars", "Has Response", "No Response"]);
  hdr.height = 20;
  hdr.eachCell((cell, col) => {
    if (col > 5) return;
    cell.fill = HEADER_BG;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  hdr.commit();

  // Build group data
  const groups: Record<string, ReviewForSheet[]> = {};
  for (const r of reviews) {
    const key = breakout === "region"
      ? deriveRegion(r)
      : breakout === "location"
        ? r.locationName
        : "All Locations";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  for (const [key, groupReviews] of Object.entries(groups)) {
    const total = groupReviews.length;
    const avg = (groupReviews.reduce((s, r) => s + r.starRating, 0) / total).toFixed(1);
    const responded = groupReviews.filter(r => r.responseText || r.responseAuthor).length;
    const notResponded = total - responded;
    const dataRow = ws.addRow([key, total, Number(avg), responded, notResponded]);
    dataRow.eachCell((cell, col) => {
      if (col > 5) return;
      cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    });
    if (notResponded > 0) {
      dataRow.getCell(5).font = { bold: true, color: { argb: "FFDC2626" } };
    }
    dataRow.commit();
  }

  // ── Theme breakdown ───────────────────────────────────────────────────────
  // Sentiment: 4-5★ = positive, 3★ = neutral, 1-2★ = negative
  function sentiment(stars: number): "pos" | "neu" | "neg" {
    if (stars >= 4) return "pos";
    if (stars === 3) return "neu";
    return "neg";
  }

  // Build per-group theme stats
  interface ThemeStat { total: number; pos: number; neu: number; neg: number }
  const themesByGroup: Record<string, Record<string, ThemeStat>> = {};
  for (const r of reviews) {
    if (!r.themes || r.themes.length === 0) continue;
    const groupKey = breakout === "region"
      ? deriveRegion(r)
      : breakout === "location"
        ? r.locationName
        : "All Locations";
    if (!themesByGroup[groupKey]) themesByGroup[groupKey] = {};
    const s = sentiment(r.starRating);
    for (const theme of r.themes) {
      if (!themesByGroup[groupKey][theme]) themesByGroup[groupKey][theme] = { total: 0, pos: 0, neu: 0, neg: 0 };
      themesByGroup[groupKey][theme].total++;
      themesByGroup[groupKey][theme][s]++;
    }
  }

  const hasAnyThemes = Object.values(themesByGroup).some(g => Object.keys(g).length > 0);
  if (!hasAnyThemes) {
    ws.views = [{ state: "frozen", ySplit: 4 }];
    return;
  }

  // Spacer before theme section
  ws.addRow([]);
  ws.addRow([]);

  // Theme section title
  const themeTitleRow = ws.addRow(["Theme Breakdown by " + groupLabel]);
  themeTitleRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1F2937" } };
  themeTitleRow.height = 22;
  themeTitleRow.commit();

  // Theme header (cols 7-11)
  const themeHdrRow = ws.addRow(["", "", "", "", "", "", "Theme", "Total Mentions", "Positive (4-5★)", "Neutral (3★)", "Negative (1-2★)"]);
  themeHdrRow.height = 20;
  themeHdrRow.eachCell((cell, col) => {
    if (col < 7) return;
    cell.fill = HEADER_BG;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  // Group label header on col 1
  const groupHdrCell = themeHdrRow.getCell(1);
  groupHdrCell.value = "Group / Region / Location";
  groupHdrCell.fill = HEADER_BG;
  groupHdrCell.font = HEADER_FONT;
  groupHdrCell.alignment = { vertical: "middle", horizontal: "center" };
  themeHdrRow.commit();

  const POS_BG: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } }; // green-100
  const NEG_BG: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } }; // red-100
  const NEU_BG: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } }; // yellow-100

  // Emit one row per group+theme, sorted by total desc
  for (const [groupKey, themes] of Object.entries(themesByGroup)) {
    const sorted = Object.entries(themes).sort((a, b) => b[1].total - a[1].total);
    let firstRow = true;
    for (const [theme, stat] of sorted) {
      const row = ws.addRow([
        firstRow ? groupKey : "",  // col 1: group name only on first row
        "", "", "", "",             // cols 2-5: empty
        "",                        // col 6: spacer
        theme,                     // col 7
        stat.total,                // col 8
        stat.pos,                  // col 9
        stat.neu,                  // col 10
        stat.neg,                  // col 11
      ]);
      row.height = 18;
      // Group name styling
      if (firstRow) {
        const c = row.getCell(1);
        c.font = { bold: true, color: { argb: "FF1F2937" } };
        c.alignment = { vertical: "middle" };
      }
      // Spacer col 6
      row.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      // Theme name
      row.getCell(7).alignment = { vertical: "middle", horizontal: "left" };
      row.getCell(7).border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      // Total
      row.getCell(8).alignment = { vertical: "middle", horizontal: "center" };
      row.getCell(8).font = { bold: true };
      // Positive
      const posCell = row.getCell(9);
      posCell.alignment = { vertical: "middle", horizontal: "center" };
      if (stat.pos > 0) { posCell.fill = POS_BG; posCell.font = { color: { argb: "FF065F46" } }; }
      // Neutral
      const neuCell = row.getCell(10);
      neuCell.alignment = { vertical: "middle", horizontal: "center" };
      if (stat.neu > 0) { neuCell.fill = NEU_BG; }
      // Negative
      const negCell = row.getCell(11);
      negCell.alignment = { vertical: "middle", horizontal: "center" };
      if (stat.neg > 0) { negCell.fill = NEG_BG; negCell.font = { color: { argb: "FF991B1B" } }; }

      row.commit();
      firstRow = false;
    }
    // Separator after each group
    ws.addRow([]);
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

export async function generateReviewsXlsx(
  reviews: ReviewForSheet[],
  breakout: "region" | "location" | "none",
  groupName: string,
  dateRange: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BizBuddy";
  wb.created = new Date();

  // Always add Summary tab first
  addSummaryTab(wb, reviews, breakout, groupName, dateRange);

  if (breakout === "none") {
    const ws = wb.addWorksheet("All Reviews", {
      properties: { tabColor: { argb: "FF6366F1" } },
    });
    addReviewsToSheet(ws, reviews);
  } else {
    // Group reviews by region or location
    const grouped: Record<string, ReviewForSheet[]> = {};
    for (const r of reviews) {
      const key = breakout === "region" ? deriveRegion(r) : r.locationName;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }

    // Sort groups: known regions first, then alphabetically
    const REGION_ORDER = ["Arizona", "Maryland", "San Francisco"];
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const ai = REGION_ORDER.indexOf(a);
      const bi = REGION_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const TAB_COLORS: Record<string, string> = {
      "Arizona":       "FFF59E0B",
      "Maryland":      "FF10B981",
      "San Francisco": "FF3B82F6",
    };

    for (const key of sortedKeys) {
      const tabColor = TAB_COLORS[key] || "FF8B5CF6";
      // Truncate tab name to 31 chars (Excel limit)
      const tabName = key.substring(0, 31);
      const ws = wb.addWorksheet(tabName, {
        properties: { tabColor: { argb: tabColor } },
      });
      addReviewsToSheet(ws, grouped[key]);
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
