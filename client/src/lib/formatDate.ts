const PHOENIX_TZ = "America/Phoenix";

export function formatPhoenixDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: PHOENIX_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Scheduled posts/emails/etc. are stored as a UTC date + "HH:MM" wall-clock
// pair. Always render them back in Phoenix time (the agency's timezone) and
// label it, so the displayed time never drifts based on the viewer's own
// timezone and always matches what was set (e.g. "9:00 AM Phoenix").
export function formatScheduledDateTime(
  scheduledDate: Date | string | null | undefined,
  scheduledTime: string | null | undefined
): { date: string; time: string; timeWithLabel: string } {
  if (!scheduledDate) return { date: "—", time: "—", timeWithLabel: "—" };

  const [hours, minutes] = (scheduledTime || "00:00").split(":").map(Number);
  const datePart =
    typeof scheduledDate === "string" ? scheduledDate.split("T")[0] : scheduledDate.toISOString().split("T")[0];
  const utcDate = new Date(
    `${datePart}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`
  );
  if (isNaN(utcDate.getTime())) return { date: "—", time: "—", timeWithLabel: "—" };

  const date = utcDate.toLocaleDateString("en-US", {
    timeZone: PHOENIX_TZ,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = utcDate.toLocaleTimeString("en-US", {
    timeZone: PHOENIX_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return { date, time, timeWithLabel: `${time} Phoenix` };
}
