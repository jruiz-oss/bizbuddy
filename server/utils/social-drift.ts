/**
 * Detects drift between a location's locally-stored social media links and
 * what's actually live on its Google Business Profile.
 *
 * Google (or a client editing the listing directly) can revert or clear a
 * social link BizBuddy previously pushed. Core fields (name, phone, address,
 * website, description) already get this treatment during sync — see the
 * CORE_FIELDS comparison in routes.ts and scheduler.ts. This does the same
 * for social links, so those changes show up in the same "unauthorized
 * changes" activity log entry and can be reverted the same way.
 *
 * Only locations that already have at least one social link tracked locally
 * are checked — there's nothing to detect drift against otherwise, and it
 * keeps this from adding a Google API call for every location on every sync
 * (accounts can have 150+ locations, most without social links set at all).
 */

export interface SocialMediaChange {
  field: string; // "social_twitter", "social_facebook", etc.
  old: string;
  new: string;
}

export interface SocialMediaDriftResult {
  changes: SocialMediaChange[];
  // Present only when changes were found — the local socialMedia value to
  // persist so it matches what's actually live on Google right now.
  updatedSocialMedia: Record<string, string> | null;
}

const SOCIAL_PLATFORMS = [
  "twitter",
  "facebook",
  "instagram",
  "youtube",
  "linkedin",
  "tiktok",
  "pinterest",
] as const;

interface SocialMediaReader {
  getSocialMediaUrls(locationName: string): Promise<Record<string, string>>;
}

export async function detectSocialMediaDrift(
  googleOAuthAuth: SocialMediaReader,
  gbpLocationId: string | null | undefined,
  existingSocialMedia: Record<string, string> | null | undefined,
): Promise<SocialMediaDriftResult> {
  const local = existingSocialMedia || {};
  const trackedPlatforms = SOCIAL_PLATFORMS.filter(
    (platform) => (local[platform] || "").toString().trim() !== "",
  );

  if (trackedPlatforms.length === 0 || !gbpLocationId) {
    return { changes: [], updatedSocialMedia: null };
  }

  let live: Record<string, string>;
  try {
    live = await googleOAuthAuth.getSocialMediaUrls(gbpLocationId);
  } catch (err: any) {
    console.error(
      `⚠️ Could not fetch social media attributes for ${gbpLocationId}:`,
      err?.message || err,
    );
    return { changes: [], updatedSocialMedia: null };
  }

  const changes: SocialMediaChange[] = [];
  const updatedSocialMedia = { ...local };

  for (const platform of trackedPlatforms) {
    const oldVal = (local[platform] || "").toString().trim();
    const newVal = (live[platform] || "").toString().trim();
    if (oldVal && newVal !== oldVal) {
      changes.push({ field: `social_${platform}`, old: oldVal, new: newVal });
      if (newVal) {
        updatedSocialMedia[platform] = newVal;
      } else {
        delete updatedSocialMedia[platform];
      }
    }
  }

  return {
    changes,
    updatedSocialMedia: changes.length > 0 ? updatedSocialMedia : null,
  };
}
