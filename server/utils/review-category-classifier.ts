import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Batched so big groups don't truncate the JSON reply and lose every category.
const BATCH_SIZE = 40;
const MAX_TOKENS = 4096;

export type ReviewCategory = "Shop" | "Donate" | "Other";

export interface ReviewForCategorization {
  index: number;
  comment: string;
}

/**
 * Classify a batch of review comments into EXACTLY ONE category:
 *   - "Shop"   → about the retail/shopping experience
 *   - "Donate" → about donating goods
 *   - "Other"  → neither / unclear / not enough signal
 *
 * Unlike themes (many-per-review tags), category is a single mutually-exclusive
 * bucket per review that controls which section of the sheet the row lands in.
 *
 * Reviews with no usable comment text, or anything the model can't place,
 * default to "Other" so nothing is ever dropped.
 *
 * If ANTHROPIC_API_KEY is not set, returns an empty map (caller defaults to "Other").
 */
export async function classifyReviewCategories(
  reviews: ReviewForCategorization[],
): Promise<Map<number, ReviewCategory>> {
  const result = new Map<number, ReviewCategory>();

  if (!process.env.ANTHROPIC_API_KEY) return result;

  // Only classify reviews that have actual comment text
  const reviewsWithComments = reviews.filter(
    (r) => r.comment && r.comment.trim().length > 3,
  );
  if (reviewsWithComments.length === 0) return result;

  const valid = new Set<ReviewCategory>(["Shop", "Donate", "Other"]);
  let failedBatches = 0;
  let totalBatches = 0;

  for (let start = 0; start < reviewsWithComments.length; start += BATCH_SIZE) {
    totalBatches++;
    const batch = reviewsWithComments.slice(start, start + BATCH_SIZE);
    const reviewsText = batch
      .map((r) => `[${r.index}] "${r.comment.trim()}"`)
      .join("\n\n");

    const prompt = `You are categorizing customer reviews of a thrift/charity retail organization (e.g. Goodwill). Each location both SELLS donated goods and ACCEPTS donations, so a review can be about either side.

Assign each review to EXACTLY ONE category:
- "Shop"   → about the shopping/retail experience: prices, selection, finds, checkout, store layout, cleanliness, staff helping customers buy.
- "Donate" → about donating goods: dropping off items, the donation line/lane, donation attendants, pickup scheduling, donation receipts/tax slips.
- "Other"  → neither clearly applies, or there isn't enough text to tell (e.g. "Great place!", "Love it", a bare rating).

Pick the category the review is MOSTLY about. If genuinely ambiguous or generic, use "Other". Do not invent other categories.

Reviews:
${reviewsText}

Respond with a JSON object where keys are review index numbers (as strings) and values are one of "Shop", "Donate", or "Other". Example:
{"0": "Shop", "2": "Donate", "5": "Other"}

Return ONLY the JSON object, no other text.`;

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      });

      if (message.stop_reason === "max_tokens") {
        throw new Error("response hit max_tokens and was truncated");
      }

      const text =
        message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
      const jsonText = text
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      const parsed: Record<string, string> = JSON.parse(jsonText);

      for (const [idxStr, cat] of Object.entries(parsed)) {
        const idx = parseInt(idxStr, 10);
        if (isNaN(idx)) continue;
        if (typeof cat !== "string") continue;
        const normalized = (cat.charAt(0).toUpperCase() +
          cat.slice(1).toLowerCase()) as ReviewCategory;
        if (valid.has(normalized)) result.set(idx, normalized);
      }
    } catch (err) {
      failedBatches++;
      console.error(
        `❌ [Category classifier] Batch ${totalBatches} (${batch.length} reviews) failed:`,
        err,
      );
      // Non-fatal — caller defaults uncategorized reviews to "Other"
    }
  }

  const summary = `${reviewsWithComments.length} reviews in ${totalBatches} batch(es), ${result.size} categorized, ${failedBatches} failed batch(es)`;
  if (failedBatches > 0) {
    console.error(`⚠️  [Category classifier] INCOMPLETE: ${summary}`);
  } else {
    console.log(`🗂️  [Category classifier] ${summary}`);
  }

  return result;
}
