import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Large groups (500+ reviews/month) blow past the output limit if sent in one call,
// which truncates the JSON and loses every theme. Classify in small batches instead.
const BATCH_SIZE = 40;
const MAX_TOKENS = 4096;

export interface ReviewForClassification {
  index: number;
  comment: string;
}

/**
 * Classify review comments against a list of user-defined theme labels.
 * Only themes from the provided list are kept (case-insensitive match).
 * If the themes list is empty, nothing is classified (returns an empty map).
 * If ANTHROPIC_API_KEY is not set, returns an empty map (safe no-op).
 *
 * Runs in batches; a failed batch is logged and skipped, other batches still count.
 */
export async function classifyReviewThemes(
  reviews: ReviewForClassification[],
  themes: string[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();

  if (!process.env.ANTHROPIC_API_KEY) return result;
  if (themes.length === 0) return result;

  const reviewsWithComments = reviews.filter(r => r.comment && r.comment.trim().length > 3);
  if (reviewsWithComments.length === 0) return result;

  const validThemesLower = new Map(themes.map(t => [t.toLowerCase(), t] as const));
  const userThemesSection = `Your defined themes:\n${themes.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n`;

  let failedBatches = 0;
  let totalBatches = 0;

  for (let start = 0; start < reviewsWithComments.length; start += BATCH_SIZE) {
    totalBatches++;
    const batch = reviewsWithComments.slice(start, start + BATCH_SIZE);
    const reviewsText = batch
      .map(r => `[${r.index}] "${r.comment.trim()}"`)
      .join("\n\n");

    const prompt = `You are classifying customer reviews by theme.

${userThemesSection}For each review, match any of the defined themes above that clearly apply (use exact spelling). Only include a theme if there is clear evidence in the review text. Return [] if nothing applies. Do NOT invent or add themes beyond the defined list.

Reviews:
${reviewsText}

Respond with a JSON object where keys are review index numbers (as strings) and values are arrays of theme strings. Example:
{"0": ["staff", "cleanliness"], "2": ["prices"], "5": []}

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

      const text = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
      const jsonText = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      const parsed: Record<string, string[]> = JSON.parse(jsonText);

      for (const [idxStr, matchedThemes] of Object.entries(parsed)) {
        const idx = parseInt(idxStr, 10);
        if (isNaN(idx) || !Array.isArray(matchedThemes)) continue;

        // Only keep user-defined themes, mapped back to their exact spelling
        const valid = matchedThemes
          .filter((t): t is string => typeof t === "string")
          .map(t => validThemesLower.get(t.toLowerCase()))
          .filter((t): t is string => !!t);

        if (valid.length > 0) result.set(idx, valid);
      }
    } catch (err) {
      failedBatches++;
      console.error(`❌ [Theme classifier] Batch ${totalBatches} (${batch.length} reviews) failed:`, err);
      // Non-fatal — email/sheet still sends, those reviews just have no themes
    }
  }

  const summary = `${reviewsWithComments.length} reviews in ${totalBatches} batch(es), ${result.size} tagged, ${failedBatches} failed batch(es)`;
  if (failedBatches > 0) {
    console.error(`⚠️  [Theme classifier] INCOMPLETE: ${summary} | themes: [${themes.join(", ")}]`);
  } else {
    console.log(`🏷️  [Theme classifier] ${summary} | themes: [${themes.join(", ")}]`);
  }

  return result;
}
