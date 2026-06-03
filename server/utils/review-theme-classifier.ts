import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ReviewForClassification {
  index: number;
  comment: string;
}

/**
 * Classify a batch of review comments against a list of theme labels.
 * Returns a map of review index → matched theme labels.
 *
 * Skips reviews with no comment text. If ANTHROPIC_API_KEY is not set or
 * the themes list is empty, returns an empty map (safe no-op).
 */
export async function classifyReviewThemes(
  reviews: ReviewForClassification[],
  themes: string[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();

  if (!process.env.ANTHROPIC_API_KEY || themes.length === 0) return result;

  // Only classify reviews that have actual comment text
  const reviewsWithComments = reviews.filter(r => r.comment && r.comment.trim().length > 3);
  if (reviewsWithComments.length === 0) return result;

  const themeList = themes.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const reviewsText = reviewsWithComments
    .map(r => `[${r.index}] "${r.comment.trim()}"`)
    .join("\n\n");

  const prompt = `You are classifying customer reviews by theme.

Available themes:
${themeList}

For each review below, return the theme numbers that apply. A review can match multiple themes or none.
Only match a theme if there is clear evidence in the review text.

Reviews:
${reviewsText}

Respond with a JSON object where keys are the review index numbers (as strings) and values are arrays of matching theme labels (exact spelling from the list above). Example:
{"0": ["staff", "cleanliness"], "2": ["prices"], "5": []}

Return ONLY the JSON object, no other text.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Strip markdown code fences if present
    const jsonText = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed: Record<string, string[]> = JSON.parse(jsonText);

    // Validate and populate result map
    const validThemesLower = new Set(themes.map(t => t.toLowerCase()));
    for (const [idxStr, matchedThemes] of Object.entries(parsed)) {
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx)) continue;
      if (!Array.isArray(matchedThemes)) continue;
      // Only keep themes that are in our list (case-insensitive match → return original casing)
      const valid = matchedThemes.filter(t =>
        typeof t === "string" && validThemesLower.has(t.toLowerCase())
      );
      if (valid.length > 0) result.set(idx, valid);
    }

    console.log(`🏷️  [Theme classifier] Classified ${reviewsWithComments.length} reviews against themes: [${themes.join(", ")}]`);
  } catch (err) {
    console.error("❌ [Theme classifier] Failed to classify reviews:", err);
    // Non-fatal — return empty map, email/sheet still sends without themes
  }

  return result;
}
