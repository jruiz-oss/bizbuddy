import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiError } from "@/contexts/api-error-context";
import { getApiUrl } from "@/lib/queryClient";

export function ApiErrorModal() {
  const { error, clearApiError } = useApiError();

  if (!error.open) return null;

  const handleReauth = () => {
    window.location.href = getApiUrl("/auth/google");
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      data-testid="api-error-overlay"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={clearApiError}
      />

      {/* Modal */}
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5"
        data-testid="api-error-modal"
      >
        {/* Close button */}
        <button
          onClick={clearApiError}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          data-testid="api-error-close"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50" data-testid="api-error-title">
              {error.title}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 leading-relaxed" data-testid="api-error-message">
              {error.message}
            </p>
          </div>
        </div>

        {/* Helper note */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          This is often caused by an expired Google session. Re-authenticating usually fixes it.
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleReauth}
            className="w-full gap-2"
            data-testid="api-error-reauth-button"
          >
            <RefreshCw className="w-4 h-4" />
            Re-authenticate with Google
          </Button>
          <Button
            variant="ghost"
            onClick={clearApiError}
            className="w-full"
            data-testid="api-error-dismiss-button"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
