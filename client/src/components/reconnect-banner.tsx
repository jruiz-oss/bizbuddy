import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { getApiUrl } from "@/lib/queryClient";

interface AuthStatus {
  authenticated: boolean;
  needsReconnect?: boolean;
  connectedEmail?: string | null;
}

// Global banner shown ONLY when the shared Google connection genuinely needs a
// human to re-run OAuth (refresh token dead). Normal hourly token expiry now
// heals itself server-side, so this should be rare. Reconnecting just re-runs
// OAuth against the one shared agency Google account (which the whole team
// has the password to), so anyone can do it — this isn't gated by local-user
// role, and the message doesn't call out any one person's account.
export function ReconnectBanner() {
  const { data } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    // Poll periodically so the banner clears itself shortly after someone
    // reconnects, without anyone needing to refresh the page.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (!data?.needsReconnect) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-4 text-sm font-medium"
      data-testid="banner-reconnect-google"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          The shared Google connection expired and needs to be reconnected.
        </span>
      </div>

      <button
        onClick={() => { window.location.href = getApiUrl("/auth/google"); }}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-950 text-amber-50 px-3 py-1 hover:opacity-90"
        data-testid="button-reconnect-google"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Reconnect Google
      </button>
    </div>
  );
}

// Same signal, shown on the login/profile-picker screen — where nobody is
// signed in yet. Everyone can still log in normally; this just explains why
// Google-touching actions may fail and lets anyone fix it before signing in.
export function GoogleConnectionNotice() {
  const { data } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    refetchInterval: 60_000,
  });

  if (data?.authenticated && !data?.needsReconnect) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-md w-[calc(100%-2rem)] rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex items-start gap-2"
      data-testid="notice-google-connection"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p>
          The shared Google connection needs to be reconnected. You can still
          sign in — posting, hours and syncing will fail until it's fixed.
        </p>
        <a
          href="/connect-google"
          className="mt-1 inline-flex items-center gap-1.5 underline underline-offset-2 font-medium"
          data-testid="link-connect-google"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect Google
        </a>
      </div>
    </div>
  );
}
