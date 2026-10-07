// Emails the account owner when a bulk job finishes with failures.
// Delivery rules (toggle, address, logging) live in error-notify.ts.
// Never throws: a failed notification must not affect the job itself.
import { storage } from "./storage";
import { notifyError } from "./error-notify";

const JOB_LABELS: Record<string, string> = {
  hours: "Business hours update",
  posts: "Post publish",
  photo: "Photo upload",
};

export async function notifyJobErrors(jobId: string): Promise<void> {
  try {
    const job = await storage.getJob(jobId);
    if (!job || job.isDryRun) return;
    if (job.status !== "failed" && job.status !== "partial") return;

    const client = await storage.getClient(job.clientId);
    if (!client) {
      console.warn(`[error-notify:job] skipped job ${jobId}, client ${job.clientId} not found`);
      return;
    }

    const items = await storage.getJobItems(jobId);
    const failed = items.filter((i) => i.status === "failed");

    const rows = [];
    for (const item of failed.slice(0, 10)) {
      const loc = await storage.getLocation(item.clientLocationId);
      rows.push({ name: loc?.name ?? "Unknown location", reason: item.errorText || "Unknown error" });
    }

    const label = JOB_LABELS[job.type] ?? `${job.type} job`;
    const outcome =
      job.status === "failed"
        ? "failed for every location"
        : `partly failed (${job.errorCount} of ${job.totalItems} locations)`;

    await notifyError({
      source: "job",
      clientId: job.clientId,
      dedupeKey: `job:${jobId}`,
      subject: `BizBuddy: ${label} ${job.status === "failed" ? "failed" : "completed with errors"} for ${client.name}`,
      intro: `The ${label.toLowerCase()} for ${client.name} ${outcome}.`,
      rows,
      linkPath: "/jobs",
      linkLabel: "Open the Activity log",
    });
  } catch (err) {
    console.warn(`Job ${jobId}: error notification threw (ignored):`, err);
  }
}
