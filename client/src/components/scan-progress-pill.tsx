import { useLocation } from "wouter";
import { Loader2, X, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScanProgress } from "@/contexts/scan-progress-context";

/**
 * Floating status for the suggested-edits scan, rendered on every page.
 *
 * The scan takes minutes and runs on the server. Without this the only signal
 * lived inside a button on one page, so leaving that page made a running scan
 * indistinguishable from one that never started. This follows the user around
 * while it runs and reports the outcome afterwards.
 */
export function ScanProgressPill() {
  const [location, navigate] = useLocation();
  const { scan, isScanning, isPillDismissed, dismissPill, cancelScan } = useScanProgress();

  if (!scan) return null;

  const onScanPage = location === "/suggested-edits";

  // Once a run is finished, show the outcome once and let the user dismiss it.
  // While it's running we always show it — that's the whole point.
  if (!isScanning && isPillDismissed) return null;

  // A finished run whose results are already on screen needs no announcement.
  if (!isScanning && onScanPage) return null;

  // Don't resurrect last week's scan on every page load. The outcome is only
  // worth surfacing while it's still news; after that the Suggested Edits page
  // is the place to look.
  const RECENT_MS = 15 * 60 * 1000;
  const finishedRecently =
    !!scan.completedAt && Date.now() - new Date(scan.completedAt).getTime() < RECENT_MS;
  if (!isScanning && !finishedRecently) return null;

  const percent = Math.min(100, Math.max(0, scan.percent || 0));

  const outcome = (() => {
    switch (scan.status) {
      case "success":
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
          title: scan.withUpdatesCount > 0 ? "Scan complete" : "Scan complete — nothing found",
          detail:
            scan.withUpdatesCount > 0
              ? `${scan.withUpdatesCount} location${scan.withUpdatesCount === 1 ? "" : "s"} with suggested edits`
              : `Checked ${scan.scannedCount} location${scan.scannedCount === 1 ? "" : "s"}, no suggestions from Google`,
          tone: "border-green-200 bg-green-50",
        };
      case "partial":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
          title: "Scan finished with errors",
          detail: `${scan.withUpdatesCount} found · ${scan.erroredCount} location${scan.erroredCount === 1 ? "" : "s"} couldn't be checked`,
          tone: "border-amber-200 bg-amber-50",
        };
      case "failed":
        return {
          icon: <XCircle className="w-4 h-4 text-red-600" />,
          title: "Scan failed",
          detail: scan.firstError || "Google API calls failed. Check the connection and try again.",
          tone: "border-red-200 bg-red-50",
        };
      case "interrupted":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
          title: "Scan was interrupted",
          detail: `Stopped after ${scan.scannedCount} of ${scan.totalLocations}. Run it again to finish.`,
          tone: "border-amber-200 bg-amber-50",
        };
      case "cancelled":
        return {
          icon: <XCircle className="w-4 h-4 text-gray-500" />,
          title: "Scan cancelled",
          detail: `Stopped after ${scan.scannedCount} of ${scan.totalLocations}.`,
          tone: "border-gray-200 bg-gray-50",
        };
      default:
        return null;
    }
  })();

  return (
    <div
      className="fixed bottom-5 right-5 z-40 w-[340px] rounded-xl border bg-white shadow-lg shadow-black/5 overflow-hidden"
      data-testid="pill-scan-progress"
    >
      {isScanning ? (
        <div className="p-3.5">
          <div className="flex items-start gap-2.5">
            <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-900">
                Scanning for suggested edits
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5" data-testid="text-scan-progress">
                {scan.totalLocations > 0
                  ? `${scan.scannedCount} of ${scan.totalLocations} locations · ${scan.withUpdatesCount} found`
                  : "Preparing…"}
              </p>
            </div>
          </div>

          <div className="mt-2.5 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>

          <p className="text-[10px] text-gray-400 mt-2">
            Runs on the server — you can leave this page.
          </p>

          <div className="flex items-center gap-2 mt-2.5">
            {!onScanPage && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2.5"
                onClick={() => navigate("/suggested-edits")}
                data-testid="button-scan-pill-view"
              >
                View
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] px-2.5 text-gray-500 hover:text-red-600"
              onClick={() => cancelScan()}
              data-testid="button-scan-pill-cancel"
            >
              Stop scan
            </Button>
          </div>
        </div>
      ) : outcome ? (
        <div className={`p-3.5 border-l-4 ${outcome.tone}`}>
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">{outcome.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-900">{outcome.title}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{outcome.detail}</p>
            </div>
            <button
              onClick={dismissPill}
              className="text-gray-400 hover:text-gray-700 shrink-0"
              aria-label="Dismiss"
              data-testid="button-scan-pill-dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {!onScanPage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-2.5 mt-2.5 bg-white"
              onClick={() => {
                dismissPill();
                navigate("/suggested-edits");
              }}
              data-testid="button-scan-pill-view-results"
            >
              View results
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
