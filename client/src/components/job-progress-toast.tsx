import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useJobProgress, JobProgress } from "@/hooks/use-job-progress";
import { useJobProgressContext } from "@/contexts/job-progress-context";
import { Check, Clock, Play, CheckCircle2, Loader2, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { getApiUrl } from "@/lib/queryClient";

interface JobProgressToastProps {
  jobId: string;
  jobType: "hours" | "posts" | "photos";
  onComplete?: (progress: JobProgress) => void;
}

interface StepData {
  id: number;
  label: string;
  icon: React.ReactNode;
  completed: boolean;
}

export function JobProgressToast({ jobId, jobType, onComplete }: JobProgressToastProps) {
  const { clearJobProgress } = useJobProgressContext();

  const { progress } = useJobProgress(jobId, {
    onComplete: (p) => {
      onComplete?.(p);
    }
  });

  const handleClose = () => {
    clearJobProgress();
  };

  if (!progress) return null;

  const isRunning = progress.status === "running" || progress.status === "queued";
  const isDone = progress.status === "success" || progress.status === "partial" || progress.status === "failed";

  const getJobTypeLabel = () => {
    switch (jobType) {
      case "hours": return "Updating Business Hours";
      case "posts": return "Publishing Posts";
      case "photos": return "Uploading Photos";
      default: return "Processing";
    }
  };

  const steps: StepData[] = [
    {
      id: 1,
      label: "Queued",
      icon: <Clock className="w-3.5 h-3.5" />,
      completed: progress.step >= 1
    },
    {
      id: 2,
      label: "Processing",
      icon: <Play className="w-3.5 h-3.5" />,
      completed: progress.step >= 2
    },
    {
      id: 3,
      label: "Finalizing",
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      completed: progress.step >= 3
    }
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      data-testid="job-progress-toast"
    >
      {/* Backdrop — blocks interaction but not clickable to close while running */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal card */}
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5"
        data-testid="job-progress-modal"
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          {isRunning ? (
            <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
          ) : progress.status === "success" ? (
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-600 dark:text-red-400" />
            </div>
          )}

          <div>
            <h2
              className="text-lg font-semibold text-gray-900 dark:text-gray-50"
              data-testid="job-progress-title"
            >
              {isRunning ? getJobTypeLabel() : progress.status === "success" ? "All Done!" : progress.status === "partial" ? "Completed with Errors" : "Job Failed"}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {isRunning
                ? "Please wait — do not close this window."
                : progress.status === "success"
                  ? `${progress.successCount} location${progress.successCount !== 1 ? "s" : ""} updated successfully.`
                  : progress.status === "partial"
                    ? `${progress.successCount} succeeded, ${progress.errorCount} failed.`
                    : "No locations were updated."}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span data-testid="job-progress-items">
              {progress.processedCount} of {progress.totalItems} locations
            </span>
            <span
              className={
                progress.status === "success" ? "text-green-600" :
                progress.status === "failed" ? "text-red-600" :
                progress.status === "partial" ? "text-yellow-600" :
                "text-blue-600"
              }
              data-testid="job-progress-percent"
            >
              {progress.percent}%
            </span>
          </div>
          <Progress
            value={progress.percent}
            className="h-2.5 rounded-full"
            data-testid="job-progress-bar"
          />
        </div>

        {/* 3-step checklist */}
        <div className="flex justify-between">
          {steps.map((step, i) => (
            <div key={step.id} className="flex flex-col items-center gap-1.5 flex-1" data-testid={`job-progress-step-${step.id}`}>
              {/* Connector line (before step 2 and 3) */}
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div className={`flex-1 h-0.5 ${steps[i - 1].completed ? "bg-green-400" : "bg-gray-200"}`} />
                )}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    step.completed
                      ? "bg-green-500 text-white"
                      : progress.step === step.id
                        ? "bg-blue-500 text-white animate-pulse"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                  }`}
                  data-testid={`job-progress-step-icon-${step.id}`}
                >
                  {step.completed ? <Check className="w-3.5 h-3.5" /> : step.icon}
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${step.completed ? "bg-green-400" : "bg-gray-200"}`} />
                )}
              </div>
              <span
                className={`text-xs font-medium ${
                  step.completed ? "text-green-600" :
                  progress.step === step.id ? "text-blue-600" :
                  "text-muted-foreground"
                }`}
                data-testid={`job-progress-step-label-${step.id}`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Status indicator while running */}
        {isRunning && (
          <p className="text-center text-xs text-muted-foreground" data-testid="job-progress-status">
            This may take a moment depending on the number of locations...
          </p>
        )}

        {/* Error reason box — shown when there's a failure message */}
        {isDone && progress.errorMessage && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-300" data-testid="job-error-message">
            <p className="font-medium mb-0.5">Error details</p>
            <p className="leading-snug opacity-90">{progress.errorMessage}</p>
          </div>
        )}

        {/* Action buttons — only shown when complete */}
        {isDone && (
          <div className="flex flex-col gap-2">
            {(progress.status === "failed" || progress.status === "partial") && (
              <Button
                onClick={() => { window.location.href = getApiUrl("/auth/google"); }}
                className="w-full gap-2"
                data-testid="button-reauth-progress"
              >
                <RefreshCw className="w-4 h-4" />
                Re-authenticate with Google
              </Button>
            )}
            <Button
              onClick={handleClose}
              variant={progress.status === "success" ? "default" : "outline"}
              className="w-full"
              data-testid="button-close-progress"
            >
              {progress.status === "success" ? "Done" : "Dismiss"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
