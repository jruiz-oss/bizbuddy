// One place that emails the agency owner when something fails or partly fails.
// Honors the "Error Notifications" toggle and the Notification Email in Settings.
// Never throws: a failed notification must not affect the operation that triggered it.
//
// Every decision is logged (sent / skipped and why) so a missing email can be
// traced in the server logs instead of vanishing silently.
import { db } from "./db";
import { users, googleConnection } from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";
import { storage } from "./storage";
import { sendHtmlEmail } from "./gmail-service";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MAX_LISTED = 10;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const recentlySent = new Map<string, number>();

export interface AlertRow {
  name: string;
  reason: string;
}

export interface AlertOptions {
  /** Short tag for the logs, e.g. "bulk-social", "scan", "job". */
  source: string;
  subject: string;
  /** Plain-text sentence(s) shown at the top of the email. */
  intro: string;
  /** Per-location (or per-item) failures. First 10 are listed. */
  rows?: AlertRow[];
  /** Client the failure belongs to; used to find whose settings apply. */
  clientId?: string | null;
  /** Same key within 10 minutes sends only once. */
  dedupeKey?: string;
  /** App path for the "open" link, e.g. "/jobs". */
  linkPath?: string;
  linkLabel?: string;
}

/**
 * Google sometimes answers with a whole HTML error page. Strip that down to
 * something a person can read in an email.
 */
export function cleanErrorText(raw: unknown, max = 300): string {
  let text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  if (/<!doctype html|<html/i.test(text)) {
    const status = text.match(/Error (\d{3})/i)?.[1] ?? text.match(/<b>(\d{3})\.<\/b>/)?.[1];
    return `Google returned an error page${status ? ` (HTTP ${status})` : ""}. The location may not be reachable with this connection.`;
  }
  text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, max) || "Unknown error";
}

async function resolveOwner(clientId?: string | null) {
  if (clientId) {
    const client = await storage.getClient(clientId);
    if (client) {
      const owner = await storage.getUser(client.userId);
      if (owner) return owner;
    }
  }
  // No client context (scans, syncs): every team member works under the one
  // agency account, so use the account that owns the shared Google connection.
  try {
    const [conn] = await db.select().from(googleConnection).where(eq(googleConnection.id, 1)).limit(1);
    if (conn?.connectedByUserId) {
      const owner = await storage.getUser(conn.connectedByUserId);
      if (owner) return owner;
    }
  } catch (err) {
    console.warn("[error-notify] could not read shared connection while resolving recipient:", err);
  }
  const [fallback] = await db.select().from(users).where(isNotNull(users.email)).limit(1);
  return fallback;
}

function appUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    (process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "")
  );
}

export async function notifyError(opts: AlertOptions): Promise<void> {
  const tag = `[error-notify:${opts.source}]`;
  try {
    if (opts.dedupeKey) {
      const last = recentlySent.get(opts.dedupeKey);
      if (last && Date.now() - last < DEDUPE_WINDOW_MS) {
        console.log(`${tag} skipped, same alert already sent in the last 10 minutes (${opts.dedupeKey})`);
        return;
      }
    }

    const owner = await resolveOwner(opts.clientId);
    if (!owner) {
      console.warn(`${tag} skipped, no account found to notify`);
      return;
    }
    if (owner.notifyOnErrors === false) {
      console.log(`${tag} skipped, "Error Notifications" is switched off in Settings`);
      return;
    }
    const to = (owner.notificationEmail || owner.email || "").trim();
    if (!to) {
      console.warn(`${tag} skipped, no Notification Email set and the account has no email`);
      return;
    }

    const rows = opts.rows ?? [];
    const rowHtml = rows
      .slice(0, MAX_LISTED)
      .map(
        (r) =>
          `<tr><td style="padding:6px 12px 6px 0;vertical-align:top"><b>${esc(r.name)}</b></td>` +
          `<td style="padding:6px 0;color:#555">${esc(cleanErrorText(r.reason))}</td></tr>`,
      )
      .join("");
    const more =
      rows.length > MAX_LISTED
        ? `<p style="color:#777">...and ${rows.length - MAX_LISTED} more.</p>`
        : "";
    const base = appUrl();
    const link =
      base && opts.linkPath
        ? `<p><a href="${esc(base)}${esc(opts.linkPath)}">${esc(opts.linkLabel ?? "Open BizBuddy")}</a></p>`
        : "";

    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
      `<p>${esc(opts.intro)}</p>` +
      (rowHtml ? `<table style="border-collapse:collapse">${rowHtml}</table>${more}` : "") +
      link +
      `<p style="color:#999;font-size:12px">You get this because "Error Notifications" is on in BizBuddy Settings.</p></div>`;

    // Imported lazily: scheduler.ts imports modules that import this one.
    const { resolveGmailSendTokens } = await import("./scheduler");
    const tokens = await resolveGmailSendTokens();
    if (!tokens) {
      console.warn(`${tag} NOT SENT, no Gmail tokens available (is the shared Google connection signed in?): ${opts.subject}`);
      return;
    }

    const result = await sendHtmlEmail(to, opts.subject, html, tokens);
    if (result.success) {
      if (opts.dedupeKey) recentlySent.set(opts.dedupeKey, Date.now());
      console.log(`${tag} sent to ${to}: ${opts.subject}`);
    } else {
      console.warn(`${tag} NOT SENT to ${to}, Gmail rejected it: ${result.error}`);
    }
  } catch (err) {
    console.warn(`${tag} threw (ignored):`, err);
  }
}
