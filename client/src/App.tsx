import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import CopyReview from "@/pages/copy-review";
import Dashboard from "@/pages/dashboard";
import Locations from "@/pages/locations";
import Jobs from "@/pages/jobs";
import Posts from "@/pages/posts";
import Hours from "@/pages/hours";
import SocialMedia from "@/pages/social-media";
import Reviews from "@/pages/reviews";
import SuggestedEdits from "@/pages/suggested-edits";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import AppleMaps from "@/pages/apple-maps";
import { JobProgressProvider, useJobProgressContext } from "@/contexts/job-progress-context";
import { JobProgressToast } from "@/components/job-progress-toast";
import { LocalUserProvider, useLocalUserContext } from "@/contexts/local-user-context";
import { LocalUserSelectionModal } from "@/components/modals/local-user-selection-modal";
import { FloatingUserButton } from "@/components/floating-user-button";
import { PlatformProvider, usePlatformContext } from "@/contexts/platform-context";
import { PlatformSelectionModal } from "@/components/modals/platform-selection-modal";
import { PlatformSwitchButton } from "@/components/platform-switch-button";
import { ApiErrorProvider } from "@/contexts/api-error-context";
import { ApiErrorModal } from "@/components/api-error-modal";
import { ReconnectBanner } from "@/components/reconnect-banner";
import { Terminal } from "lucide-react";

interface RouterProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

function AuthenticatedApp({ selectedClientId, setSelectedClientId }: RouterProps) {
  const { currentJobId, jobType } = useJobProgressContext();
  const { showSelectionModal, selectedLocalUser } = useLocalUserContext();
  const { platform, showPlatformModal } = usePlatformContext();
  const [, setLocation] = useLocation();
  const [devMode, setDevMode] = useState(() => localStorage.getItem("bizbuddy_devmode") === "true");

  // Keep devMode in sync when settings page toggles it
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setDevMode(detail);
    };
    window.addEventListener("bizbuddy-devmode-change", handler);
    return () => window.removeEventListener("bizbuddy-devmode-change", handler);
  }, []);

  useEffect(() => {
    if (platform === "apple") {
      setLocation("/apple-maps");
    } else {
      const currentPath = window.location.pathname;
      if (currentPath === "/apple-maps") {
        setLocation("/");
      }
    }
  }, [platform, setLocation]);

  // Block access to the app until a user is logged in
  if (!selectedLocalUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LocalUserSelectionModal open={showSelectionModal} />
      </div>
    );
  }

  return (
    <>
      {/* Global Developer Mode Banner — persists across all pages */}
      {devMode && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-400 text-amber-950 px-4 py-1.5 flex items-center justify-between text-xs font-medium" data-testid="banner-developer-mode">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>Developer Mode active — Google auth can be revoked independently. Log out &amp; re-authenticate to fully reset.</span>
          </div>
          <button
            onClick={() => {
              localStorage.setItem("bizbuddy_devmode", "false");
              setDevMode(false);
              window.dispatchEvent(new CustomEvent("bizbuddy-devmode-change", { detail: false }));
            }}
            className="ml-4 underline underline-offset-2 hover:opacity-70 shrink-0"
            data-testid="button-disable-devmode-banner"
          >
            Disable
          </button>
        </div>
      )}

      <ReconnectBanner />
      <LocalUserSelectionModal open={showSelectionModal} />
      <PlatformSelectionModal open={showPlatformModal} />
      <FloatingUserButton />

      <div className={devMode ? "pt-9" : ""}>
      <Switch>
        <Route path="/" component={() => <Dashboard selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/dashboard" component={() => <Dashboard selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/locations" component={() => <Locations selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/posts" component={() => <Posts selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/hours" component={() => <Hours selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/social-media" component={() => <SocialMedia selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/reviews" component={() => <Reviews selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/suggested-edits" component={() => <SuggestedEdits selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/jobs" component={() => <Jobs selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/settings" component={() => <Settings selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />} />
        <Route path="/apple-maps" component={() => <AppleMaps />} />
        <Route component={NotFound} />
      </Switch>
      </div>

      {/* Global Job Progress Toast - stays visible across all tabs */}
      {currentJobId && jobType && (
        <JobProgressToast
          jobId={currentJobId}
          jobType={jobType}
        />
      )}
    </>
  );
}

function AppContent() {
  // Global client selection state - persists across navigation
  // Default to Commit Agency (most commonly used)
  const [selectedClientId, setSelectedClientId] = useState<string>("105017238673904546543");

  // Check authentication status
  const { data: authStatus, isLoading } = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/auth/status"],
    retry: 1,
  });

  // Public route — accessible without auth (linked from review emails)
  if (window.location.pathname === "/copy-review") {
    return <CopyReview />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  const devMode = localStorage.getItem("bizbuddy_devmode") === "true";

  if (!authStatus?.authenticated && !devMode) {
    return <Login />;
  }

  return <AuthenticatedApp selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />;
}

function App() {
  useEffect(() => {
    // Fix for Radix UI/react-remove-scroll incorrectly thinking a Dialog/Sheet is open
    // This resets pointer-events and aria-hidden that may be incorrectly applied on mount
    document.body.style.pointerEvents = "";
    const root = document.getElementById("root");
    if (root) {
      root.removeAttribute("aria-hidden");
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiErrorProvider>
        <JobProgressProvider>
          <LocalUserProvider>
            <PlatformProvider>
              <TooltipProvider>
                <Toaster />
                <ApiErrorModal />
                <AppContent />
              </TooltipProvider>
            </PlatformProvider>
          </LocalUserProvider>
        </JobProgressProvider>
      </ApiErrorProvider>
    </QueryClientProvider>
  );
}

export default App;
