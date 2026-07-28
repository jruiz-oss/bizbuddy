import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { getApiUrl, apiRequest } from "@/lib/queryClient";

export type ScanStatus =
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ScanResult {
  locationId: string;
  locationName: string;
  /** Nullable: client_locations.address is nullable in the database. */
  locationAddress: string | null;
  gbpLocationName: string;
  hasUpdates: boolean;
  originalLocation: any;
  suggestedLocation: any;
  diffMask: string;
}

export interface ScanState {
  scanId: string;
  status: ScanStatus;
  totalLocations: number;
  scannedCount: number;
  withUpdatesCount: number;
  erroredCount: number;
  firstError: string | null;
  percent: number;
  startedAt: string;
  completedAt: string | null;
  startedByName: string | null;
  scope: { folderIds: string[]; locationIds: string[] };
  results?: ScanResult[];
}

interface ScanProgressContextType {
  /** The run being shown: whatever is running, otherwise the most recent one. */
  scan: ScanState | null;
  /** Results of that run. Empty until the first batch lands. */
  results: ScanResult[];
  isScanning: boolean;
  /** True until we've asked the server whether a scan is in flight. */
  isLoadingScan: boolean;
  startError: string | null;
  startScan: (folderIds?: string[], locationIds?: string[]) => Promise<void>;
  cancelScan: () => Promise<void>;
  /** Locally drop fields the user has accepted/rejected, without a refetch. */
  setResults: (updater: (prev: ScanResult[]) => ScanResult[]) => void;
  /** Hide the finished-run pill (per scan id, remembered across reloads). */
  dismissPill: () => void;
  isPillDismissed: boolean;
}

const ScanProgressContext = createContext<ScanProgressContextType | undefined>(undefined);

const DISMISSED_KEY = "suggestedEdits_dismissedScanId";

function isTerminal(status: ScanStatus | undefined) {
  return !!status && status !== "running";
}

/**
 * Owns the state of the suggested-edits scan for the whole app.
 *
 * The scan itself runs on the server (see server/suggested-edits-scanner.ts), so
 * this provider is only a viewer: on mount it asks the server what's happening,
 * and while a scan is running it follows along via SSE with a polling fallback.
 * That's what makes the run survive navigation and reloads — nothing about the
 * scan lives in this component.
 */
export function ScanProgressProvider({ children }: { children: ReactNode }) {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [results, setResultsState] = useState<ScanResult[]>([]);
  const [isLoadingScan, setIsLoadingScan] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [dismissedScanId, setDismissedScanId] = useState<string | null>(
    () => localStorage.getItem(DISMISSED_KEY),
  );

  // Tracked in a ref so the SSE effect can read the latest id without
  // resubscribing on every progress tick.
  const scanIdRef = useRef<string | null>(null);
  scanIdRef.current = scan?.scanId ?? null;

  /** Load the run the server thinks we should be showing. */
  const loadCurrent = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/suggested-edits/scan/current"), {
        credentials: "include",
      });
      if (!res.ok) return;
      const data: (ScanState & { results?: ScanResult[] }) | null = await res.json();
      // A successful read means the API is reachable, so a previous "couldn't
      // start the scan" message is stale — clearing it here stops that error
      // from permanently masking the real run status in the banner.
      setStartError(null);
      if (!data) {
        setScan(null);
        setResultsState([]);
        return;
      }
      setScan(data);
      setResultsState(data.results || []);
    } catch {
      // Offline or backend down — leave whatever we already had on screen
      // rather than blanking it out.
    } finally {
      setIsLoadingScan(false);
    }
  }, []);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  // Re-sync when the tab regains focus. Covers the case where the user left the
  // app entirely, the scan finished in the background, and no stream was open.
  const lastSyncRef = useRef(0);
  useEffect(() => {
    // Both events fire on a single app switch, so throttle — otherwise every
    // refocus costs two round-trips.
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncRef.current < 2000) return;
      lastSyncRef.current = Date.now();
      loadCurrent();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadCurrent]);

  // Follow a running scan. SSE when it works, polling when it doesn't — Railway's
  // proxy and some corporate networks drop long-lived streams, and a dropped
  // stream must never look like a dead scan.
  const activeStreamId = scan?.status === "running" ? scan.scanId : null;

  useEffect(() => {
    if (!activeStreamId) return;

    let closed = false;
    let eventSource: EventSource | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const applyProgress = (data: ScanState) => {
      if (closed) return;
      setScan((prev) => ({ ...(prev || data), ...data, results: undefined }));
      // Progress events carry counters only. Pull the full row (with results)
      // once the run reaches a terminal state.
      if (isTerminal(data.status)) {
        loadCurrent();
      }
    };

    const poll = async () => {
      if (closed) return;
      try {
        const res = await fetch(getApiUrl(`/api/suggested-edits/scan/${activeStreamId}`), {
          credentials: "include",
        });
        if (!res.ok) return;
        const data: ScanState & { results?: ScanResult[] } = await res.json();
        if (closed) return;
        setScan(data);
        if (data.results) setResultsState(data.results);
      } catch {
        // Transient — the next tick will retry.
      }
    };

    try {
      eventSource = new EventSource(
        getApiUrl(`/api/suggested-edits/scan/${activeStreamId}/stream`),
        { withCredentials: true },
      );
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.error) return;
          applyProgress(data);
        } catch {
          /* ignore malformed frame */
        }
      };
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        if (!closed && !pollId) pollId = setInterval(poll, 3000);
      };
    } catch {
      pollId = setInterval(poll, 3000);
    }

    // Also poll slowly alongside SSE. Cheap insurance against a stream that
    // stays open but stops delivering (seen behind some proxies).
    const slowPoll = setInterval(poll, 15000);
    poll();

    return () => {
      closed = true;
      eventSource?.close();
      if (pollId) clearInterval(pollId);
      clearInterval(slowPoll);
    };
  }, [activeStreamId, loadCurrent]);

  const startScan = useCallback(
    async (folderIds: string[] = [], locationIds: string[] = []) => {
      setStartError(null);
      try {
        const res = await apiRequest("POST", "/api/suggested-edits/scan", {
          folderIds,
          locationIds,
        });
        const data: ScanState = await res.json();
        setScan(data);
        setResultsState([]);
        // A brand-new run should always be visible.
        setDismissedScanId(null);
        localStorage.removeItem(DISMISSED_KEY);
      } catch (err: any) {
        const message = String(err?.message || "");
        // 409 means a scan is already running — attach to it instead of erroring.
        if (message.startsWith("409")) {
          await loadCurrent();
          return;
        }
        setStartError(message.replace(/^\d+:\s*/, "") || "Failed to start scan");
        throw err;
      }
    },
    [loadCurrent],
  );

  const cancelScan = useCallback(async () => {
    const id = scanIdRef.current;
    if (!id) return;
    try {
      await apiRequest("POST", `/api/suggested-edits/scan/${id}/cancel`, {});
    } finally {
      await loadCurrent();
    }
  }, [loadCurrent]);

  const setResults = useCallback((updater: (prev: ScanResult[]) => ScanResult[]) => {
    setResultsState((prev) => updater(prev));
  }, []);

  const dismissPill = useCallback(() => {
    const id = scanIdRef.current;
    if (!id) return;
    setDismissedScanId(id);
    localStorage.setItem(DISMISSED_KEY, id);
  }, []);

  return (
    <ScanProgressContext.Provider
      value={{
        scan,
        results,
        isScanning: scan?.status === "running",
        isLoadingScan,
        startError,
        startScan,
        cancelScan,
        setResults,
        dismissPill,
        isPillDismissed: !!scan && dismissedScanId === scan.scanId,
      }}
    >
      {children}
    </ScanProgressContext.Provider>
  );
}

export function useScanProgress() {
  const context = useContext(ScanProgressContext);
  if (context === undefined) {
    throw new Error("useScanProgress must be used within a ScanProgressProvider");
  }
  return context;
}
