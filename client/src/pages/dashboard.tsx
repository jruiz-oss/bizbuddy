import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useLocalUserContext } from "@/contexts/local-user-context";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SideNav } from "@/components/SideNav";
import {
  AlertTriangle, CheckCircle2, Clock, CalendarClock, Mail,
  FileText, Share2, History, Undo2, Plus,
  XCircle, X, Building2, ChevronRight, ChevronDown, RefreshCw, MapPin, User, ExternalLink, RotateCcw,
  Phone, MousePointerClick, Eye, Star, Bell, Edit3, ListFilter, ArrowUpRight, ArrowDownRight,
  MessageSquare, TrendingUp, TrendingDown,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip } from "recharts";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import { apiRequest, queryClient, getApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import type { Client, ClientLocation, Job } from "@shared/schema";

interface DashboardProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

function computeNextEmailSend(group: any): Date | null {
  if (!group.isEnabled) return null;
  const PHOENIX_OFFSET = 7 * 60 * 60 * 1000;
  const now = new Date();
  const phoenixNow = new Date(now.getTime() - PHOENIX_OFFSET);
  const targetDay = parseInt(group.emailDay, 10);
  const [hour, minute] = (group.emailTime || "09:00").split(":").map(Number);
  const currentDay = phoenixNow.getUTCDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;
  if (daysUntil === 0) {
    const nowMins = phoenixNow.getUTCHours() * 60 + phoenixNow.getUTCMinutes();
    if (nowMins >= hour * 60 + minute) daysUntil = 7;
  }
  const candidate = new Date(phoenixNow);
  candidate.setUTCDate(candidate.getUTCDate() + daysUntil);
  candidate.setUTCHours(hour, minute, 0, 0);
  const candidateUTC = new Date(candidate.getTime() + PHOENIX_OFFSET);
  if (group.frequency === "biweekly") {
    const anchor = group.lastEmailSentAt
      ? new Date(group.lastEmailSentAt)
      : group.startDate
        ? new Date(group.startDate + "T00:00:00Z")
        : null;
    if (anchor) {
      // Check whether the CANDIDATE date itself is an off-week from the anchor.
      // Using the candidate (not "now") avoids double-advancing when checked on
      // an off-week day after the scheduled time has already passed.
      const daysCandidateFromAnchor = (candidateUTC.getTime() - anchor.getTime()) / 86400000;
      const weekIndex = Math.round(daysCandidateFromAnchor / 7);
      if (weekIndex % 2 === 1) {
        // Candidate is on an off-week — push forward to the next on-week
        candidateUTC.setDate(candidateUTC.getDate() + 7);
      }
    }
  }
  if (group.startDate) {
    const start = new Date(group.startDate + "T12:00:00");
    if (candidateUTC < start) {
      let d = new Date(start);
      while (d.getDay() !== targetDay) d = new Date(d.getTime() + 86400000);
      d.setHours(hour, minute, 0, 0);
      return d;
    }
  }
  return candidateUTC;
}

// Deterministic pseudo-random series for sparklines / chart placeholders

export default function Dashboard({
  selectedClientId,
  setSelectedClientId,
}: DashboardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const { selectedLocalUser } = useLocalUserContext();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showMissingDataDialog, setShowMissingDataDialog] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<any | null>(null);
  const [activityPeriod, setActivityPeriod] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { data: dismissedData } = useQuery<{ jobs: string[]; activity: string[] }>({
    queryKey: ["/api/dashboard/dismissed"],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/dashboard/dismissed?_t=${Date.now()}`), { cache: "no-store", credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch dismissed items");
      return r.json();
    },
    staleTime: 0,
  });

  const dismissedJobIds = useMemo(
    () => new Set<string>(dismissedData?.jobs ?? []),
    [dismissedData?.jobs],
  );
  const dismissedActivityIds = useMemo(
    () => new Set<string>(dismissedData?.activity ?? []),
    [dismissedData?.activity],
  );

  const dismissMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "job" | "activity"; id: string }) => {
      return apiRequest("POST", "/api/dashboard/dismissed", { type, id });
    },
    onMutate: async ({ type, id }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/dashboard/dismissed"] });
      const prev = queryClient.getQueryData<{ jobs: string[]; activity: string[] }>(["/api/dashboard/dismissed"]);
      queryClient.setQueryData<{ jobs: string[]; activity: string[] }>(
        ["/api/dashboard/dismissed"],
        {
          jobs: type === "job" ? [...(prev?.jobs ?? []), id] : (prev?.jobs ?? []),
          activity: type === "activity" ? [...(prev?.activity ?? []), id] : (prev?.activity ?? []),
        },
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/dashboard/dismissed"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/dismissed"] });
    },
  });

  const dismissJob = (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dismissMutation.mutate({ type: "job", id: jobId });
  };
  const dismissActivity = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dismissMutation.mutate({ type: "activity", id });
  };

  const revertLocationInfoMutation = useMutation({
    mutationFn: async (activityId: string) => {
      const r = await fetch(getApiUrl(`/api/activity-log/${activityId}/revert-location-info`), { method: "POST", credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to revert");
      }
      return r.json() as Promise<{ success: boolean; message: string; skippedFields: string[] }>;
    },
    onSuccess: (data) => {
      toast({ title: "Reverted successfully", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      setSelectedActivity(null);
    },
    onError: (err: Error) => {
      toast({ title: "Revert failed", description: err.message, variant: "destructive" });
    },
  });
  const [selectedUpcoming, setSelectedUpcoming] = useState<
    | { type: "post"; job: any }
    | { type: "email"; data: any }
    | { type: "sync"; settings: any }
    | null
  >(null);

  const upcomingPostJobId = selectedUpcoming?.type === "post" ? selectedUpcoming.job.id : null;
  const { data: upcomingJobDetail } = useQuery<any>({
    queryKey: [`/api/jobs/${upcomingPostJobId}`],
    enabled: !!upcomingPostJobId,
  });

  const activityJobId = selectedActivity?.payloadJson?.jobId ?? null;
  const { data: activityJob, isLoading: activityJobLoading } = useQuery<any>({
    queryKey: [`/api/jobs/${activityJobId}`],
    enabled: !!activityJobId,
  });

  const {
    data: clients = [],
    isError: isClientsError,
    error: clientsError,
  } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const {
    data: locations = [],
    isError: isLocationsError,
    error: locationsError,
  } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  // A 401 here (expired/missing session) and a client that genuinely has zero
  // locations both resolve to an empty array — surface the real reason instead
  // of letting the dashboard render a silent, unexplained blank state.
  useEffect(() => {
    const failedQuery = isClientsError ? clientsError : isLocationsError ? locationsError : null;
    if (!failedQuery) return;
    const rawMessage = failedQuery instanceof Error ? failedQuery.message : String(failedQuery);
    const isAuthError = /^401\b/.test(rawMessage) || /authentication required/i.test(rawMessage);
    showApiError(
      isAuthError ? "Session expired" : "Couldn't load dashboard data",
      isAuthError
        ? "Your session has expired. Please log in again."
        : `Failed to load dashboard data: ${parseApiError(failedQuery)}`,
    );
  }, [isClientsError, clientsError, isLocationsError, locationsError, showApiError]);

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs", selectedClientId],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/jobs?client_id=${selectedClientId}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch jobs");
      return r.json();
    },
    enabled: !!selectedClientId,
  });

  const { data: activityLog = [] } = useQuery<any[]>({
    queryKey: ["/api/activity-log", selectedClientId],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/activity-log?client_id=${selectedClientId}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch activity log");
      return r.json();
    },
    enabled: !!selectedClientId,
    staleTime: 0,
  });

  const { data: emailGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/review-email-groups"],
  });

  const { data: userSettings } = useQuery<any>({
    queryKey: ["/api/user/settings"],
  });

  // Map the top-bar period toggle to the days param sent to the performance API
  const perfDays = activityPeriod === "7d" ? 7 : activityPeriod === "90d" ? 90 : 30;

  // Bulk call counts per location for the Top Locations leaderboard (with previous period for trend)
  const { data: callCountsData } = useQuery<{ counts: Record<string, number>; previous?: Record<string, number>; days: number }>({
    queryKey: ["/api/locations/call-counts", perfDays],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/locations/call-counts?days=${perfDays}&compare=true`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch call counts");
      return r.json();
    },
  });

  // Real GBP performance metrics (calls / website clicks / impressions / avg rating)
  const { data: perfData, isLoading: perfLoading } = useQuery<{
    totals: { callClicks: number; websiteClicks: number; directionRequests: number; impressions: number };
    previous: { callClicks: number; websiteClicks: number; directionRequests: number; impressions: number };
    avgRating: number | null;
    ratedLocationCount: number;
    locationCount: number;
    daily: Array<{ date: string; callClicks: number; websiteClicks: number; directionRequests: number; impressions: number }>;
  }>({
    queryKey: ["/api/clients", selectedClientId, "performance", perfDays],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/clients/${selectedClientId}/performance?days=${perfDays}&_t=${Date.now()}`), { cache: "no-store", credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch performance");
      return r.json();
    },
    enabled: !!selectedClientId,
  });

  const { data: selectedJobDetail } = useQuery<any>({
    queryKey: ["/api/jobs", selectedJob?.id, "detail"],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/jobs/${selectedJob!.id}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch job detail");
      return r.json();
    },
    enabled: !!selectedJob,
    staleTime: 30000,
  });

  const undoMutation = useMutation({
    mutationFn: async (jobId: string) =>
      apiRequest("POST", `/api/jobs/${jobId}/undo`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedJob(null);
      toast({ title: "Job undone successfully" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to undo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const totalLocations = locations.length;
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const partialJobs = jobs.filter((j) => j.status === "partial");
  const locationsWithMissingData = locations.filter(
    (l) => !l.address || !(l as any).phone
  );

  const upcomingPosts = jobs
    .filter((j) => (j as any).isScheduled && j.status === "scheduled")
    .sort((a, b) => {
      const da = (a as any).scheduledDate ? new Date((a as any).scheduledDate).getTime() : 0;
      const db = (b as any).scheduledDate ? new Date((b as any).scheduledDate).getTime() : 0;
      return da - db;
    })
    .slice(0, 3);

  const nextEmails = emailGroups
    .filter((g) => g.isEnabled)
    .map((g) => ({ group: g, next: computeNextEmailSend(g) }))
    .filter((x) => x.next !== null)
    .sort((a, b) => (a.next?.getTime() || 0) - (b.next?.getTime() || 0));

  const nextEmail = nextEmails[0] || null;

  const getJobTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      hours: "Hours Update",
      posts: "Post Publish",
      social: "Social Links",
      photo: "Photo Upload",
      location: "Location Update",
    };
    return (map[type] || type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " "));
  };

  const getJobTypeIcon = (type: string) => {
    switch (type) {
      case "hours": return <Clock className="w-4 h-4" />;
      case "posts": return <FileText className="w-4 h-4" />;
      case "social": return <Share2 className="w-4 h-4" />;
      default: return <Building2 className="w-4 h-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-100 text-green-700 border-green-200 border">Success</Badge>;
      case "partial":
        return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 border">Partial</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-red-700 border-red-200 border">Failed</Badge>;
      case "running":
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200 border">Running</Badge>;
      case "queued":
        return <Badge className="bg-gray-100 text-gray-600 border-gray-200 border">Queued</Badge>;
      case "scheduled":
        return <Badge className="bg-purple-100 text-purple-700 border-purple-200 border">Scheduled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canUndo = (status: string) => ["success", "partial"].includes(status);

  const retryPageMap: Record<string, string> = {
    posts: "/posts",
    hours: "/hours",
    social: "/social-media",
    photo: "/posts",
    location: "/locations",
  };

  const handleRetry = () => {
    if (!selectedJob) return;
    const type = (selectedJob as any).type as string;
    const detail = selectedJobDetail;
    const items: any[] = detail?.items || [];
    const firstItem = items[0];
    const postData = firstItem?.payload?.postData;
    const locationIds = items.map((i: any) => i.clientLocationId ?? i.locationId).filter(Boolean);

    if (type === "posts") {
      const retryData = {
        content: postData?.summary ?? detail?.payloadJson?.summary ?? "",
        imageUrl: detail?.payloadJson?.imageUrl ?? postData?.media?.[0]?.sourceUrl ?? "",
        ctaType: postData?.callToAction?.actionType ?? "",
        ctaUrl: postData?.callToAction?.url ?? "",
        locationIds,
      };
      sessionStorage.setItem("postRetryData", JSON.stringify(retryData));
    }

    setSelectedJob(null);
    navigate(retryPageMap[type] ?? "/");
  };

  const formatActivityAction = (action: string) => {
    const map: Record<string, string> = {
      bulk_social_media_updated: "Social links updated",
      hours_updated_in_app: "Hours updated",
      regular_hours_updated_in_app: "Regular hours updated",
      special_hours_updated_in_app: "Special hours updated",
      post_created_in_app: "Post created",
      photos_uploaded_in_app: "Photos uploaded",
      location_details_updated: "Location details updated",
      location_info_changed: "Location info changed by Google",
      review_email_sent: "Review email sent",
    };
    return map[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // ── Build the unified "Needs your attention" list from real data ──────────
  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      severity: "high" | "medium" | "low";
      title: string;
      subtitle: string;
      actionLabel: string;
      onClick: () => void;
      onDismiss?: (e: React.MouseEvent) => void;
    }> = [];

    // Failed jobs → Fix
    failedJobs
      .filter((j) => !dismissedJobIds.has(j.id))
      .forEach((job) => {
        const t = (job as any).type as string;
        const labelMap: Record<string, string> = {
          hours: "Hours update failed",
          posts: "Post failed to publish",
          social: "Social links failed to update",
          photo: "Photo upload failed",
          location: "Location update failed",
        };
        items.push({
          id: `job-${job.id}`,
          severity: "high",
          title: labelMap[t] || "A job failed",
          subtitle: `All locations failed · ${formatPhoenixDateTime(job.createdAt)}`,
          actionLabel: "Fix",
          onClick: () => setSelectedJob(job),
          onDismiss: (e) => dismissJob(job.id, e),
        });
      });

    // Partial jobs → Review
    partialJobs
      .filter((j) => !dismissedJobIds.has(j.id))
      .forEach((job) => {
        const t = (job as any).type as string;
        const labelMap: Record<string, string> = {
          hours: "Hours update partially failed",
          posts: "Post partially published",
          social: "Social links partially updated",
          photo: "Photo upload partially failed",
          location: "Location update partially failed",
        };
        items.push({
          id: `job-${job.id}`,
          severity: "medium",
          title: labelMap[t] || "A job partially failed",
          subtitle: `${(job as any).errorCount ?? "?"} of ${(job as any).totalItems ?? "?"} locations failed · ${formatPhoenixDateTime(job.createdAt)}`,
          actionLabel: "Review",
          onClick: () => setSelectedJob(job),
          onDismiss: (e) => dismissJob(job.id, e),
        });
      });

    // Location info changed by Google → Review
    (activityLog as any[])
      .filter((e) => e.action === "location_info_changed" && !dismissedActivityIds.has(e.id))
      .slice(0, 10)
      .forEach((entry) => {
        const changes = entry.payloadJson?.changes ?? [];
        const fields = changes.map((c: any) => c.field.replace(/_/g, " ")).join(", ");
        const loc = locations.find((l) => l.id === entry.clientLocationId);
        const locName = loc?.name ?? "A location";
        items.push({
          id: `activity-${entry.id}`,
          severity: "medium",
          title: `Unauthorized edit on ${locName}`,
          subtitle: `${fields || "Details changed"} by Google · ${formatPhoenixDateTime(entry.timestamp)}`,
          actionLabel: "Review",
          onClick: () => setSelectedActivity(entry),
          onDismiss: (e) => dismissActivity(entry.id, e),
        });
      });

    // Locations with missing data → Edit
    if (locationsWithMissingData.length > 0) {
      items.push({
        id: "missing-data",
        severity: "medium",
        title: `${locationsWithMissingData.length} location${locationsWithMissingData.length !== 1 ? "s" : ""} with missing info`,
        subtitle: "Address or phone fields are empty",
        actionLabel: "Edit",
        onClick: () => setShowMissingDataDialog(true),
      });
    }

    // Sort by severity (high first)
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity]);
    return items;
  }, [failedJobs, partialJobs, activityLog, dismissedJobIds, dismissedActivityIds, locations, locationsWithMissingData]);

  // Recent activity, capped to most recent 4
  const recentActivity = useMemo(() => {
    return (activityLog as any[]).slice(0, 4);
  }, [activityLog]);

  // Top locations: ranked by real GBP call click counts for the selected period
  const topLocations = useMemo(() => {
    const counts = callCountsData?.counts ?? {};
    const previous = callCountsData?.previous ?? {};
    return [...locations]
      .map((loc) => {
        const value = counts[loc.id] ?? 0;
        const prev = previous[loc.id] ?? 0;
        const hasPrevious = !!callCountsData?.previous;
        // trend: percentage change vs previous period; null means no prior data available
        let trend: number | null = null;
        let isNew = false;
        if (hasPrevious) {
          if (prev === 0 && value === 0) {
            trend = 0;
          } else if (prev === 0 && value > 0) {
            // First calls this location has had — mark distinctly rather than show a misleading %
            isNew = true;
          } else {
            trend = Math.round(((value - prev) / prev) * 100);
          }
        }
        return { id: loc.id, name: loc.name, value, trend, isNew };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [locations, callCountsData]);
  const topLocationsMax = Math.max(1, topLocations[0]?.value ?? 0);

  // Greeting — prefer the currently selected team member, fall back to the
  // account name from settings, then to a neutral "there".
  const firstName =
    selectedLocalUser?.name?.split(" ")[0] ||
    (userSettings?.name as string | undefined)?.split(" ")[0] ||
    "there";
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5)  return "Good evening";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
  })();

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const clientLabel = selectedClient?.name || "All locations";

  const periodLabel =
    activityPeriod === "7d" ? "Last 7 days" :
    activityPeriod === "30d" ? "Last 30 days" :
    activityPeriod === "90d" ? "Last 90 days" :
    (customStart && customEnd) ? `${customStart} – ${customEnd}` : "Custom range";

  // Filtered activity log for the dialog filter
  const filteredActivityLog = activityLog.filter((entry: any) => {
    const ts = new Date(entry.timestamp);
    if (activityPeriod === "custom") {
      if (customStart && ts < new Date(customStart + "T00:00:00")) return false;
      if (customEnd && ts > new Date(customEnd + "T23:59:59")) return false;
      return true;
    }
    const days = activityPeriod === "7d" ? 7 : activityPeriod === "90d" ? 90 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return ts >= cutoff;
  });

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />
      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">HOME</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">
                Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    data-testid="button-period"
                  >
                    {periodLabel}
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setActivityPeriod("7d")}>Last 7 days</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActivityPeriod("30d")}>Last 30 days</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActivityPeriod("90d")}>Last 90 days</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {clients.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      data-testid="select-client"
                    >
                      <MapPin className="w-3.5 h-3.5 text-gray-500" />
                      {clientLabel}
                      <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {clients.map((client) => (
                      <DropdownMenuItem
                        key={client.id}
                        onClick={() => setSelectedClientId(client.id)}
                        data-testid={`client-option-${client.id}`}
                      >
                        {client.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                className="p-2 rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                data-testid="button-notifications"
              >
                <Bell className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Greeting */}
          <div className="flex flex-wrap items-baseline gap-x-2 px-1">
            <span className="text-[15px] font-semibold text-gray-900">
              {greeting}, {firstName}.
            </span>
            <span className="text-[15px] text-gray-500">
              Here's what changed across your{" "}
              <strong className="font-semibold text-gray-700">
                {totalLocations} location{totalLocations !== 1 ? "s" : ""}
              </strong>{" "}
              this week.
            </span>
          </div>

          {/* KPI cards — real data sourced from cached GBP performance */}
          {(() => {
            const t = perfData?.totals;
            const p = perfData?.previous;
            const daily = perfData?.daily ?? [];

            const fmtNum = (n: number) => {
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
              return n.toLocaleString();
            };
            const pctDelta = (curr?: number, prev?: number) => {
              if (curr == null || prev == null) return { text: "—", trend: undefined as "up" | "down" | undefined };
              if (prev === 0) {
                if (curr === 0) return { text: "0%", trend: undefined };
                return { text: "new", trend: "up" as const };
              }
              const pct = ((curr - prev) / prev) * 100;
              const rounded = Math.round(pct);
              return {
                text: `${rounded > 0 ? "+" : ""}${rounded}%`,
                trend: rounded > 0 ? ("up" as const) : rounded < 0 ? ("down" as const) : undefined,
              };
            };
            // Google lags 2-3 days: find the last day with any data so we can
            // compare apples-to-apples (scale the previous period down to the
            // same number of "live" days instead of comparing 27 days vs 30).
            const activeDays = (() => {
              let last = -1;
              for (let i = 0; i < daily.length; i++) {
                const d = daily[i];
                if (d.callClicks + d.websiteClicks + d.directionRequests + d.impressions > 0) last = i;
              }
              return last >= 0 ? last + 1 : daily.length;
            })();
            const lagRatio = daily.length > 0 ? activeDays / daily.length : 1;

            // Adjust prior-period totals to match the active window length
            const adjPrev = p ? {
              callClicks:    p.callClicks    * lagRatio,
              websiteClicks: p.websiteClicks * lagRatio,
              impressions:   p.impressions   * lagRatio,
            } : undefined;

            const callsDelta  = pctDelta(t?.callClicks,    adjPrev?.callClicks);
            const clicksDelta = pctDelta(t?.websiteClicks, adjPrev?.websiteClicks);
            const viewsDelta  = pctDelta(t?.impressions,   adjPrev?.impressions);

            // Trim trailing days with no data so sparklines don't drop to zero
            // for days Google hasn't published yet (2-3 day lag)
            let lastLiveIdx = -1;
            for (let i = daily.length - 1; i >= 0; i--) {
              const d = daily[i];
              if (d.callClicks + d.websiteClicks + d.directionRequests + d.impressions > 0) {
                lastLiveIdx = i;
                break;
              }
            }
            const liveDays = lastLiveIdx >= 0 ? daily.slice(0, lastLiveIdx + 1) : daily;
            const lastLiveDate = lastLiveIdx >= 0 ? daily[lastLiveIdx].date : null;

            const callsSpark  = liveDays.map((d) => d.callClicks);
            const clicksSpark = liveDays.map((d) => d.websiteClicks);
            const viewsSpark  = liveDays.map((d) => d.impressions);

            const fmtLiveDate = (iso: string) => {
              const [, m, d] = iso.split("-");
              const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              return `${months[parseInt(m) - 1]} ${parseInt(d)}`;
            };

            return (
              <div className="space-y-1.5">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard
                  dark
                  label="LOCATIONS"
                  value={totalLocations.toLocaleString()}
                  icon={<MapPin className="w-3.5 h-3.5" />}
                  testId="kpi-locations"
                />
                <KpiCard
                  label="CALLS"
                  value={t ? fmtNum(t.callClicks) : "—"}
                  delta={callsDelta.text}
                  trend={callsDelta.trend}
                  icon={<Phone className="w-3.5 h-3.5" />}
                  data={callsSpark}
                  emptyLabel={perfLoading ? "Loading…" : !t ? "No data" : undefined}
                  testId="kpi-calls"
                />
                <KpiCard
                  label="CLICKS"
                  value={t ? fmtNum(t.websiteClicks) : "—"}
                  delta={clicksDelta.text}
                  trend={clicksDelta.trend}
                  icon={<MousePointerClick className="w-3.5 h-3.5" />}
                  data={clicksSpark}
                  emptyLabel={perfLoading ? "Loading…" : !t ? "No data" : undefined}
                  testId="kpi-clicks"
                />
                <KpiCard
                  label="PROFILE VIEWS"
                  value={t ? fmtNum(t.impressions) : "—"}
                  delta={viewsDelta.text}
                  trend={viewsDelta.trend}
                  icon={<Eye className="w-3.5 h-3.5" />}
                  data={viewsSpark}
                  emptyLabel={perfLoading ? "Loading…" : !t ? "No data" : undefined}
                  testId="kpi-views"
                />
                <KpiCard
                  label="AVG RATING"
                  value={perfData?.avgRating != null ? perfData.avgRating.toFixed(1) : "—"}
                  delta={perfData?.ratedLocationCount != null ? `${perfData.ratedLocationCount} rated` : ""}
                  icon={<Star className="w-3.5 h-3.5" />}
                  testId="kpi-rating"
                />
              </div>
              {lastLiveDate && (
                <p className="text-[11px] text-gray-400 px-1" data-testid="text-data-freshness">
                  Google data through {fmtLiveDate(lastLiveDate)} · updates nightly
                </p>
              )}
              </div>
            );
          })()}

          {/* Two-column section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Left column: Needs your attention + Upcoming activity stacked */}
            <div className="space-y-4">

              {/* Needs your attention */}
              <Card className="border-gray-200 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-gray-900">Needs your attention</h2>
                      {attentionItems.length > 0 && (
                        <span className="bg-orange-100 text-orange-600 text-[11px] font-semibold px-1.5 min-w-[20px] h-5 inline-flex items-center justify-center rounded-full">
                          {attentionItems.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <button className="flex items-center gap-1 hover:text-gray-800 transition-colors" data-testid="button-attention-filter">
                        <ListFilter className="w-3.5 h-3.5" />
                        Filter
                      </button>
                      <button className="flex items-center gap-1 hover:text-gray-800 transition-colors" data-testid="button-attention-sort">
                        Sort: severity
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-3 pt-0">
                  {attentionItems.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-gray-500 flex items-center gap-2 justify-center">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      All clear — no actions required right now.
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-gray-100">
                        {attentionItems.slice(0, 4).map((item) => (
                          <AttentionRow
                            key={item.id}
                            severity={item.severity}
                            title={item.title}
                            subtitle={item.subtitle}
                            actionLabel={item.actionLabel}
                            onClick={item.onClick}
                            onDismiss={item.onDismiss}
                          />
                        ))}
                      </div>
                      {attentionItems.length > 4 && (
                        <button
                          onClick={() => navigate("/jobs")}
                          className="w-full text-center text-xs text-gray-500 hover:text-gray-800 transition-colors py-2 border-t border-gray-100"
                          data-testid="link-view-all-attention"
                        >
                          View all {attentionItems.length} items
                        </button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Upcoming activity */}
              <Card className="border-gray-200 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold text-gray-900">Upcoming activity</h2>
                    {(upcomingPosts.length + nextEmails.length + (userSettings?.nextLocationSyncAt ? 1 : 0)) > 0 && (
                      <span className="text-xs text-gray-400">
                        {upcomingPosts.length + nextEmails.length + (userSettings?.nextLocationSyncAt ? 1 : 0)} scheduled
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-3 pt-0">
                  {(upcomingPosts.length === 0 && nextEmails.length === 0 && !userSettings?.nextLocationSyncAt) ? (
                    <div className="px-3 py-6 text-sm text-gray-500 flex items-center gap-2 justify-center">
                      <CalendarClock className="w-4 h-4 text-gray-400" />
                      Nothing scheduled.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {upcomingPosts.map((job) => {
                        const sched = (job as any).scheduledDate;
                        const time = (job as any).scheduledTime || "00:00";
                        const when = sched
                          ? new Date(`${sched.toString().split("T")[0]}T${time}:00`)
                          : null;
                        const itemCount = (job as any).items?.length ?? (job as any).totalCount ?? 0;
                        return (
                          <UpcomingRow
                            key={job.id}
                            icon={<MessageSquare className="w-3.5 h-3.5" />}
                            tone="blue"
                            kicker="Scheduled post"
                            title={(job as any).payloadJson?.title || (job as any).payloadJson?.summary || "Post"}
                            when={when}
                            sub={itemCount > 0 ? `${itemCount} location${itemCount === 1 ? "" : "s"}` : null}
                            onClick={() => setSelectedUpcoming({ type: "post", job })}
                            testId={`upcoming-post-${job.id}`}
                          />
                        );
                      })}
                      {nextEmails.map((emailItem) => (
                        <UpcomingRow
                          key={emailItem.group.id}
                          icon={<Mail className="w-3.5 h-3.5" />}
                          tone="purple"
                          kicker="Review email"
                          title={emailItem.group.name || "Review summary"}
                          when={emailItem.next}
                          sub={emailItem.group.recipients ? `to ${emailItem.group.recipients}` : null}
                          onClick={() => setSelectedUpcoming({ type: "email", data: emailItem })}
                          testId={`upcoming-email-${emailItem.group.id}`}
                        />
                      ))}
                      {userSettings?.nextLocationSyncAt && (
                        <UpcomingRow
                          icon={<RefreshCw className="w-3.5 h-3.5" />}
                          tone="green"
                          kicker="Auto-sync"
                          title="Location sync from Google"
                          when={new Date(userSettings.nextLocationSyncAt)}
                          sub={userSettings.lastLocationSyncAt ? `Last synced ${formatPhoenixDateTime(userSettings.lastLocationSyncAt)}` : "Never synced"}
                          onClick={() => setSelectedUpcoming({ type: "sync", settings: userSettings })}
                          testId="upcoming-location-sync"
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>

            {/* Right column: Bulk actions + Recent activity stacked */}
            <div className="space-y-4">
              {/* Bulk actions */}
              <Card className="border-gray-200 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold text-gray-900">Bulk actions</h2>
                    <span className="text-xs text-gray-400">
                      {totalLocations} location{totalLocations !== 1 ? "s" : ""}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-0 grid grid-cols-2 gap-2.5">
                  <BulkBtn
                    primary
                    icon={<Plus className="w-4 h-4" />}
                    label="Create post"
                    onClick={() => navigate("/posts")}
                    testId="button-bulk-create-post"
                  />
                  <BulkBtn
                    icon={<Clock className="w-4 h-4" />}
                    label="Update hours"
                    onClick={() => navigate("/hours")}
                    testId="button-bulk-update-hours"
                  />
                  <BulkBtn
                    icon={<Share2 className="w-4 h-4" />}
                    label="Social links"
                    onClick={() => navigate("/social-media")}
                    testId="button-bulk-social-links"
                  />
                  <BulkBtn
                    icon={<Edit3 className="w-4 h-4" />}
                    label="Edit info"
                    onClick={() => navigate("/locations")}
                    testId="button-bulk-edit-info"
                  />
                </CardContent>
              </Card>

              {/* Recent activity */}
              <Card className="border-gray-200 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold text-gray-900">Recent activity</h2>
                    <button
                      onClick={() => navigate("/jobs")}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                      data-testid="link-view-all-activity"
                    >
                      View all
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-3 pt-0">
                  {recentActivity.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500">No activity yet.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {recentActivity.map((entry: any) => (
                        <ActivityRow
                          key={entry.id}
                          entry={entry}
                          label={formatActivityAction(entry.action)}
                          onClick={() => setSelectedActivity(entry)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bottom row: Performance + Top locations */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Performance */}
            <Card className="border-gray-200 shadow-sm rounded-2xl lg:col-span-2">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-gray-900">Performance</h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">daily · last {perfDays} days</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1f3a5f]" />
                      Calls
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#e8a456]" />
                      Clicks
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-4 pt-0">
                <div className="h-[230px] w-full">
                  {(() => {
                    // Build the chart data; Google's Performance API runs ~2-3 days behind,
                    // so trim any trailing days that have no reported data yet.
                    const raw = perfData?.daily && perfData.daily.length > 0
                      ? perfData.daily.map((d) => ({
                          date: d.date,
                          calls: d.callClicks,
                          clicks: d.websiteClicks,
                          views: d.impressions,
                        }))
                      : null;
                    let chart = raw;
                    if (raw) {
                      let lastWithData = -1;
                      for (let i = raw.length - 1; i >= 0; i--) {
                        if ((raw[i].calls + raw[i].clicks + raw[i].views) > 0) {
                          lastWithData = i;
                          break;
                        }
                      }
                      chart = lastWithData >= 0 ? raw.slice(0, lastWithData + 1) : raw;
                    }
                    const hasChartData = chart && chart.some((d) => d.calls + d.clicks + d.views > 0);
                    if (!hasChartData) {
                      return (
                        <div className="h-full flex items-center justify-center" data-testid="perf-chart-empty">
                          <p className="text-sm text-gray-400">
                            {perfLoading
                              ? "Loading performance data…"
                              : selectedClientId
                              ? "No performance data available for this period."
                              : "Select a client to see performance data."}
                          </p>
                        </div>
                      );
                    }
                    const formatTick = (iso: string) => {
                      if (!iso) return "";
                      const [, m, d] = iso.split("-");
                      const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1];
                      return `${monthName} ${parseInt(d, 10)}`;
                    };
                    const formatTooltipLabel = (iso: string) => {
                      if (!iso) return "";
                      const [y, m, d] = iso.split("-");
                      const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1];
                      return `${monthName} ${parseInt(d, 10)}, ${y}`;
                    };
                    // Pick ~6 evenly-spaced ticks
                    const tickCount = 6;
                    const tickInterval = chart && chart.length > tickCount
                      ? Math.floor(chart.length / tickCount)
                      : 0;
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chart!}
                          margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid stroke="#f0eadf" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            interval={tickInterval}
                            tickFormatter={formatTick}
                            minTickGap={20}
                          />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{
                              background: "#fff",
                              border: "1px solid #e5e7eb",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            labelFormatter={(v: any) => formatTooltipLabel(String(v))}
                          />
                          <Line
                            type="monotone"
                            dataKey="calls"
                            stroke="#1f3a5f"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="clicks"
                            stroke="#e8a456"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>

            {/* Top locations */}
            <Card className="border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-gray-900">Top locations</h2>
                  <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
                    By calls
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                {topLocations.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No locations yet.</p>
                ) : (
                  topLocations.map((loc, i) => (
                    <TopLocationRow
                      key={loc.id}
                      rank={i + 1}
                      name={loc.name}
                      value={loc.value}
                      pct={(loc.value / topLocationsMax) * 100}
                      trend={loc.trend}
                      isNew={loc.isNew}
                      onClick={() => navigate(`/locations?edit=${loc.id}`)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Job Details Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selectedJob && (() => {
            const detail = selectedJobDetail;
            const items: any[] = detail?.items || [];
            const isPost = (selectedJob as any).type === "posts";
            const firstItem = items[0];
            const postData = firstItem?.payload?.postData;
            const mediaUrl = postData?.media?.[0]?.sourceUrl;
            const cta = postData?.callToAction;
            const failedItems = items.filter((i: any) => i.status === "failed");
            const successItems = items.filter((i: any) => i.status === "success");

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                      {getJobTypeIcon((selectedJob as any).type)}
                    </div>
                    {getJobTypeLabel((selectedJob as any).type)}
                  </DialogTitle>
                  <DialogDescription>
                    {formatPhoenixDateTime(selectedJob.createdAt)}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-1 max-h-[70vh] overflow-y-auto overflow-x-hidden pr-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    {getStatusBadge(selectedJob.status)}
                  </div>

                  {(selectedJob as any).totalItems > 0 && (
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Total</p>
                        <p className="text-2xl font-bold">{(selectedJob as any).totalItems}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3">
                        <p className="text-xs text-green-600 mb-1">Succeeded</p>
                        <p className="text-2xl font-bold text-green-700">{(selectedJob as any).successCount || 0}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3">
                        <p className="text-xs text-red-600 mb-1">Failed</p>
                        <p className="text-2xl font-bold text-red-700">{(selectedJob as any).errorCount || 0}</p>
                      </div>
                    </div>
                  )}

                  {isPost && !detail && (
                    <div className="text-sm text-muted-foreground animate-pulse">Loading post details…</div>
                  )}

                  {isPost && postData?.summary && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Post Content</p>
                      <div className="bg-muted/40 rounded-lg p-3 text-sm leading-relaxed">{postData.summary}</div>
                    </div>
                  )}

                  {isPost && (mediaUrl || cta) && (
                    <div className="grid grid-cols-2 gap-3">
                      {mediaUrl && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Image</p>
                          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="block group">
                            <img
                              src={mediaUrl}
                              alt="Post image"
                              className="w-full h-32 object-cover rounded-lg border border-border group-hover:opacity-90 transition-opacity"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                            <p className="text-xs text-blue-600 mt-1 flex items-center gap-1 hover:underline">
                              <ExternalLink className="w-3 h-3" /> View full image
                            </p>
                          </a>
                        </div>
                      )}
                      {cta && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Call to Action</p>
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{cta.actionType?.replace(/_/g, " ")}</p>
                            {cta.url && (
                              <a href={cta.url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline break-all flex items-start gap-1">
                                <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span className="break-all">{cta.url}</span>
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {items.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Locations ({items.length})
                      </p>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {failedItems.map((item: any, i: number) => (
                          <div key={i} className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-red-900 truncate">
                                    {item.locationName || item.payload?.locationTitle || "Unknown location"}
                                  </p>
                                  {item.locationAddress && (
                                    <p className="text-xs text-red-400 truncate">{item.locationAddress}</p>
                                  )}
                                  {item.errorText && (
                                    <p className="text-xs text-red-700 mt-0.5 leading-snug">{item.errorText}</p>
                                  )}
                                </div>
                              </div>
                              <Badge className="bg-red-100 text-red-700 border-red-200 border text-xs flex-shrink-0">Failed</Badge>
                            </div>
                          </div>
                        ))}
                        {successItems.map((item: any, i: number) => (
                          <div key={i} className="rounded-lg border border-green-100 bg-green-50/40 p-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm truncate">{item.locationName || item.payload?.locationTitle || "Unknown location"}</p>
                                {item.locationAddress && (
                                  <p className="text-xs text-muted-foreground truncate">{item.locationAddress}</p>
                                )}
                              </div>
                            </div>
                            <Badge className="bg-green-100 text-green-700 border-green-200 border text-xs flex-shrink-0">OK</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedJob.status === "failed" ? (
                    <Button
                      variant="outline"
                      className="w-full border-blue-200 text-blue-600 hover:bg-blue-50"
                      onClick={handleRetry}
                      data-testid="button-retry-selected-job"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Retry This Job
                    </Button>
                  ) : canUndo(selectedJob.status) ? (
                    <Button
                      variant="outline"
                      className="w-full border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => undoMutation.mutate(selectedJob.id)}
                      disabled={undoMutation.isPending}
                      data-testid="button-undo-selected-job"
                    >
                      <Undo2 className="w-4 h-4 mr-2" />
                      {undoMutation.isPending ? "Undoing…" : "Undo This Job"}
                    </Button>
                  ) : null}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Activity Detail Dialog */}
      <Dialog open={!!selectedActivity} onOpenChange={() => setSelectedActivity(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedActivity && (
            <>
              <DialogHeader>
                <DialogTitle>{formatActivityAction(selectedActivity.action)}</DialogTitle>
                <DialogDescription>
                  {formatPhoenixDateTime(selectedActivity.timestamp)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                  <Avatar className="w-9 h-9">
                    {selectedActivity.localUser?.profilePictureUrl && (
                      <AvatarImage src={selectedActivity.localUser.profilePictureUrl} alt={selectedActivity.localUser.name} />
                    )}
                    <AvatarFallback className="text-sm">
                      {selectedActivity.localUser
                        ? selectedActivity.localUser.name.charAt(0).toUpperCase()
                        : <User className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">
                      {selectedActivity.localUser?.name ?? "System"}
                    </p>
                    {selectedActivity.localUser?.title && (
                      <p className="text-xs text-muted-foreground">{selectedActivity.localUser.title}</p>
                    )}
                  </div>
                </div>

                {(() => {
                  const activityLoc = selectedActivity.clientLocationId
                    ? locations.find((l) => l.id === selectedActivity.clientLocationId)
                    : null;
                  const displayName = activityLoc?.name ?? selectedActivity.locationName;
                  const displayAddress = activityLoc?.address ?? selectedActivity.locationAddress;
                  if (!displayName) return null;
                  return (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        {activityLoc ? (
                          <button
                            onClick={() => {
                              setSelectedActivity(null);
                              navigate(`/locations?edit=${activityLoc.id}`);
                            }}
                            className="text-sm font-medium text-cyan-700 dark:text-cyan-400 hover:underline text-left"
                            data-testid={`link-dialog-location-${activityLoc.id}`}
                          >
                            {displayName}
                          </button>
                        ) : (
                          <p className="text-sm font-medium">{displayName}</p>
                        )}
                        {displayAddress && (
                          <p className="text-xs text-muted-foreground">{displayAddress}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {selectedActivity.payloadJson && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Details</p>
                    {selectedActivity.action === "bulk_social_media_updated" && selectedActivity.payloadJson.socialMedia ? (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Links Updated</p>
                          {Object.entries(selectedActivity.payloadJson.socialMedia).map(([platform, url]: [string, any]) => (
                            <div key={platform} className="flex items-center gap-2 text-sm">
                              <span className="font-medium capitalize w-24 shrink-0">{platform.replace(/^url_/, "")}</span>
                              <a href={url as string} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate">{url}</a>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase">Locations</p>
                          {selectedActivity.payloadJson.locations?.length > 0
                            ? selectedActivity.payloadJson.locations.map((loc: any) => (
                                <div key={loc.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                  {loc.googleUpdated
                                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                    : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                                  <span>{loc.name || loc.id}</span>
                                  <span className="ml-auto text-xs">
                                    {loc.googleUpdated
                                      ? <span className="text-green-600 font-medium">Synced</span>
                                      : <span className="text-red-500 font-medium">Failed</span>}
                                  </span>
                                </div>
                              ))
                            : (
                                <p className="text-sm text-muted-foreground">
                                  {selectedActivity.payloadJson.locationCount ?? 0} location(s) · {selectedActivity.payloadJson.googleUpdatedCount ?? 0} synced to Google
                                </p>
                              )
                          }
                        </div>
                      </div>
                    ) : selectedActivity.action === "location_info_changed" ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">What Changed</p>
                        {(selectedActivity.payloadJson?.changes ?? []).map((c: any, i: number) => (
                          <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                            <p className="text-xs font-semibold text-amber-800 capitalize">{c.field.replace(/_/g, " ")}</p>
                            <p className="text-sm text-red-500 line-through break-words whitespace-pre-wrap">{c.old}</p>
                            <p className="text-sm text-green-700 font-medium break-words whitespace-pre-wrap">{c.new}</p>
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground mt-2">
                          Detected during Google sync. The database has been updated to match Google.
                        </p>
                        {(() => {
                          const changes: any[] = selectedActivity.payloadJson?.changes ?? [];
                          const revertableChanges = changes.filter((c: any) => c.field !== 'address' && c.old);
                          const hasAddress = changes.some((c: any) => c.field === 'address');
                          if (revertableChanges.length === 0 && !hasAddress) return null;
                          return (
                            <div className="mt-3 pt-3 border-t border-amber-200">
                              {revertableChanges.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-400 text-amber-800 hover:bg-amber-50 w-full"
                                  disabled={revertLocationInfoMutation.isPending}
                                  onClick={() => revertLocationInfoMutation.mutate(selectedActivity.id)}
                                >
                                  {revertLocationInfoMutation.isPending ? "Reverting…" : "↩ Revert to Original"}
                                </Button>
                              )}
                              {hasAddress && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  Note: address changes must be corrected manually in the location editor.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ) : selectedActivity.action === "post_created_in_app" ? (
                      activityJobLoading ? (
                        <p className="text-sm text-muted-foreground">Loading details…</p>
                      ) : (() => {
                        const postData = activityJob?.payload?.postData ?? {};
                        const imageUrl = postData.media?.[0]?.sourceUrl ?? selectedActivity.payloadJson.imageUrl ?? null;
                        const summary = postData.summary ?? selectedActivity.payloadJson.summary ?? null;
                        const cta = postData.callToAction ?? selectedActivity.payloadJson.callToAction ?? null;
                        const items: any[] = activityJob?.items ?? [];
                        const status = activityJob?.status;
                        const statusColors: Record<string, string> = {
                          success: "bg-green-100 text-green-700",
                          failed: "bg-red-100 text-red-700",
                          partial: "bg-yellow-100 text-yellow-700",
                          running: "bg-blue-100 text-blue-700",
                          queued: "bg-gray-100 text-gray-600",
                          scheduled: "bg-purple-100 text-purple-700",
                        };
                        return (
                          <div className="space-y-3">
                            {status && (
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[status] ?? "bg-gray-100 text-gray-600"}`}>
                                  {status}
                                </span>
                                {activityJob?.successCount != null && (
                                  <span className="text-xs text-muted-foreground">{activityJob.successCount} succeeded · {activityJob.errorCount} failed</span>
                                )}
                              </div>
                            )}
                            {imageUrl && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Image</p>
                                <img src={imageUrl} alt="Post image" className="rounded-md max-h-40 object-cover w-full" />
                              </div>
                            )}
                            {summary && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Message</p>
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
                              </div>
                            )}
                            {cta && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Call to Action</p>
                                <p className="text-sm font-medium">{cta.actionType?.replace(/_/g, " ")}</p>
                                {cta.url && (
                                  <a href={cta.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline break-all">{cta.url}</a>
                                )}
                              </div>
                            )}
                            {items.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase">Locations</p>
                                {items.map((item: any) => (
                                  <div key={item.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                    {item.status === "success"
                                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                      : item.status === "failed"
                                      ? <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                                      : <MapPin className="w-3.5 h-3.5 flex-shrink-0" />}
                                    <span>{item.locationName}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (selectedActivity.action === "regular_hours_updated_in_app" || selectedActivity.action === "special_hours_updated_in_app" || selectedActivity.action === "hours_updated_in_app") ? (
                      (() => {
                        const fmt12 = (t: string) => {
                          const [hStr, mStr] = t.split(":");
                          const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
                          const ampm = h >= 12 ? "PM" : "AM";
                          const h12 = h % 12 || 12;
                          return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                        };
                        const DAY_ORDER = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
                        const sd = selectedActivity.payloadJson.scheduleData;
                        const regular = sd?.regularHours;
                        const special = sd?.specialHours;
                        const status = activityJob?.status;
                        const statusColors: Record<string, string> = {
                          success: "bg-green-100 text-green-700",
                          failed: "bg-red-100 text-red-700",
                          partial: "bg-yellow-100 text-yellow-700",
                          running: "bg-blue-100 text-blue-700",
                          queued: "bg-gray-100 text-gray-600",
                          scheduled: "bg-purple-100 text-purple-700",
                        };
                        const jobItems: any[] = activityJob?.items ?? [];
                        const fallbackLocations: any[] = selectedActivity.payloadJson.locations ?? [];
                        return (
                          <div className="space-y-3">
                            {status && (
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[status] ?? "bg-gray-100 text-gray-600"}`}>
                                  {status}
                                </span>
                                {activityJob?.successCount != null && (
                                  <span className="text-xs text-muted-foreground">{activityJob.successCount} succeeded · {activityJob.errorCount} failed</span>
                                )}
                              </div>
                            )}
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground uppercase">Locations</p>
                              {jobItems.length > 0
                                ? jobItems.map((item: any) => (
                                    <div key={item.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                      {item.status === "success"
                                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                        : item.status === "failed"
                                        ? <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                                        : <MapPin className="w-3.5 h-3.5 flex-shrink-0" />}
                                      <span>{item.locationName}</span>
                                    </div>
                                  ))
                                : fallbackLocations.map((loc: any) => (
                                    <div key={loc.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <MapPin className="w-3 h-3 flex-shrink-0" />
                                      {loc.name}
                                    </div>
                                  ))
                              }
                            </div>
                            {regular && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Schedule</p>
                                <div className="space-y-1">
                                  {DAY_ORDER.filter(d => regular[d] !== undefined).map(day => {
                                    const h = regular[day];
                                    return (
                                      <div key={day} className="flex items-center justify-between text-sm">
                                        <span className="capitalize w-24 text-muted-foreground">{day}</span>
                                        <span className={h.isOpen ? "font-medium" : "text-muted-foreground"}>
                                          {h.isOpen ? `${fmt12(h.openTime)} – ${fmt12(h.closeTime)}` : "Closed"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {special && special.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Special Hours</p>
                                <div className="space-y-1">
                                  {special.map((p: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                      <span className="text-muted-foreground">{p.date}</span>
                                      <span className={p.isClosed ? "text-muted-foreground" : "font-medium"}>
                                        {p.isClosed ? "Closed" : `${fmt12(p.openTime)} – ${fmt12(p.closeTime)}`}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="space-y-1">
                        {selectedActivity.payloadJson.locationCount != null && (
                          <p className="text-sm text-muted-foreground">{selectedActivity.payloadJson.locationCount} location(s) affected</p>
                        )}
                        {selectedActivity.payloadJson.locations?.length > 0 && (
                          <div className="space-y-1">
                            {selectedActivity.payloadJson.locations.map((loc: any) => (
                              <div key={loc.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="w-3 h-3 flex-shrink-0" />
                                {loc.name}
                              </div>
                            ))}
                          </div>
                        )}
                        {!selectedActivity.payloadJson.locationCount && !selectedActivity.payloadJson.locations && (
                          <p className="text-sm text-muted-foreground">No additional details available.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Locations with missing data dialog */}
      <Dialog open={showMissingDataDialog} onOpenChange={setShowMissingDataDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Locations with missing info</DialogTitle>
            <DialogDescription>
              These locations are missing an address or phone number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {locationsWithMissingData.map((loc) => (
              <div key={loc.id} className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-yellow-200 bg-yellow-50/40">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{loc.name}</p>
                  <div className="flex gap-1.5 mt-0.5">
                    {!loc.address && (
                      <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300 py-0">No Address</Badge>
                    )}
                    {!(loc as any).phone && (
                      <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300 py-0">No Phone</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2.5 flex-shrink-0"
                  onClick={() => {
                    setShowMissingDataDialog(false);
                    navigate(`/locations?edit=${loc.id}`);
                  }}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upcoming Activity Detail Dialog */}
      <Dialog open={!!selectedUpcoming} onOpenChange={() => setSelectedUpcoming(null)}>
        <DialogContent className="max-w-md">
          {selectedUpcoming?.type === "post" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-purple-600" />
                  </div>
                  Scheduled Post
                </DialogTitle>
                <DialogDescription>
                  {(selectedUpcoming.job as any).scheduledDate
                    ? formatPhoenixDateTime(
                        new Date(
                          `${(selectedUpcoming.job as any).scheduledDate.toString().split("T")[0]}T${(selectedUpcoming.job as any).scheduledTime || "00:00"}:00`
                        )
                      )
                    : "Date TBD"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                {upcomingJobDetail?.payloadJson?.summary && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Post Content</p>
                    <p className="text-sm leading-relaxed bg-muted/50 rounded-lg p-3">
                      {upcomingJobDetail.payloadJson.summary}
                    </p>
                  </div>
                )}
                {upcomingJobDetail?.payloadJson?.callToAction && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Call to Action</p>
                    <p className="text-sm">
                      {upcomingJobDetail.payloadJson.callToAction.actionType?.replace(/_/g, " ")}
                      {upcomingJobDetail.payloadJson.callToAction.url && (
                        <span className="text-muted-foreground ml-1">— {upcomingJobDetail.payloadJson.callToAction.url}</span>
                      )}
                    </p>
                  </div>
                )}
                {upcomingJobDetail?.items && upcomingJobDetail.items.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Locations ({upcomingJobDetail.items.length})
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-2">
                      {upcomingJobDetail.items.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 text-sm py-0.5">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{item.locationName || item.locationId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!upcomingJobDetail && (
                  <p className="text-sm text-muted-foreground">Loading post details…</p>
                )}
              </div>
            </>
          )}

          {selectedUpcoming?.type === "email" && (() => {
            const grp = selectedUpcoming.data.group;
            const nextDate: Date | null = selectedUpcoming.data.next;
            const lookback: number = grp.lookbackDays ?? 7;
            // End = day before send date (send date itself is excluded from the review window)
            const coverEnd = nextDate ? new Date(nextDate.getTime() - 24 * 60 * 60 * 1000) : null;
            const coverStart = coverEnd ? new Date(coverEnd.getTime() - (lookback - 1) * 24 * 60 * 60 * 1000) : null;
            const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-blue-600" />
                    </div>
                    Review Email Automation
                  </DialogTitle>
                  <DialogDescription>
                    {nextDate ? formatPhoenixDateTime(nextDate) : "Soon"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 pt-1">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Group</p>
                    <p className="text-sm font-medium">{grp.name}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Frequency</p>
                    <p className="text-sm capitalize">{grp.frequency || "Weekly"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Star Rating Filter</p>
                    <div className="flex items-center gap-1.5">
                      {[1,2,3,4,5].map((s) => (
                        <span key={s} className={`text-base ${s >= (grp.minStars ?? 1) && s <= (grp.maxStars ?? 5) ? "text-yellow-400" : "text-muted-foreground/30"}`}>★</span>
                      ))}
                      <span className="text-sm text-muted-foreground ml-1">{grp.minStars ?? 1}–{grp.maxStars ?? 5} stars</span>
                    </div>
                  </div>
                  {coverStart && coverEnd && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Reviews Covered</p>
                      <p className="text-sm text-muted-foreground">
                        {fmt(coverStart)} – {fmt(coverEnd)}
                        <span className="text-xs ml-1.5 text-muted-foreground/70">({lookback} day lookback)</span>
                      </p>
                    </div>
                  )}
                  {(grp.recipientEmail || grp.ccEmail) && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recipients</p>
                      <div className="space-y-2">
                        {grp.recipientEmail && (
                          <div className="flex gap-2">
                            <span className="text-xs font-semibold text-muted-foreground w-5 pt-0.5 shrink-0">To</span>
                            <p className="text-sm text-muted-foreground">{grp.recipientEmail}</p>
                          </div>
                        )}
                        {grp.ccEmail && (
                          <div className="flex gap-2">
                            <span className="text-xs font-semibold text-muted-foreground w-5 pt-0.5 shrink-0">CC</span>
                            <p className="text-sm text-muted-foreground">{grp.ccEmail}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {grp.locationIds?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Monitoring {grp.locationIds.length} Location{grp.locationIds.length !== 1 ? "s" : ""}
                      </p>
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-2">
                        {grp.locationIds.map((lid: string) => {
                          const loc = locations.find((l) => l.id === lid);
                          return (
                            <div key={lid} className="flex items-center gap-2 text-sm py-0.5">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{loc?.name || lid}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {selectedUpcoming?.type === "sync" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-green-600" />
                  </div>
                  Location Auto-Sync
                </DialogTitle>
                <DialogDescription>
                  {formatPhoenixDateTime(selectedUpcoming.settings.nextLocationSyncAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700 space-y-2">
                  <p className="font-medium">What this sync does:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Pulls the latest location data from Google Business Profile</li>
                    <li>Updates hours, address, phone, and status for all locations</li>
                    <li>Adds any new locations added to your Google account</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Locations in Scope</p>
                  <p className="text-sm">{locations.length} location{locations.length !== 1 ? "s" : ""} across your account</p>
                </div>
                {selectedUpcoming.settings.locationSyncFrequency && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Frequency</p>
                    <p className="text-sm capitalize">{selectedUpcoming.settings.locationSyncFrequency}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Sparkline({
  data,
  color = "#9ca3af",
  width = 90,
  height = 36,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function KpiCard({
  dark,
  label,
  value,
  delta,
  trend,
  icon,
  data = [],
  emptyLabel,
  testId,
}: {
  dark?: boolean;
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  icon: React.ReactNode;
  data?: number[];
  emptyLabel?: string;
  testId?: string;
}) {
  const positive = trend === "up";
  const negative = trend === "down";
  const hasData = data.length > 0 && data.some((v) => v > 0);
  return (
    <div
      className={`relative rounded-2xl p-4 shadow-sm border ${
        dark
          ? "bg-[#001f3f] border-[#001f3f] text-white"
          : "bg-white border-gray-200 text-gray-900"
      }`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between mb-2">
        <p
          className={`text-[10px] uppercase tracking-[0.14em] font-medium ${
            dark ? "text-gray-400" : "text-gray-500"
          }`}
        >
          {label}
        </p>
        <span className={dark ? "text-gray-500" : "text-gray-400"}>{icon}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-[28px] font-semibold leading-none tracking-tight ${
              dark ? "text-white" : "text-gray-900"
            }`}
          >
            {value}
          </p>
          <div
            className={`mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium ${
              dark
                ? "text-emerald-400"
                : positive
                ? "text-emerald-600"
                : negative
                ? "text-red-500"
                : "text-gray-500"
            }`}
          >
            {positive && <ArrowUpRight className="w-3 h-3" />}
            {negative && <ArrowDownRight className="w-3 h-3" />}
            {delta}
          </div>
        </div>
        <div className="flex-shrink-0">
          {hasData ? (
            <Sparkline
              data={data}
              color={dark ? "#9ca3af" : positive ? "#10b981" : negative ? "#ef4444" : "#6b7280"}
              width={70}
              height={32}
            />
          ) : (
            <span className="text-[10px] text-gray-400 italic" data-testid={`${testId}-empty`}>
              {emptyLabel ?? "—"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AttentionRow({
  severity,
  title,
  subtitle,
  actionLabel,
  onClick,
  onDismiss,
}: {
  severity: "high" | "medium" | "low";
  title: string;
  subtitle: string;
  actionLabel: string;
  onClick: () => void;
  onDismiss?: (e: React.MouseEvent) => void;
}) {
  // Color the dot by what kind of action is needed — gives the list a clear
  // traffic-light feel (red = broken, amber = needs review, blue = info, green = good).
  const dotColor =
    actionLabel === "Fix"
      ? "bg-red-500"
      : actionLabel === "Approve"
      ? "bg-emerald-500"
      : actionLabel === "Review" || actionLabel === "Edit"
      ? "bg-amber-400"
      : severity === "high"
      ? "bg-red-500"
      : severity === "medium"
      ? "bg-amber-400"
      : "bg-gray-300";

  const pillColor =
    actionLabel === "Fix"
      ? "bg-red-100 text-red-700"
      : actionLabel === "Approve"
      ? "bg-emerald-100 text-emerald-700"
      : actionLabel === "Review" || actionLabel === "Edit"
      ? "bg-amber-100 text-amber-700"
      : "bg-gray-100 text-gray-700";

  return (
    <div className="flex items-center group">
      <button
        onClick={onClick}
        className="flex-1 flex items-center gap-3 px-3 py-3 hover:bg-gray-50/70 transition-colors rounded-lg text-left min-w-0"
        data-testid={`attention-${actionLabel.toLowerCase()}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-gray-900 truncate">{title}</p>
          <p className="text-[12px] text-gray-500 truncate mt-0.5">{subtitle}</p>
        </div>
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${pillColor} flex-shrink-0`}
        >
          {actionLabel}
        </span>
        <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
      </button>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-1 mr-2 p-1 rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
          aria-label="Dismiss"
          data-testid={`button-dismiss-attention`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function UpcomingRow({
  icon, tone, kicker, title, when, sub, onClick, testId,
}: {
  icon: React.ReactNode;
  tone: "blue" | "purple" | "green";
  kicker: string;
  title: string;
  when: Date | null;
  sub?: string | null;
  onClick: () => void;
  testId?: string;
}) {
  const toneBg =
    tone === "blue"   ? "bg-blue-50 text-blue-600"
    : tone === "purple" ? "bg-purple-50 text-purple-600"
    : "bg-emerald-50 text-emerald-600";

  const formatWhen = (d: Date | null) => {
    if (!d) return "";
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.getFullYear() === tomorrow.getFullYear() && d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate();
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today, ${time}`;
    if (isTomorrow) return `Tomorrow, ${time}`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${time}`;
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50/70 transition-colors rounded-lg text-left"
      data-testid={testId}
    >
      <span className={`w-7 h-7 rounded-full inline-flex items-center justify-center flex-shrink-0 ${toneBg}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{kicker}</span>
          {when && <span className="text-[11px] text-gray-700 font-mono">{formatWhen(when)}</span>}
        </div>
        <p className="text-[13px] text-gray-900 truncate mt-0.5">{title}</p>
        {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  );
}

function BulkBtn({
  primary,
  icon,
  label,
  onClick,
  testId,
}: {
  primary?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl border transition-colors text-[13px] font-medium ${
        primary
          ? "bg-[#001f3f] border-[#001f3f] text-white hover:bg-[#00162d]"
          : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ChevronRight
        className={`w-4 h-4 ${primary ? "text-gray-400" : "text-gray-300"}`}
      />
    </button>
  );
}

function activityIconForAction(action: string, tone: "success" | "warning" | "danger" | "neutral" = "neutral") {
  const cls =
    tone === "success"
      ? "text-emerald-600"
      : tone === "warning"
      ? "text-amber-600"
      : tone === "danger"
      ? "text-red-600"
      : "text-gray-500";
  switch (action) {
    case "post_created_in_app":
      return <MessageSquare className={`w-4 h-4 ${cls}`} />;
    case "location_info_changed":
      return <AlertTriangle className={`w-4 h-4 ${cls}`} />;
    case "review_email_sent":
      return <Mail className={`w-4 h-4 ${cls}`} />;
    case "regular_hours_updated_in_app":
    case "special_hours_updated_in_app":
    case "hours_updated_in_app":
      return <Clock className={`w-4 h-4 ${cls}`} />;
    case "bulk_social_media_updated":
      return <Share2 className={`w-4 h-4 ${cls}`} />;
    case "photos_uploaded_in_app":
      return <FileText className={`w-4 h-4 ${cls}`} />;
    default:
      return <History className={`w-4 h-4 ${cls}`} />;
  }
}

function activityTone(entry: any): "success" | "warning" | "danger" | "neutral" {
  if (entry.action === "location_info_changed") return "warning"; // unauthorized edit by Google
  if (entry.jobStatus === "failed") return "danger";
  if (entry.jobStatus === "partial") return "warning";
  if (entry.jobStatus === "success") return "success";
  if (entry.action === "review_email_sent") {
    return (entry.payloadJson as any)?.status === "failed" ? "danger" : "success";
  }
  if (
    entry.action === "regular_hours_updated_in_app" ||
    entry.action === "special_hours_updated_in_app" ||
    entry.action === "hours_updated_in_app" ||
    entry.action === "bulk_social_media_updated" ||
    entry.action === "photos_uploaded_in_app" ||
    entry.action === "location_details_updated" ||
    entry.action === "post_created_in_app"
  ) {
    return "success";
  }
  return "neutral";
}

function activityIconBgClass(tone: ReturnType<typeof activityTone>) {
  switch (tone) {
    case "success": return "bg-emerald-50";
    case "warning": return "bg-amber-50";
    case "danger":  return "bg-red-50";
    case "info":    return "bg-blue-50";
    default:        return "bg-gray-100";
  }
}

function activityBadge(entry: any): { text: string; cls: string } | null {
  const action = entry.action;
  if (action === "location_info_changed") {
    return { text: "Review", cls: "bg-amber-100 text-amber-700" };
  }
  if (action === "review_email_sent") {
    if ((entry.payloadJson as any)?.status === "failed") return { text: "Failed", cls: "bg-red-100 text-red-700" };
    return { text: "Sent", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (action === "post_created_in_app") {
    if (entry.jobStatus === "failed") return { text: "Failed", cls: "bg-red-100 text-red-700" };
    if (entry.jobStatus === "partial") return { text: "Partial", cls: "bg-yellow-100 text-yellow-700" };
    if (entry.jobStatus === "scheduled") return { text: "Scheduled", cls: "bg-purple-100 text-purple-700" };
    return { text: "Sent", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (
    action === "regular_hours_updated_in_app" ||
    action === "special_hours_updated_in_app" ||
    action === "hours_updated_in_app" ||
    action === "bulk_social_media_updated" ||
    action === "photos_uploaded_in_app" ||
    action === "location_details_updated"
  ) {
    if (entry.jobStatus === "failed") return { text: "Failed", cls: "bg-red-100 text-red-700" };
    if (entry.jobStatus === "partial") return { text: "Partial", cls: "bg-yellow-100 text-yellow-700" };
    return { text: "Synced", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (entry.jobStatus === "success") return { text: "Successful", cls: "bg-emerald-100 text-emerald-700" };
  if (entry.jobStatus === "failed") return { text: "Failed", cls: "bg-red-100 text-red-700" };
  return null;
}

function ActivityRow({
  entry,
  label,
  onClick,
}: {
  entry: any;
  label: string;
  onClick: () => void;
}) {
  const badge = activityBadge(entry);
  const tone = activityTone(entry);
  const subtitleParts: string[] = [];
  if (entry.localUser?.name) subtitleParts.push(entry.localUser.name);
  else subtitleParts.push("System");
  if (entry.payloadJson?.locationCount) {
    subtitleParts.push(`${entry.payloadJson.locationCount} location${entry.payloadJson.locationCount !== 1 ? "s" : ""}`);
  } else if (entry.locationName) {
    subtitleParts.push(entry.locationName);
  }
  subtitleParts.push(formatPhoenixDateTime(entry.timestamp));

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 hover:bg-gray-50/70 transition-colors rounded-lg text-left"
      data-testid={`recent-activity-${entry.id}`}
    >
      <div className={`w-8 h-8 rounded-lg ${activityIconBgClass(tone)} flex items-center justify-center flex-shrink-0`}>
        {activityIconForAction(entry.action, tone)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-gray-900 truncate">{label}</p>
        <p className="text-[12px] text-gray-500 truncate mt-0.5">
          {subtitleParts.join(" · ")}
        </p>
      </div>
      {badge && (
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge.cls} flex-shrink-0`}
        >
          {badge.text}
        </span>
      )}
    </button>
  );
}

function TopLocationRow({
  rank,
  name,
  value,
  pct,
  trend,
  isNew,
  onClick,
}: {
  rank: number;
  name: string;
  value: number;
  pct: number;
  trend?: number | null;
  isNew?: boolean;
  onClick?: () => void;
}) {
  const trendEl = (() => {
    if (isNew) {
      return (
        <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-600" data-testid={`trend-new-${rank}`}>
          <TrendingUp className="w-3 h-3" />
          New
        </span>
      );
    }
    if (trend === null || trend === undefined) return null;
    if (trend > 0) {
      return (
        <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-600" data-testid={`trend-up-${rank}`}>
          <TrendingUp className="w-3 h-3" />
          +{trend}%
        </span>
      );
    }
    if (trend < 0) {
      return (
        <span className="flex items-center gap-0.5 text-[11px] font-medium text-red-500" data-testid={`trend-down-${rank}`}>
          <TrendingDown className="w-3 h-3" />
          {trend}%
        </span>
      );
    }
    return (
      <span className="text-[11px] font-medium text-gray-400" data-testid={`trend-flat-${rank}`}>
        —
      </span>
    );
  })();

  return (
    <button
      onClick={onClick}
      className="w-full grid grid-cols-[16px_1fr_auto] items-center gap-3 group text-left"
      data-testid={`top-location-${rank}`}
    >
      <span className="text-[12px] text-gray-400 font-medium">{rank}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-800 truncate group-hover:text-gray-900 transition-colors">
          {name}
        </p>
        <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#1f3a5f] rounded-full"
            style={{ width: `${Math.max(6, Math.min(100, pct))}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[12px] font-semibold text-gray-700 tabular-nums" data-testid={`call-count-${rank}`}>
          {value}
        </span>
        {trendEl}
      </div>
    </button>
  );
}
