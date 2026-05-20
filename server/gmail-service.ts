// Gmail Integration - Email Service
// Uses the logged-in user's stored Google OAuth tokens — no Replit dependency.

import { google } from 'googleapis';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users } from '@shared/schema';

// Tokens sourced from the `users` table (accessToken + refreshToken stored at login).
export interface UserTokens {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
}

function buildOAuth2Client(tokens: UserTokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
  });

  // When the library auto-refreshes an expired access token, persist the new
  // one back to the database so the next request doesn't force another refresh.
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      try {
        await db.update(users)
          .set({ accessToken: newTokens.access_token, updatedAt: new Date() })
          .where(eq(users.id, tokens.userId));
      } catch (err) {
        console.error('Failed to persist refreshed Gmail access token:', err);
      }
    }
  });

  return oauth2Client;
}

// Exported for callers that need a raw Gmail client (e.g. test flows).
export async function getUncachableGmailClient(tokens: UserTokens) {
  const oauth2Client = buildOAuth2Client(tokens);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface InlineImage {
  cid: string;          // e.g. "commit-logo"
  filename: string;     // e.g. "commit-logo.png"
  mimeType: string;     // e.g. "image/png"
  base64Data: string;   // raw base64 string (no data: prefix)
}

interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
  cc?: string;
  inlineImages?: InlineImage[];
}

function encodeMimeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function createRawEmail(options: EmailOptions): string {
  const { to, subject, body, isHtml = false, cc, inlineImages } = options;
  const boundary = '----=_BizBuddyBoundary_' + Date.now();

  let email: string;

  if (isHtml && inlineImages && inlineImages.length > 0) {
    // multipart/related so inline CID images are embedded directly in the message.
    // The HTML body is base64-encoded within the part to preserve all inline styles exactly.
    const htmlBase64 = Buffer.from(body, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)!
      .join('\r\n');

    const headerLines = [
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${encodeMimeSubject(subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/related; boundary="${boundary}"`,
    ];

    const htmlPart = [
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlBase64,
    ];

    // No filename on Content-Disposition so Gmail treats this as inline, not attachment
    const imageParts = inlineImages.map(img => [
      `--${boundary}`,
      `Content-Type: ${img.mimeType}`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline`,
      ``,
      img.base64Data.match(/.{1,76}/g)!.join('\r\n'),
    ].join('\r\n'));

    email = [
      headerLines.join('\r\n'),
      ``,
      htmlPart.join('\r\n'),
      ``,
      ...imageParts,
      ``,
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    // Simple single-part message
    const contentType = isHtml ? 'text/html' : 'text/plain';
    const emailLines = [
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${encodeMimeSubject(subject)}`,
      `Content-Type: ${contentType}; charset=utf-8`,
      '',
      body
    ];
    email = emailLines.join('\r\n');
  }

  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendEmail(
  options: EmailOptions,
  tokens: UserTokens,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = await getUncachableGmailClient(tokens);
    const raw = createRawEmail(options);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log(`Email sent successfully to ${options.to}, messageId: ${response.data.id}`);

    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error sending email';
    const errorDetails = error.response?.data?.error?.message || error.code || '';
    console.error('Failed to send email:', errorMessage, errorDetails);
    return {
      success: false,
      error: errorDetails ? `${errorMessage}: ${errorDetails}` : errorMessage,
    };
  }
}

export async function sendHtmlEmail(
  to: string,
  subject: string,
  htmlBody: string,
  tokens: UserTokens,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return sendEmail({ to, subject, body: htmlBody, isHtml: true }, tokens);
}

export async function sendTextEmail(
  to: string,
  subject: string,
  textBody: string,
  tokens: UserTokens,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return sendEmail({ to, subject, body: textBody, isHtml: false }, tokens);
}
