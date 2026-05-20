import { useState, useEffect, useRef } from "react";
import { getApiUrl } from "@/lib/queryClient";

export interface JobProgress {
  jobId: string;
  status: string;
  totalItems: number;
  successCount: number;
  errorCount: number;
  processedCount: number;
  percent: number;
  step: number; // 1: Queued, 2: Processing, 3: Finalizing
  errorMessage?: string; // first error reason from failed job items
}

interface UseJobProgressOptions {
  pollInterval?: number;
  onComplete?: (progress: JobProgress) => void;
  onError?: (error: Error) => void;
}

interface UseJobProgressReturn {
  progress: JobProgress | null;
  isLoading: boolean;
  error: Error | null;
  isComplete: boolean;
}

export function useJobProgress(
  jobId: string | null, 
  options: UseJobProgressOptions = {}
): UseJobProgressReturn {
  const { pollInterval = 1000, onComplete, onError } = options;

  // Keep callbacks in refs so they never appear in the effect dependency array.
  // This prevents the effect from re-running (and re-firing onComplete) when
  // the parent re-renders with a new inline function reference.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Track whether onComplete has already been called for this jobId so that
  // re-renders never cause it to fire a second time.
  const completeFiredRef = useRef(false);

  useEffect(() => {
    // Reset the guard whenever the job changes.
    completeFiredRef.current = false;

    if (!jobId) {
      setIsLoading(false);
      return;
    }

    let eventSource: EventSource | null = null;
    let pollIntervalId: NodeJS.Timeout | null = null;
    let cleanup = false;

    const handleComplete = (data: JobProgress) => {
      if (completeFiredRef.current) return;
      completeFiredRef.current = true;
      setIsComplete(true);
      onCompleteRef.current?.(data);
    };

    const pollProgress = async () => {
      if (cleanup) return;
      
      try {
        const response = await fetch(getApiUrl(`/api/jobs/${jobId}/progress`));
        if (!response.ok) {
          throw new Error(`Failed to fetch progress: ${response.statusText}`);
        }
        
        const data = await response.json();
        setProgress(data);
        setError(null);
        setIsLoading(false);

        if (data.status === "success" || data.status === "partial" || data.status === "failed") {
          handleComplete(data);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        onErrorRef.current?.(error);
        setIsLoading(false);
      }
    };

    const startSSE = () => {
      try {
        eventSource = new EventSource(getApiUrl(`/api/jobs/${jobId}/stream`));
        
        eventSource.onmessage = (event) => {
          if (cleanup) return;
          
          try {
            const data = JSON.parse(event.data);
            if (data.type !== "connected") {
              setProgress(data);
              setError(null);
              setIsLoading(false);

              // When SSE fires a terminal status, do one final HTTP fetch so
              // we get the full progress object including errorMessage before
              // calling onComplete (the SSE emitter doesn't include errorMessage).
              if (data.status === "success" || data.status === "partial" || data.status === "failed") {
                pollProgress();
              }
            }
          } catch (err) {
            console.error("Error parsing SSE data:", err);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE error, falling back to polling:", err);
          eventSource?.close();
          eventSource = null;
          
          pollIntervalId = setInterval(pollProgress, pollInterval);
        };

      } catch (err) {
        console.error("SSE not available, using polling:", err);
        pollIntervalId = setInterval(pollProgress, pollInterval);
      }
    };

    // Start with SSE, fallback to polling
    startSSE();
    
    // Initial poll
    pollProgress();

    return () => {
      cleanup = true;
      eventSource?.close();
      if (pollIntervalId) clearInterval(pollIntervalId);
    };
  }, [jobId, pollInterval]);

  return {
    progress,
    isLoading,
    error,
    isComplete
  };
}