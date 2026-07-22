import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useLocalUserContext } from "@/contexts/local-user-context";
import { getApiUrl } from "@/lib/queryClient";

interface AuthStatus {
  authenticated: boolean;
  needsReconnect?: boolean;
  connectedEmail?: string | null;
}

// Global banner shown ONLY when the shared Google connection genuinely needs a
// human to re-run OAuth (refresh token dead). Normal hourly token expiry now
// heals itself server-side, so this should be rare. The message is tailored by
// role so non-admins are told exactly what to do instead of guessing.
export function ReconnectBanner() {
  const { selectedLocalUser } = useLocalUserContext();

  const { data } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    // Poll periodically so the banner clears itself shortly after an admin
    // reconnects, without anyone needing to refresh the page.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (!data?.needsReconnect) return null;

  const canReconnect = selectedLocalUser?.role === "super_admin";
  const account = data.connectedEmail || "the company Google account";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-4 text-sm font-medium"
      data-testid="banner-reconnect-google"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {canReconnect ? (
            <>Google connection for <strong>{account}</strong> expired and needs to be reconnected.</>
          ) : (
            <>Google connection for <strong>{account}</strong> expired. Ask a teammate with Google access (a super admin) to reconnect it — no need to sign out.</>
          )}
        </span>
      </div>

      {canReconnect && (
        <button
          onClick={() => { window.location.href = getApiUrl("/auth/google"); }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-950 text-amber-50 px-3 py-1 hover:opacity-90"
          data-testid="button-reconnect-google"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect Google
        </button>
      )}
    </div>
  );
}
