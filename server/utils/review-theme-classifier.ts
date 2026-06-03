import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ReviewForClassification {
  index: number;
  comment: string;
}

/**
 * Classify a batch of review comments against a list of theme labels,
 * and also discover additional themes not in the list.
 *
 * Each review gets:
 *   - matched user-defined themes (from the provided list)
 *   - AI-discovered themes it noticed that weren't covered (prefixed with "* " in the sheet)
 *
 * If themes list is empty, runs in discovery-only mode.
 * If ANTHROPIC_API_KEY is not set, returns an empty map (safe no-op).
 */
export async function classifyReviewThemes(
  reviews: ReviewForClassification[],
  themes: string[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();

  if (!process.env.ANTHROPIC_API_KEY) return result;

  // Only classify reviews that have actual comment text
  const reviewsWithComments = reviews.filter(r => r.comment && r.comment.trim().length > 3);
  if (reviewsWithComments.length === 0) return result;

  const reviewsText = reviewsWithComments
    .map(r => `[${r.index}] "${r.comment.trim()}"`)
    .join("\n\n");

  const userThemesSection = themes.length > 0
    ? `Your defined themes:\n${themes.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n`
    : "";

  const prompt = `You are classifying customer reviews by theme.

${userThemesSection}For each review:
1. Match any of the defined themes above that clearly apply (use exact spelling).
2. Also identify up to 2 additional themes you notice that are NOT already covered by the defined list. Keep them short (1-3 words). Prefix these with "* " so they're distinguishable.

Only include a theme if there is clear evidence in the review text. Return [] if nothing applies.

Reviews:
${reviewsText}

Respond with a JSON object where keys are review index numbers (as strings) and values are arrays of theme strings. Example:
{"0": ["staff", "cleanliness", "* wait time"], "2": ["prices"], "5": ["* parking"]}

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

    const validThemesLower = new Set(themes.map(t => t.toLowerCase()));

    for (const [idxStr, matchedThemes] of Object.entries(parsed)) {
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx) || !Array.isArray(matchedThemes)) continue;

      const valid = matchedThemes.filter(t => {
        if (typeof t !== "string") return false;
        // Keep user-defined themes (case-insensitive) and AI-discovered ones (prefixed with "* ")
        return t.startsWith("* ") || validThemesLower.has(t.toLowerCase());
      });

      if (valid.length > 0) result.set(idx, valid);
    }

    console.log(`🏷️  [Theme classifier] Classified ${reviewsWithComments.length} reviews | defined: [${themes.join(", ")}]`);
  } catch (err) {
    console.error("❌ [Theme classifier] Failed to classify reviews:", err);
    // Non-fatal — email/sheet still sends without themes
  }

  return result;
}
