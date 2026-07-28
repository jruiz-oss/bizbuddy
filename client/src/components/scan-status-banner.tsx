import { Loader2, CheckCircle2, AlertTriangle, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import type { ScanState } from "@/contexts/scan-progress-context";

interface ScanStatusBannerProps {
  scan: ScanState | null;
  isLoading: boolean;
  startError: string | null;
  onCancel: () => void;
  onRescan: () => void;
}

/**
 * Always-visible answer to "did the scan run, and what happened?".
 *
 * Every scan is a persisted run, so this can report on runs the current tab
 * never saw: one started elsewhere, one still going after a reload, or one cut
 * short by a server restart.
 */
export function ScanStatusBanner({
  scan,
  isLoading,
  startError,
  onCancel,
  onRescan,
}: ScanStatusBannerProps) {
  if (startError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="banner-scan-status">
        <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-red-900">Couldn't start the scan</p>
          <p className="text-xs text-red-700 mt-0.5">{startError}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-3" data-testid="banner-scan-status">
        <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />
        <p className="text-[13px] text-gray-500">Checking scan status…</p>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-start gap-3" data-testid="banner-scan-status">
        <AlertTriangle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[13px] font-semibold text-gray-900">No scan has run yet</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Run a scan to check whether Google has suggested any edits.
          </p>
        </div>
      </div>
    );
  }

  const startedBy = scan.startedByName ? ` by ${scan.startedByName}` : "";
  const finishedAt = scan.completedAt ? formatPhoenixDateTime(new Date(scan.completedAt)) : null;

  if (scan.status === "running") {
    const percent = Math.min(100, Math.max(0, scan.percent || 0));
    return (
      <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3" data-testid="banner-scan-status">
        <div className="flex items-start gap-3">
          <Loader2 className="w-4 h-4 text-orange-600 animate-spin mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-orange-900">
              Scan in progress
              {scan.totalLocations > 0
                ? ` — ${scan.scannedCount} of ${scan.totalLocations} locations`
                : " — preparing"}
            </p>
            <p className="text-xs text-orange-700 mt-0.5">
              {scan.withUpdatesCount} suggestion{scan.withUpdatesCount === 1 ? "" : "s"} found so far
              {scan.erroredCount > 0 ? ` · ${scan.erroredCount} error${scan.erroredCount === 1 ? "" : "s"}` : ""}
              {" · started "}
              {formatPhoenixDateTime(new Date(scan.startedAt))}
              {startedBy}
            </p>
            <p className="text-[11px] text-orange-600/80 mt-1">
              This runs on the server. You can close this page — results are saved as they're found.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2.5 bg-white border-orange-300 text-orange-700 hover:bg-orange-100 shrink-0"
            onClick={onCancel}
            data-testid="button-cancel-scan"
          >
            Stop
          </Button>
        </div>
        <div className="mt-2.5 h-1.5 w-full rounded-full bg-orange-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  const config = {
    success: {
      icon: <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />,
      tone: "border-green-200 bg-green-50",
      titleTone: "text-green-900",
      bodyTone: "text-green-700",
      title:
        scan.withUpdatesCount > 0
          ? `Scan complete — ${scan.withUpdatesCount} location${scan.withUpdatesCount === 1 ? "" : "s"} with suggested edits`
          : "Scan complete — no suggested edits",
      body: `Checked ${scan.scannedCount} location${scan.scannedCount === 1 ? "" : "s"}${finishedAt ? ` · finished ${finishedAt}` : ""}${startedBy}`,
      showRescan: false,
    },
    partial: {
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />,
      tone: "border-amber-200 bg-amber-50",
      titleTone: "text-amber-900",
      bodyTone: "text-amber-700",
      title: `Scan finished with errors — ${scan.erroredCount} location${scan.erroredCount === 1 ? "" : "s"} couldn't be checked`,
      body: `${scan.withUpdatesCount} suggestion${scan.withUpdatesCount === 1 ? "" : "s"} found across ${scan.scannedCount} location${scan.scannedCount === 1 ? "" : "s"}${finishedAt ? ` · finished ${finishedAt}` : ""}. ${scan.firstError || ""}`,
      showRescan: true,
    },
    failed: {
      icon: <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />,
      tone: "border-red-200 bg-red-50",
      titleTone: "text-red-900",
      bodyTone: "text-red-700",
      title: "Scan failed",
      body: scan.firstError || "Google API calls failed for every location. Check the Google connection and try again.",
      showRescan: true,
    },
    interrupted: {
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />,
      tone: "border-amber-200 bg-amber-50",
      titleTone: "text-amber-900",
      bodyTone: "text-amber-700",
      title: "Scan was interrupted",
      // Use the recorded reason — a scan can be interrupted by a restart or by
      // the stalled-scan sweep, and those are different stories.
      body: `${scan.firstError || "The scan stopped before finishing."} It got through ${scan.scannedCount} of ${scan.totalLocations} location${scan.totalLocations === 1 ? "" : "s"} — anything found up to that point is shown below.`,
      showRescan: true,
    },
    cancelled: {
      icon: <XCircle className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />,
      tone: "border-gray-200 bg-gray-50",
      titleTone: "text-gray-900",
      bodyTone: "text-gray-600",
      title: "Scan cancelled",
      body: `Stopped after ${scan.scannedCount} of ${scan.totalLocations} location${scan.totalLocations === 1 ? "" : "s"}. Results found before stopping are shown below.`,
      showRescan: true,
    },
  }[scan.status];

  if (!config) return null;

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${config.tone}`} data-testid="banner-scan-status">
      {config.icon}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-semibold ${config.titleTone}`}>{config.title}</p>
        <p className={`text-xs mt-0.5 ${config.bodyTone}`}>{config.body}</p>
      </div>
      {config.showRescan && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] px-2.5 bg-white shrink-0"
          onClick={onRescan}
          data-testid="button-rescan"
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Run again
        </Button>
      )}
    </div>
  );
}
