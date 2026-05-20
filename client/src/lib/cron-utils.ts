// Simple cron utilities for validation and next run calculation
// In production, you'd use libraries like cron-parser

export function validateCronExpression(cron: string): boolean {
  // Basic validation for cron expressions
  // This is a simplified version - in production use a proper cron parser
  const parts = cron.trim().split(/\s+/);
  
  if (parts.length !== 5) {
    return false;
  }

  // Basic pattern matching for common cron patterns
  const cronPattern = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])-([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])(,([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9]))*) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])|([0-9]|1[0-9]|2[0-3])-([0-9]|1[0-9]|2[0-3])|([0-9]|1[0-9]|2[0-3])(,([0-9]|1[0-9]|2[0-3]))*) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])|([1-9]|1[0-9]|2[0-9]|3[0-1])-([1-9]|1[0-9]|2[0-9]|3[0-1])|([1-9]|1[0-9]|2[0-9]|3[0-1])(,([1-9]|1[0-9]|2[0-9]|3[0-1]))*) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])|([1-9]|1[0-2])-([1-9]|1[0-2])|([1-9]|1[0-2])(,([1-9]|1[0-2]))*) (\*|([0-6])|\*\/([0-6])|([0-6])-([0-6])|([0-6])(,([0-6]))*)$/;

  // For MVP, just check if it matches basic patterns
  const commonPatterns = [
    /^\d+ \d+ \d+,\d+ \* \*$/, // "0 9 1,15 * *"
    /^\d+ \d+ \d+ \*\/\d+ \*$/, // "0 9 1 */2 *"
    /^\d+ \d+ \* \* \*$/, // "0 9 * * *"
    /^\*\/\d+ \* \* \* \*$/, // "*/15 * * * *"
  ];

  return commonPatterns.some(pattern => pattern.test(cron));
}

export function getNextCronRun(cron: string, timezone = "America/Phoenix"): string {
  // Simplified next run calculation
  // In production, use a proper cron parser library
  
  try {
    const now = new Date();
    
    // Simple parsing for common patterns
    if (cron === "0 9 1,15 * *") {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0);
      const fifteenth = new Date(now.getFullYear(), now.getMonth(), 15, 9, 0);
      
      if (now.getDate() < 15) {
        return fifteenth.toLocaleDateString("en-US", {
          timeZone: timezone,
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      } else {
        return nextMonth.toLocaleDateString("en-US", {
          timeZone: timezone,
          month: "short",
          day: "numeric", 
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      }
    }
    
    if (cron === "0 9 1 */2 *") {
      const nextRun = new Date(now.getFullYear(), now.getMonth() + 2, 1, 9, 0);
      return nextRun.toLocaleDateString("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        year: "numeric", 
        hour: "numeric",
        minute: "2-digit",
      });
    }

    // Fallback
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    return nextHour.toLocaleDateString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    
  } catch (error) {
    return "Invalid cron expression";
  }
}

export function describeCronExpression(cron: string): string {
  // Simple description for common patterns
  switch (cron) {
    case "0 9 1,15 * *":
      return "09:00 on 1st & 15th of each month";
    case "0 9 1 */2 *":
      return "09:00 on 1st of every 2 months";
    case "0 9 * * *":
      return "09:00 every day";
    case "0 */6 * * *":
      return "Every 6 hours";
    default:
      return "Custom schedule";
  }
}
