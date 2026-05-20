import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import { eq, inArray, isNotNull, and } from "drizzle-orm";
import cronParser from "cron-parser";
import { google } from 'googleapis';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

import * as schema from "../shared/schema";
const { users, reviewEmailGroups, reviewEmailGroupLocations, clientLocations } = schema;

const db = drizzle({ client: pool, schema });

// Send an email using the caller's pre-built OAuth2 client (tokens come from the DB).
// No Replit connector dependency.
interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

function createRawEmail(options: EmailOptions): string {
  const { to, subject, body, isHtml = false } = options;
  const contentType = isHtml ? 'text/html' : 'text/plain';

  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}; charset=utf-8`,
    '',
    body
  ];

  const email = emailLines.join('\r\n');
  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendEmail(
  options: EmailOptions,
  oauth2Client: any,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const raw = createRawEmail(options);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log(`Email sent successfully to ${options.to}, messageId: ${response.data.id}`);
    return { success: true, messageId: response.data.id || undefined };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error sending email';
    console.error('Failed to send email:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

function generateStarsHtml(rating: number): string {
  return Array.from({ length: 5 }, (_, i) => 
    i < rating 
      ? '<span style="color: #facc15; font-size: 18px;">★</span>'
      : '<span style="color: #d1d5db; font-size: 18px;">★</span>'
  ).join('');
}

function generateReviewEmailHtml(
  reviews: any[], 
  clientName: string, 
  minStars: number, 
  maxStars: number,
  allCheckedLocations?: { name: string; address?: string; reviewCount: number }[]
): string {
  const reviewsByLocation = reviews.reduce((acc, review) => {
    const key = review.gbpLocationId || review.locationName || 'Unknown Location';
    if (!acc[key]) {
      acc[key] = { reviews: [], name: review.locationName, address: review.locationAddress };
    }
    acc[key].reviews.push(review);
    return acc;
  }, {} as Record<string, { reviews: any[]; name?: string; address?: string }>);

  const starText = minStars === maxStars 
    ? `${minStars} star${minStars !== 1 ? 's' : ''}`
    : `${minStars}-${maxStars} stars`;

  const locationsWithReviews = Object.keys(reviewsByLocation).length;
  const totalLocationsChecked = allCheckedLocations?.length || locationsWithReviews;
  const locationsWithZero = allCheckedLocations?.filter(l => l.reviewCount === 0) || [];

  const titleText = `New Reviews With ${maxStars} Star${maxStars !== 1 ? 's' : ''} Or Less`;

  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
        ${titleText}
      </h1>
      <p style="color: #6b7280; margin-bottom: 20px;">
        ${reviews.length} new review${reviews.length !== 1 ? 's' : ''} with ${starText} across ${locationsWithReviews} location${locationsWithReviews !== 1 ? 's' : ''} (past 7 days)
        <span style="color: #9ca3af; font-size: 13px;"> &mdash; checked ${totalLocationsChecked} location${totalLocationsChecked !== 1 ? 's' : ''} total</span>
      </p>
  `;

  for (const [_key, data] of Object.entries(reviewsByLocation)) {
    html += `
      <div style="margin-bottom: 30px; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px;">
        <h2 style="color: #374151; background: #f3f4f6; padding: 12px 16px; border-radius: 8px; margin: 0 0 15px 0;">
          📍 ${data.name || 'Unknown Location'}
          ${data.address ? `<span style="font-size: 14px; font-weight: normal; color: #6b7280; display: block;">${data.address}</span>` : ''}
        </h2>
    `;

    for (const review of data.reviews) {
      html += `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; background: #fff;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #1f2937; font-size: 16px;">${review.reviewer}</strong>
            <div style="margin-top: 4px;">
              ${generateStarsHtml(review.starRating)}
              <span style="color: #6b7280; font-size: 14px; margin-left: 8px;">
                ${new Date(review.createTime).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
          ${review.comment 
            ? `<p style="color: #374151; margin: 0; line-height: 1.6; font-style: italic;">"${review.comment}"</p>` 
            : `<p style="color: #9ca3af; margin: 0; font-style: italic;">No comment provided</p>`
          }
        </div>
      `;
    }

    html += `</div>`;
  }

  if (locationsWithZero.length > 0) {
    html += `
      <div style="margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <p style="color: #6b7280; margin: 0 0 8px 0; font-size: 14px; font-weight: 500;">
          Also checked (0 matching reviews):
        </p>
        <p style="color: #9ca3af; margin: 0; font-size: 13px; line-height: 1.6;">
          ${locationsWithZero.map(l => l.name).join(' &bull; ')}
        </p>
      </div>
    `;
  }

  html += `
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
        Generated on ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })} (via Scheduled Deployment)
      </div>
    </div>
  `;

  return html;
}

async function refreshAccessTokenIfNeeded(oauth2Client: any, userId: string): Promise<string | null> {
  try {
    const tokenInfo = await oauth2Client.getAccessToken();
    if (tokenInfo.token) {
      return tokenInfo.token;
    }
    
    if (oauth2Client.credentials.refresh_token) {
      console.log("  🔄 Refreshing expired access token...");
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      
      if (credentials.access_token) {
        await db.update(users)
          .set({ accessToken: credentials.access_token })
          .where(eq(users.id, userId));
        console.log("  ✅ Access token refreshed and saved to database");
      }
      
      return credentials.access_token;
    }
    
    console.error("  ❌ No valid access token and no refresh token available");
    return null;
  } catch (error: any) {
    if (error.message?.includes('invalid_grant') || error.message?.includes('Token has been expired')) {
      console.error("  ❌ Refresh token is invalid or expired. User needs to re-authenticate in the app.");
      return null;
    }
    console.error("  ❌ Error refreshing token:", error.message);
    return null;
  }
}

async function validateUserTokens(oauth2Client: any, userId: string): Promise<boolean> {
  try {
    const token = await refreshAccessTokenIfNeeded(oauth2Client, userId);
    if (!token) {
      return false;
    }
    
    const response = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=1', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    if (response.status === 401 || response.status === 403) {
      console.log("  ⚠️ Token validation failed - insufficient permissions or token expired");
      return false;
    }
    
    if (!response.ok && response.status !== 429) {
      console.log(`  ⚠️ Token validation returned status ${response.status}`);
      return false;
    }
    
    console.log("  ✅ Token validated successfully");
    return true;
  } catch (error) {
    console.error("  ❌ Error validating tokens:", error);
    return false;
  }
}

async function getReviewsForLocation(oauth2Client: any, gbpLocationId: string, userId: string): Promise<any[]> {
  try {
    const parts = gbpLocationId.match(/accounts\/([^\/]+)\/locations\/([^\/]+)/);
    if (!parts) {
      console.log(`Invalid location ID format: ${gbpLocationId}`);
      return [];
    }
    
    const [, accountId, locationId] = parts;
    const apiUrl = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
    
    const token = await refreshAccessTokenIfNeeded(oauth2Client, userId);
    if (!token) {
      console.error(`  ❌ Cannot fetch reviews - no valid access token`);
      return [];
    }
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch reviews for ${gbpLocationId}: ${response.status} - ${errorText}`);
      return [];
    }
    
    const data = await response.json();
    return data.reviews || [];
  } catch (error) {
    console.error(`Error fetching reviews for ${gbpLocationId}:`, error);
    return [];
  }
}

async function sendScheduledReviewEmailForGroup(
  group: typeof reviewEmailGroups.$inferSelect,
  oauth2Client: any,
  userId: string
) {
  try {
    const groupLocations = await db.select().from(reviewEmailGroupLocations).where(
      eq(reviewEmailGroupLocations.groupId, group.id)
    );
    
    if (groupLocations.length === 0) {
      console.log(`📧 No locations in group "${group.name}"`);
      return;
    }
    
    const locationIds = groupLocations.map(gl => gl.locationId);
    const locations = await db.select().from(clientLocations).where(
      inArray(clientLocations.id, locationIds)
    );
    
    if (locations.length === 0) {
      console.log(`📧 No valid locations in group "${group.name}"`);
      return;
    }
    
    const allReviews: any[] = [];
    const minStars = group.minStars;
    const maxStars = group.maxStars;
    const allCheckedLocations: { name: string; address?: string; reviewCount: number }[] = [];
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    for (const location of locations) {
      let matchingReviewCount = 0;
      try {
        const reviews = await getReviewsForLocation(oauth2Client, location.gbpLocationId, userId);
        
        for (const review of reviews) {
          let starRating = 0;
          if (review.starRating) {
            if (typeof review.starRating === 'string') {
              const ratingMap: any = { 'FIVE': 5, 'FOUR': 4, 'THREE': 3, 'TWO': 2, 'ONE': 1 };
              starRating = ratingMap[review.starRating.toUpperCase()] || 0;
            } else {
              starRating = Number(review.starRating) || 0;
            }
          }
          
          if (starRating >= minStars && starRating <= maxStars) {
            const reviewDate = new Date(review.createTime);
            if (reviewDate >= weekAgo) {
              matchingReviewCount++;
              allReviews.push({
                reviewer: review.reviewer?.displayName || 'Anonymous',
                starRating,
                comment: review.comment || '',
                createTime: review.createTime,
                locationName: location.name,
                locationAddress: location.address,
                gbpLocationId: location.gbpLocationId
              });
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error fetching reviews for location ${location.id}:`, error);
      }
      
      allCheckedLocations.push({
        name: location.name,
        address: location.address || undefined,
        reviewCount: matchingReviewCount
      });
    }
    
    if (allReviews.length === 0) {
      console.log(`📧 No reviews to send for group "${group.name}"`);
      return;
    }
    
    const emailHtml = generateReviewEmailHtml(allReviews, group.name, minStars, maxStars, allCheckedLocations);
    const starText = minStars === maxStars ? `${minStars} star` : `${minStars}-${maxStars} stars`;
    
    const allLocationNames = allReviews.map(r => r.locationName).filter(Boolean) as string[];
    const uniqueLocationNames = [...new Set(allLocationNames)];
    
    const combinedNames: string[] = [];
    const usedIndices = new Set<number>();
    
    for (let i = 0; i < uniqueLocationNames.length; i++) {
      if (usedIndices.has(i)) continue;
      
      const name1 = uniqueLocationNames[i];
      let baseName = name1;
      
      for (let j = i + 1; j < uniqueLocationNames.length; j++) {
        if (usedIndices.has(j)) continue;
        
        const name2 = uniqueLocationNames[j];
        const words1 = name1.toLowerCase().split(/\s+/);
        const words2 = name2.toLowerCase().split(/\s+/);
        const maxWords = Math.max(words1.length, words2.length);
        
        let commonWords = 0;
        for (let k = 0; k < Math.min(words1.length, words2.length); k++) {
          if (words1[k] === words2[k]) commonWords++;
          else break;
        }
        
        if (commonWords >= maxWords * 0.8 || commonWords >= 3) {
          usedIndices.add(j);
          const originalWords = name1.split(/\s+/);
          baseName = originalWords.slice(0, commonWords).join(' ');
        }
      }
      
      usedIndices.add(i);
      combinedNames.push(baseName);
    }
    
    const locationNamesText = combinedNames.length > 0 
      ? ` - ${combinedNames.join(', ')}`
      : '';
    
    const subjectText = `${allReviews.length} new review${allReviews.length !== 1 ? 's' : ''} (${starText})${locationNamesText}`;
    
    const recipients = group.recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
    
    for (const recipient of recipients) {
      try {
        await sendEmail(
          { to: recipient, subject: subjectText, body: emailHtml, isHtml: true },
          oauth2Client,
        );
        console.log(`✅ Sent review email to ${recipient} for group "${group.name}"`);
      } catch (error) {
        console.error(`❌ Failed to send review email to ${recipient}:`, error);
      }
    }
  } catch (error) {
    console.error(`❌ Error sending scheduled review email for group:`, error);
  }
}

async function main() {
  console.log("🚀 Starting scheduled email check...");
  const now = new Date();
  console.log(`📅 Current time: ${now.toISOString()}`);
  
  try {
    const allUsersWithTokens = await db.select().from(users).where(
      and(
        isNotNull(users.accessToken),
        isNotNull(users.refreshToken)
      )
    );
    
    if (allUsersWithTokens.length === 0) {
      console.log("⚠️ No users with valid Google authentication found");
      await pool.end();
      return;
    }
    
    console.log(`👥 Found ${allUsersWithTokens.length} user(s) with Google authentication`);
    
    for (const user of allUsersWithTokens) {
      if (!user.accessToken) continue;
      
      console.log(`\n📧 Processing emails for user: ${user.email || user.id}`);
      
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken || undefined
      });
      
      const isValid = await validateUserTokens(oauth2Client, user.id);
      if (!isValid) {
        console.log(`  ⚠️ Skipping user - tokens are invalid or expired. User needs to log in again.`);
        continue;
      }
      
      const userGroups = await db.select().from(reviewEmailGroups).where(
        and(
          eq(reviewEmailGroups.userId, user.id),
          eq(reviewEmailGroups.isEnabled, true)
        )
      );
      
      console.log(`  📋 Found ${userGroups.length} enabled email group(s)`);
      
      for (const group of userGroups) {
        if (!group.recipientEmail) continue;
        
        try {
          const [hour, minute] = group.emailTime.split(':');
          const cronExpression = `${parseInt(minute)} ${parseInt(hour)} * * ${group.emailDay}`;
          
          const interval = cronParser.CronExpressionParser.parse(cronExpression, {
            currentDate: now,
            tz: 'America/Phoenix'
          });
          
          const prevDate = interval.prev().toDate();
          const timeDiff = Math.abs(now.getTime() - prevDate.getTime());
          
          if (timeDiff < 3600000) {
            console.log(`  📨 Sending scheduled review email for group "${group.name}" (scheduled: ${group.emailDay} at ${group.emailTime})`);
            await sendScheduledReviewEmailForGroup(group, oauth2Client, user.id);
          } else {
            console.log(`  ⏭️ Skipping group "${group.name}" - not scheduled for now (scheduled: ${group.emailDay} at ${group.emailTime})`);
          }
        } catch (error) {
          console.error(`  ❌ Error checking schedule for group ${group.id}:`, error);
        }
      }
    }
    
    console.log("\n✅ Scheduled email check complete!");
  } catch (error) {
    console.error("❌ Error in scheduled email job:", error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
