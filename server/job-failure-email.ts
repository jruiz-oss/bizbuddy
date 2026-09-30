// Emails the account owner when a bulk job finishes with failures.
// Honors the "Notify on errors" toggle and the Notification Email in Settings.
// Never throws: a failed notification must not affect the job itself.
import { storage } from "./storage";
import { sendHtmlEmail } from "./gmail-service";

const JOB_LABELS: Record<string, string> = {
  hours: "Business hours update",
  posts: "Post publish",
  photo: "Photo upload",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MAX_LISTED = 10;

export async function notifyJobErrors(jobId: string): Promise<void> {
  try {
    const job = await storage.getJob(jobId);
    if (!job || job.isDryRun) return;
    if (job.status !== "failed" && job.status !== "partial") return;

    const client = await storage.getClient(job.clientId);
    if (!client) return;
    const owner = await storage.getUser(client.userId);
    if (!owner || owner.notifyOnErrors === false) return;

    const to = (owner.notificationEmail || owner.email || "").trim();
    if (!to) return;

    const items = await storage.getJobItems(jobId);
    const failed = items.filter((i) => i.status === "failed");

    const rows: string[] = [];
    for (const item of failed.slice(0, MAX_LISTED)) {
      const loc = await storage.getLocation(item.clientLocationId);
      rows.push(
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top"><b>${esc(loc?.name ?? "Unknown location")}</b></td>` +
          `<td style="padding:6px 0;color:#555">${esc((item.errorText || "Unknown error").slice(0, 300))}</td></tr>`,
      );
    }
    const more = failed.length > MAX_LISTED ? `<p style="color:#777">...and ${failed.length - MAX_LISTED} more. Open the Activity log for the full list.</p>` : "";

    const label = JOB_LABELS[job.type] ?? `${job.type} job`;
    const outcome = job.status === "failed" ? "failed for every location" : `partly failed (${job.errorCount} of ${job.totalItems} locations)`;
    const subject = `BizBuddy: ${label} ${job.status === "failed" ? "failed" : "completed with errors"} for ${client.name}`;

    const appUrl =
      process.env.APP_URL?.trim() ||
      (process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "");
    const link = appUrl ? `<p><a href="${esc(appUrl)}/jobs">Open the Activity log</a></p>` : "";

    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
      `<p>The ${esc(label.toLowerCase())} for <b>${esc(client.name)}</b> ${outcome}.</p>` +
      (rows.length ? `<table style="border-collapse:collapse">${rows.join("")}</table>${more}` : "") +
      link +
      `<p style="color:#999;font-size:12px">You get this because "Notify on errors" is on in BizBuddy Settings.</p></div>`;

    // Imported lazily: scheduler.ts imports this module's caller (job-processor).
    const { resolveGmailSendTokens } = await import("./scheduler");
    const tokens = await resolveGmailSendTokens();
    if (!tokens) {
      console.warn(`Job ${jobId}: error notification skipped, no Gmail tokens available`);
      return;
    }
    const result = await sendHtmlEmail(to, subject, html, tokens);
    if (!result.success) console.warn(`Job ${jobId}: error notification failed to send: ${result.error}`);
  } catch (err) {
    console.warn(`Job ${jobId}: error notification threw (ignored):`, err);
  }
}
