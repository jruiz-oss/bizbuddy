import { SideNav } from "@/components/SideNav";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock,
  FileText,
  Image as ImageIcon,
  ChevronRight,
  RotateCcw,
  Mail,
  MessageSquare,
  AlertTriangle,
  Share2,
  History,
  Search,
  MapPin,
  User as UserIcon,
  Download,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ActivityLog, Client, LocalUser, ClientLocation } from "@shared/schema";

interface ActivityLogWithUser extends ActivityLog {
  localUser?: {
    id: string;
    name: string;
    title: string | null;
    profilePictureUrl: string | null;
  } | null;
  locationName?: string | null;
  jobStatus?: string | null;
}

interface ActivityLogProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

// ── Categorization ───────────────────────────────────────────────────────────
type Category = "all" | "posts" | "profile" | "reviews" | "system";

const POSTS_ACTIONS = new Set([
  "post_created_in_app",
  "posts_csv_uploaded",
]);

const PROFILE_ACTIONS = new Set([
  "location_info_changed",
  "regular_hours_updated_in_app",
  "special_hours_updated_in_app",
  "hours_updated_in_app",
  "hours_csv_uploaded",
  "bulk_hours_updated",
  "bulk_social_media_updated",
  "photos_uploaded_in_app",
  "photos_csv_uploaded",
  "location_details_updated",
  "location_data_synced",
  "suggested_edits_applied",
  "suggested_edit_accepted",
  "suggested_edit_rejected",
]);

const REVIEWS_ACTIONS = new Set([
  "review_email_sent",
]);

function categoryFor(action: string): Exclude<Category, "all"> {
  if (POSTS_ACTIONS.has(action)) return "posts";
  if (PROFILE_ACTIONS.has(action)) return "profile";
  if (REVIEWS_ACTIONS.has(action)) return "reviews";
  return "system";
}

function categoryLabel(c: Exclude<Category, "all">): string {
  switch (c) {
    case "posts":   return "Posts";
    case "profile": return "Profile";
    case "reviews": return "Reviews";
    case "system":  return "System";
  }
}

// ── Per-action display helpers ───────────────────────────────────────────────
function actionVerb(action: string): string {
  switch (action) {
    case "post_created_in_app":      return "Published";
    case "posts_csv_uploaded":       return "Uploaded posts CSV";
    case "regular_hours_updated_in_app": return "Regular hours updated";
    case "special_hours_updated_in_app": return "Special hours updated";
    case "hours_updated_in_app":     return "Hours updated";
    case "hours_csv_uploaded":       return "Uploaded hours CSV";
    case "bulk_hours_updated":       return "Bulk hours updated";
    case "bulk_social_media_updated":return "Social links updated";
    case "photos_uploaded_in_app":   return "Photos uploaded";
    case "photos_csv_uploaded":      return "Uploaded photos CSV";
    case "location_info_changed":    return "Profile changed on Google";
    case "location_details_updated": return "Location updated";
    case "location_data_synced":     return "Locations synced";
    case "review_email_sent":        return "Review email sent";
    case "suggested_edits_applied":  return "Suggested edits applied";
    case "suggested_edit_accepted":  return "Suggested edit accepted";
    case "suggested_edit_rejected":  return "Suggested edit rejected";
    case "schedule_evaluated":       return "Schedule checked";
    case "schedule_enqueued":        return "Job scheduled";
    case "job_undone":               return "Job reverted";
    default:                         return action.replace(/_/g, " ");
  }
}

const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", twitter: "X (Twitter)",
  youtube: "YouTube", linkedin: "LinkedIn", tiktok: "TikTok", pinterest: "Pinterest",
};

function actionTitle(entry: ActivityLogWithUser): string {
  const p = (entry.payloadJson as any) || {};
  if (entry.action === "post_created_in_app" || entry.action === "posts_csv_uploaded") {
    return p.title || "Post";
  }
  if (entry.action === "location_info_changed") {
    const change = Array.isArray(p.changes) ? p.changes[0] : null;
    if (change?.field) {
      const fieldLabel = String(change.field).replace(/_/g, " ");
      return `${fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1)} changed`;
    }
    return entry.locationName || "Profile change detected";
  }
  if (entry.action === "review_email_sent") {
    return p.recipient ? `Sent to ${p.recipient}` : "Email sent";
  }
  if (entry.action === "bulk_social_media_updated") {
    const sm = p.socialMedia || {};
    const platforms = Object.keys(sm).filter((k) => sm[k]).map((k) => SOCIAL_PLATFORM_LABELS[k] || k);
    if (platforms.length > 0) return platforms.join(", ");
    return "Social links updated";
  }
  if (entry.action === "regular_hours_updated_in_app" || entry.action === "special_hours_updated_in_app" || entry.action === "hours_updated_in_app" || entry.action === "hours_csv_uploaded" || entry.action === "bulk_hours_updated") {
    if (p.locationCount && p.locationCount > 1) return `${p.locationCount} locations`;
    return entry.locationName || "Hours";
  }
  if (entry.action === "photos_uploaded_in_app" || entry.action === "photos_csv_uploaded") {
    return p.photoCount ? `${p.photoCount} photos` : "Photo upload";
  }
  if (entry.action === "location_details_updated") {
    return entry.locationName || "Location details";
  }
  if (entry.action === "location_data_synced") {
    return p.locationCount ? `${p.locationCount} locations synced` : "Sync complete";
  }
  if (entry.action === "job_undone") {
    return "Reverted job";
  }
  return entry.locationName || "";
}

function actionIcon(action: string) {
  switch (action) {
    case "post_created_in_app":
    case "posts_csv_uploaded":
      return <MessageSquare className="w-3.5 h-3.5" />;
    case "location_info_changed":
      return <AlertTriangle className="w-3.5 h-3.5" />;
    case "review_email_sent":
      return <Mail className="w-3.5 h-3.5" />;
    case "regular_hours_updated_in_app":
    case "special_hours_updated_in_app":
    case "hours_updated_in_app":
    case "hours_csv_uploaded":
    case "bulk_hours_updated":
      return <Clock className="w-3.5 h-3.5" />;
    case "bulk_social_media_updated":
      return <Share2 className="w-3.5 h-3.5" />;
    case "photos_uploaded_in_app":
    case "photos_csv_uploaded":
      return <ImageIcon className="w-3.5 h-3.5" />;
    case "location_details_updated":
    case "location_data_synced":
      return <FileText className="w-3.5 h-3.5" />;
    default:
      return <History className="w-3.5 h-3.5" />;
  }
}

function actionTone(entry: ActivityLogWithUser): "warning" | "danger" | "success" | "neutral" {
  if (entry.action === "location_info_changed") return "danger";
  if (entry.jobStatus === "failed") return "danger";
  if (entry.jobStatus === "partial") return "warning";
  return "neutral";
}

function actionIconBg(tone: ReturnType<typeof actionTone>): string {
  switch (tone) {
    case "danger":  return "bg-red-50 text-red-600";
    case "warning": return "bg-amber-50 text-amber-600";
    case "success": return "bg-emerald-50 text-emerald-600";
    default:        return "bg-gray-100 text-gray-500";
  }
}

// Build a small "detail chip" string shown in the gray box under the row.
// Only returns content derived from the real payload — never invents data.
function detailChip(entry: ActivityLogWithUser): string | null {
  const p = (entry.payloadJson as any) || {};
  if (entry.action === "location_info_changed") {
    const change = Array.isArray(p.changes) ? p.changes[0] : null;
    if (change?.field) {
      const oldVal = change.old ? String(change.old) : "";
      const newVal = change.new ? String(change.new) : "";
      const trim = (s: string) => (s.length > 90 ? s.slice(0, 87) + "…" : s);
      if (oldVal && newVal) return `${trim(oldVal)} → ${trim(newVal)}`;
      if (newVal) return `New: ${trim(newVal)}`;
    }
    return null;
  }
  if (entry.action === "post_created_in_app" || entry.action === "posts_csv_uploaded") {
    if (Array.isArray(p.locationNames) && p.locationNames.length > 0) {
      return p.locationNames.slice(0, 6).join(", ");
    }
    if (Array.isArray(p.locations) && p.locations.length > 0) {
      return p.locations.slice(0, 6).map((l: any) => l.name).filter(Boolean).join(", ");
    }
  }
  if (entry.action === "bulk_social_media_updated") {
    const sm = p.socialMedia || {};
    const urls = Object.entries(sm).filter(([, v]) => !!v).map(([, v]) => String(v));
    if (urls.length > 0) return urls.join("  ·  ");
  }
  if (entry.action === "review_email_sent") {
    if (p.reviewCount != null) {
      return `${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"} included`;
    }
  }
  return null;
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayHeaderLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  const datePart = `${monthName} ${d.getDate()}`;
  if (isSameDay(d, today))     return `Today, ${datePart}`;
  if (isSameDay(d, yesterday)) return `Yesterday, ${datePart}`;
  return datePart;
}

function timeOfDay(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function relativeDayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today))     return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${monthName} ${d.getDate()}`;
}

// ── Inline job details (kept from prior version, used inside the Details modal)
function ActivityDetails({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = useQuery<any>({ queryKey: ["/api/jobs", jobId] });
  if (isLoading) return <p className="text-xs text-gray-500">Loading details…</p>;
  if (!job) return <p className="text-xs text-gray-500">No job details found.</p>;

  const items = job.items || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Status:</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            job.status === "success" ? "bg-emerald-100 text-emerald-700"
            : job.status === "failed" ? "bg-red-100 text-red-700"
            : job.status === "partial" ? "bg-amber-100 text-amber-700"
            : "bg-gray-100 text-gray-700"
          }`}
        >
          {job.status}
        </span>
      </div>
      <div className="text-xs text-gray-600">
        <span className="font-semibold text-gray-800">{job.successCount || 0}</span> successful ·{" "}
        <span className="font-semibold text-gray-800">{job.errorCount || 0}</span> errors
      </div>
      {items.length > 0 && (
        <div className="border border-gray-200 rounded-lg divide-y max-h-56 overflow-auto">
          {items.map((item: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between text-xs px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-gray-800 truncate">{item.payload?.locationTitle || "Unknown"}</span>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                  item.status === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}
              >
                {item.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function ActivityLog({ selectedClientId, setSelectedClientId }: ActivityLogProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [activityPeriod, setActivityPeriod] = useState<"7d" | "30d" | "90d" | "all" | "custom">("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [openDetails, setOpenDetails] = useState<ActivityLogWithUser | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const { toast } = useToast();

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });
  const { data: localUsers = [] } = useQuery<LocalUser[]>({ queryKey: ["/api/local-users"] });

  const { data: activities = [] } = useQuery<ActivityLogWithUser[]>({
    queryKey: ["/api/activity-log", selectedClientId],
    queryFn: async () => {
      const r = await fetch(`/api/activity-log?client_id=${selectedClientId}`);
      if (!r.ok) throw new Error("Failed to fetch activity log");
      return r.json();
    },
    enabled: !!selectedClientId,
  });

  const bulkUndoMutation = useMutation({
    mutationFn: async (jobIds: string[]) => apiRequest("POST", "/api/jobs/bulk-undo", { jobIds }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log", selectedClientId] });
      setSelectedIds(new Set());
      setShowUndoConfirm(false);
      toast({ title: "Done", description: `${data.succeeded} job${data.succeeded !== 1 ? "s" : ""} reverted. The log records remain for your reference.` });
    },
    onError: () => toast({ title: "Error", description: "Failed to revert selected jobs.", variant: "destructive" }),
  });

  // ── Filtering ────────────────────────────────────────────────────────────
  const periodFilter = (a: ActivityLogWithUser) => {
    const ts = new Date(a.timestamp);
    if (activityPeriod === "all") return true;
    if (activityPeriod === "custom") {
      if (customStart && ts < new Date(customStart + "T00:00:00")) return false;
      if (customEnd   && ts > new Date(customEnd + "T23:59:59")) return false;
      return true;
    }
    const days = activityPeriod === "7d" ? 7 : activityPeriod === "90d" ? 90 : 30;
    return ts >= new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  };

  // Activities filtered only by period — used for KPI strip and tab counts.
  const periodActivities = useMemo(
    () => activities.filter(periodFilter),
    [activities, activityPeriod, customStart, customEnd],
  );

  const tabCounts = useMemo(() => {
    const counts = { all: 0, posts: 0, profile: 0, reviews: 0, system: 0 } as Record<Category, number>;
    counts.all = periodActivities.length;
    periodActivities.forEach((a) => { counts[categoryFor(a.action)]++; });
    return counts;
  }, [periodActivities]);

  const filtered = useMemo(() => {
    return periodActivities.filter((a) => {
      if (activeCategory !== "all" && categoryFor(a.action) !== activeCategory) return false;
      if (actorFilter !== "all") {
        const actorId = a.localUser?.id ?? "__system__";
        if (actorId !== actorFilter) return false;
      }
      if (locationFilter !== "all") {
        if (a.clientLocationId !== locationFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [
          actionVerb(a.action),
          actionTitle(a),
          a.localUser?.name || "System",
          a.locationName || "",
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [periodActivities, activeCategory, actorFilter, locationFilter, search]);

  // Group by day (most recent first)
  const groupedByDay = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const groups: Array<{ key: string; date: Date; items: ActivityLogWithUser[] }> = [];
    for (const a of sorted) {
      const d = new Date(a.timestamp);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(a);
      else groups.push({ key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [a] });
    }
    return groups;
  }, [filtered]);

  // ── KPI strip values ─────────────────────────────────────────────────────
  const kpiEvents = periodActivities.length;
  const kpiActiveUsers = useMemo(() => {
    const ids = new Set<string>();
    for (const a of periodActivities) if (a.localUser?.id) ids.add(a.localUser.id);
    return ids.size;
  }, [periodActivities]);
  const kpiTotalSeats = localUsers.length;
  const kpiProfileChanges = useMemo(
    () => periodActivities.filter((a) => a.action === "location_info_changed").length,
    [periodActivities],
  );
  const kpiBulkActions = useMemo(() => {
    let count = 0;
    let touched = new Set<string>();
    for (const a of periodActivities) {
      const p = (a.payloadJson as any) || {};
      if ((p.locationCount && p.locationCount > 1) || a.action === "bulk_social_media_updated" || a.action === "bulk_hours_updated" || a.action === "posts_csv_uploaded" || a.action === "hours_csv_uploaded" || a.action === "photos_csv_uploaded") {
        count++;
        if (Array.isArray(p.locationIds)) p.locationIds.forEach((id: string) => touched.add(id));
        else if (a.clientLocationId) touched.add(a.clientLocationId);
      }
    }
    return { count, locationsTouched: touched.size };
  }, [periodActivities]);

  // ── Actor & location filter options ──────────────────────────────────────
  const actorOptions = useMemo(() => {
    const map = new Map<string, string>();
    let hasSystem = false;
    for (const a of activities) {
      if (a.localUser?.id) map.set(a.localUser.id, a.localUser.name);
      else hasSystem = true;
    }
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    if (hasSystem) list.push({ id: "__system__", name: "System" });
    return list;
  }, [activities]);

  const locationOptions = useMemo(() => {
    return [...locations].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [locations]);

  // ── CSV export ───────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows: string[] = [];
    rows.push(["Timestamp", "Actor", "Email", "Category", "Action", "Title", "Location"].join(","));
    const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
    for (const a of filtered) {
      rows.push([
        escape(formatPhoenixDateTime(a.timestamp)),
        escape(a.localUser?.name || "System"),
        escape((a.localUser as any)?.email || ""),
        escape(categoryLabel(categoryFor(a.action))),
        escape(actionVerb(a.action)),
        escape(actionTitle(a)),
        escape(a.locationName || ""),
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  };

  // ── Period label ─────────────────────────────────────────────────────────
  const periodLabel =
    activityPeriod === "7d" ? "Last 7 days"
    : activityPeriod === "30d" ? "Last 30 days"
    : activityPeriod === "90d" ? "Last 90 days"
    : activityPeriod === "all" ? "All time"
    : (customStart && customEnd) ? `${customStart} – ${customEnd}` : "Custom range";

  const periodSubtitle =
    activityPeriod === "7d" ? "last 7 days"
    : activityPeriod === "30d" ? "last 30 days"
    : activityPeriod === "90d" ? "last 90 days"
    : activityPeriod === "all" ? "all time"
    : "custom range";

  // ── Selection / undo ─────────────────────────────────────────────────────
  const selectedActivities = filtered.filter((a) => selectedIds.has(a.id));
  const selectedJobIds = selectedActivities.map((a) => (a.payloadJson as any)?.jobId).filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />
      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1040px] mx-auto space-y-4">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                System <span className="text-gray-400">/</span>
              </p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-[32px] font-bold text-gray-900 leading-none">Activity log</h1>
                <p className="text-[13px] text-gray-500">Audit trail · {periodSubtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Select value={activityPeriod} onValueChange={(v) => setActivityPeriod(v as any)}>
                <SelectTrigger className="h-9 text-[13px] w-[150px] gap-2 bg-white" data-testid="activity-period-select">
                  <CalendarIcon className="w-3.5 h-3.5 text-gray-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {activityPeriod === "custom" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 text-[13px] gap-1.5">
                      <CalendarIcon className="w-3.5 h-3.5" />
                      {customStart && customEnd ? `${customStart} – ${customEnd}` : "Pick dates"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-4 space-y-3" align="end">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">From</label>
                      <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">To</label>
                      <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 text-sm" />
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="h-9 text-[13px] gap-1.5 bg-white"
                data-testid="button-export-csv"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* ── Tabs + search + filters ───────────────────────────────── */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: "all",     label: "All events" },
                { key: "posts",   label: "Posts" },
                { key: "profile", label: "Profile" },
                { key: "reviews", label: "Reviews" },
                { key: "system",  label: "System" },
              ] as Array<{ key: Category; label: string }>).map((tab) => {
                const active = activeCategory === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveCategory(tab.key)}
                    data-testid={`tab-${tab.key}`}
                    className={`flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-[#001f3f] text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`text-[10px] font-semibold px-1.5 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full ${
                        active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tabCounts[tab.key]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by user or location…"
                className="pl-9 h-9 text-[13px] bg-white"
                data-testid="input-search"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Select value={actorFilter} onValueChange={setActorFilter}>
                <SelectTrigger
                  className="h-9 text-[13px] gap-1.5 rounded-full px-3.5 w-auto bg-white"
                  data-testid="filter-actor"
                >
                  <UserIcon className="w-3 h-3" />
                  <SelectValue placeholder="+ Actor">
                    {actorFilter === "all"
                      ? "+ Actor"
                      : actorOptions.find((u) => u.id === actorFilter)?.name || "Actor"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actors</SelectItem>
                  {actorOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger
                  className="h-9 text-[13px] gap-1.5 rounded-full px-3.5 w-auto bg-white"
                  data-testid="filter-location"
                >
                  <MapPin className="w-3 h-3" />
                  <SelectValue placeholder="+ Location">
                    {locationFilter === "all"
                      ? "+ Location"
                      : locationOptions.find((l) => l.id === locationFilter)?.name || "Location"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locationOptions.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── KPI strip ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <KpiCell label="EVENTS" value={kpiEvents.toLocaleString()} sub="this period" />
            <KpiCell label="ACTIVE USERS" value={kpiActiveUsers.toString()} sub={`of ${kpiTotalSeats || 0} seats`} />
            <KpiCell
              label="PROFILE CHANGES"
              value={kpiProfileChanges.toString()}
              sub={kpiProfileChanges > 0 ? "detected on Google" : "none detected"}
              valueClassName={kpiProfileChanges > 0 ? "text-amber-600" : ""}
              subClassName={kpiProfileChanges > 0 ? "text-amber-600" : ""}
            />
            <KpiCell
              label="BULK ACTIONS"
              value={kpiBulkActions.count.toString()}
              sub={`across ${kpiBulkActions.locationsTouched} locs`}
            />
          </div>

          {/* ── Selection toolbar (only shows when items selected) ──── */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-2.5">
              <span className="text-[13px] text-gray-700">
                {selectedIds.size} selected · {selectedJobIds.length} can be reverted
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUndoConfirm(true)}
                disabled={selectedJobIds.length === 0 || bulkUndoMutation.isPending}
                className="h-8 text-[12px] gap-1.5 border-[#001f3f] text-[#001f3f] hover:bg-[#001f3f] hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Revert
              </Button>
            </div>
          )}

          {/* ── Activity list ──────────────────────────────────────── */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500 bg-white border border-gray-200 rounded-2xl">
              <Clock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No activity found for <span className="font-medium">{periodLabel}</span>.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 space-y-6">
              {groupedByDay.map((group) => (
                <div key={group.key}>
                  <p className="text-[12px] uppercase tracking-wider text-gray-900 font-bold px-1 pb-2 border-b-2 border-gray-300">
                    {dayHeaderLabel(group.date)}
                    <span className="text-gray-400 font-normal normal-case tracking-normal ml-2">
                      · {group.items.length} event{group.items.length === 1 ? "" : "s"}
                    </span>
                  </p>
                  <div className="divide-y divide-gray-100">
                    {group.items.map((entry) => (
                      <ActivityRow
                        key={entry.id}
                        entry={entry}
                        selected={selectedIds.has(entry.id)}
                        onToggleSelect={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          });
                        }}
                        onOpenDetails={() => setOpenDetails(entry)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ── Details modal ──────────────────────────────────────────── */}
      <Dialog open={!!openDetails} onOpenChange={(open) => !open && setOpenDetails(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full inline-flex items-center justify-center ${actionIconBg(openDetails ? actionTone(openDetails) : "neutral")}`}>
                {openDetails && actionIcon(openDetails.action)}
              </span>
              {openDetails ? actionVerb(openDetails.action) : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {openDetails ? formatPhoenixDateTime(openDetails.timestamp) : ""}
            </DialogDescription>
          </DialogHeader>
          {openDetails && (
            <EventDetailBody entry={openDetails} locations={locations} />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bulk undo confirm ─────────────────────────────────────── */}
      <AlertDialog open={showUndoConfirm} onOpenChange={setShowUndoConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revert {selectedJobIds.length} {selectedJobIds.length === 1 ? "job" : "jobs"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-gray-600">
                <p>This will undo the selected jobs. Activity log records remain in place.</p>
                {selectedIds.size > selectedJobIds.length && (
                  <p className="text-amber-700 bg-amber-50 rounded px-3 py-2 text-xs">
                    {selectedIds.size - selectedJobIds.length} selected entry/entries have no associated job and will be skipped.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkUndoMutation.mutate(selectedJobIds)}
              disabled={bulkUndoMutation.isPending || selectedJobIds.length === 0}
              className="bg-[#001f3f] hover:bg-[#002a54] text-white"
            >
              {bulkUndoMutation.isPending ? "Reverting…" : "Yes, revert"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function KpiCell({
  label, value, sub, valueClassName = "", subClassName = "",
}: {
  label: string; value: string; sub: string; valueClassName?: string; subClassName?: string;
}) {
  return (
    <div className="px-5 py-4 border-r border-gray-200 last:border-r-0">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-[24px] font-bold text-gray-900 leading-tight mt-1 ${valueClassName}`}>{value}</p>
      <p className={`text-[12px] text-gray-500 mt-0.5 ${subClassName}`}>{sub}</p>
    </div>
  );
}

function ActivityRow({
  entry, selected, onToggleSelect, onOpenDetails,
}: {
  entry: ActivityLogWithUser;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetails: () => void;
}) {
  const tone = actionTone(entry);
  const ts = new Date(entry.timestamp);
  const cat = categoryFor(entry.action);
  const p = (entry.payloadJson as any) || {};
  const actorName = entry.localUser?.name || "System";
  const actorEmail = (entry.localUser as any)?.email || "";

  // Build the "📍 X locations · email" sub-line
  const subParts: React.ReactNode[] = [];
  if (p.locationCount && p.locationCount > 0) {
    subParts.push(
      <span key="loc" className="inline-flex items-center gap-1">
        <MapPin className="w-3 h-3 text-gray-400" />
        {p.locationCount} location{p.locationCount === 1 ? "" : "s"}
      </span>,
    );
  } else if (entry.locationName) {
    subParts.push(
      <span key="loc" className="inline-flex items-center gap-1">
        <MapPin className="w-3 h-3 text-gray-400" />
        {entry.locationName}
      </span>,
    );
  }
  if (actorEmail) subParts.push(<span key="email">{actorEmail}</span>);

  return (
    <div className="flex items-center gap-4 py-2 px-1 group" data-testid={`activity-${entry.id}`}>
      {/* Left column: time */}
      <div className="w-[170px] flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className={`w-6 h-6 rounded-full ${actionIconBg(tone)} flex items-center justify-center transition-colors flex-shrink-0 ${
              selected ? "ring-2 ring-[#001f3f] ring-offset-1" : ""
            }`}
            data-testid={`row-icon-${entry.id}`}
            aria-label={selected ? "Deselect" : "Select"}
          >
            {actionIcon(entry.action)}
          </button>
          <div className="flex items-center gap-1.5 text-[12px] text-gray-700 font-mono">
            <span>{relativeDayLabel(ts)}</span>
            <span className="text-gray-300">/</span>
            <span>{timeOfDay(ts)}</span>
          </div>
        </div>
      </div>

      {/* Middle column: rich content */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] text-gray-900 leading-snug">
          <span className="font-semibold">{actorName}</span>
          <span className="text-gray-400 mx-1.5">·</span>
          <span className="text-gray-600">{actionVerb(entry.action)}</span>
          <span className="text-gray-400 mx-1.5">·</span>
          <span className="font-semibold">{actionTitle(entry)}</span>
        </p>
        {subParts.length > 0 && (
          <p className="text-[12px] text-gray-500 mt-1 flex items-center flex-wrap gap-x-3 gap-y-0.5">
            {subParts.map((part, i) => (
              <span key={i} className="inline-flex items-center">
                {i > 0 && <span className="text-gray-300 mr-3">·</span>}
                {part}
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Right column: details link */}
      <button
        onClick={onOpenDetails}
        data-testid={`details-${entry.id}`}
        className="flex-shrink-0 flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 transition-colors pt-0.5"
      >
        Details
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Comprehensive details for the modal ──────────────────────────────────────
function EventDetailBody({
  entry, locations,
}: {
  entry: ActivityLogWithUser;
  locations: ClientLocation[];
}) {
  const p = (entry.payloadJson as any) || {};
  const action = entry.action;

  // Resolve a list of involved locations from various payload shapes
  const locById = new Map(locations.map((l) => [l.id, l]));
  const involved: Array<{ id?: string; name: string; address?: string | null; status?: string }> = [];
  if (Array.isArray(p.locations)) {
    for (const l of p.locations) {
      const match = l.id ? locById.get(l.id) : undefined;
      involved.push({
        id: l.id,
        name: l.name || match?.name || "Unknown",
        address: match?.address ?? l.address ?? null,
        status: l.googleUpdated === true ? "success" : l.googleUpdated === false ? "failed" : undefined,
      });
    }
  } else if (Array.isArray(p.locationIds)) {
    for (const id of p.locationIds) {
      const match = locById.get(id);
      involved.push({ id, name: match?.name || "Unknown", address: match?.address ?? null });
    }
  } else if (Array.isArray(p.locationNames)) {
    for (const name of p.locationNames) {
      const match = locations.find((l) => l.name === name);
      involved.push({ name, address: match?.address ?? null, id: match?.id });
    }
  } else if (entry.clientLocationId) {
    const match = locById.get(entry.clientLocationId);
    involved.push({
      id: entry.clientLocationId,
      name: match?.name || entry.locationName || "Unknown",
      address: match?.address ?? null,
    });
  } else if (entry.locationName) {
    involved.push({ name: entry.locationName });
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Who / when / category */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <DetailField label="Actor" value={entry.localUser?.name || "System"} sub={entry.localUser?.title || undefined} />
        <DetailField label="Category" value={categoryLabel(categoryFor(action))} />
        <DetailField label="When" value={formatPhoenixDateTime(entry.timestamp)} />
        <DetailField
          label="Status"
          value={
            entry.jobStatus
              ? entry.jobStatus.charAt(0).toUpperCase() + entry.jobStatus.slice(1)
              : action === "location_info_changed" ? "Detected on Google" : "Recorded"
          }
        />
      </div>

      {/* Action-specific change details */}
      {action === "location_info_changed" && Array.isArray(p.changes) && p.changes.length > 0 && (
        <SectionCard title="What changed">
          <div className="space-y-3">
            {p.changes.map((c: any, i: number) => (
              <div key={i} className="border border-gray-200 rounded-md p-3 bg-white">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                  {String(c.field || "Field").replace(/_/g, " ")}
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-[11px] text-gray-500 mb-0.5">Was</p>
                    <p className="text-[13px] text-gray-700 bg-red-50 border border-red-100 rounded px-2 py-1.5 whitespace-pre-wrap break-words">
                      {c.old || <span className="italic text-gray-400">(empty)</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500 mb-0.5">Now</p>
                    <p className="text-[13px] text-gray-800 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5 whitespace-pre-wrap break-words">
                      {c.new || <span className="italic text-gray-400">(empty)</span>}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {action === "bulk_social_media_updated" && p.socialMedia && (
        <SectionCard title="Social links saved">
          <div className="space-y-1.5">
            {Object.entries(p.socialMedia).filter(([, v]) => !!v).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded px-3 py-2">
                <span className="text-[12px] font-medium text-gray-700 w-28 flex-shrink-0">
                  {SOCIAL_PLATFORM_LABELS[k] || k}
                </span>
                <a
                  href={String(v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-[#001f3f] hover:underline truncate"
                >
                  {String(v)}
                </a>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {(action === "post_created_in_app" || action === "posts_csv_uploaded") && (
        <SectionCard title="Post content">
          <div className="bg-white border border-gray-200 rounded p-3 space-y-2">
            {(p.imageUrl || p.media?.[0]?.sourceUrl) && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">Image</p>
                <img
                  src={p.imageUrl || p.media?.[0]?.sourceUrl}
                  alt="Post image"
                  className="rounded-md w-full object-cover max-h-52"
                />
              </div>
            )}
            {p.title && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">Title</p>
                <p className="text-[13px] text-gray-800">{p.title}</p>
              </div>
            )}
            {p.summary && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">Description</p>
                <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{p.summary}</p>
              </div>
            )}
            {p.callToAction?.url && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">Call to action</p>
                <p className="text-[12px]">
                  <span className="px-1.5 py-0.5 bg-gray-100 rounded mr-2">
                    {String(p.callToAction.actionType || "").replace(/_/g, " ")}
                  </span>
                  <a href={p.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-[#001f3f] hover:underline break-all">
                    {p.callToAction.url}
                  </a>
                </p>
              </div>
            )}
            {p.scheduledFor && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">Scheduled for</p>
                <p className="text-[13px] text-gray-800">{formatPhoenixDateTime(p.scheduledFor)}</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {action === "review_email_sent" && (
        <SectionCard title="Email">
          <div className="bg-white border border-gray-200 rounded p-3 space-y-1.5 text-[13px] text-gray-800">
            {p.recipient && (<div><span className="text-gray-500">Recipient:</span> {p.recipient}</div>)}
            {p.subject && (<div><span className="text-gray-500">Subject:</span> {p.subject}</div>)}
            {p.reviewCount != null && (<div><span className="text-gray-500">Reviews included:</span> {p.reviewCount}</div>)}
            {p.locationCount != null && (<div><span className="text-gray-500">Locations:</span> {p.locationCount}</div>)}
          </div>
        </SectionCard>
      )}

      {(action === "regular_hours_updated_in_app" || action === "special_hours_updated_in_app" || action === "hours_updated_in_app" || action === "hours_csv_uploaded" || action === "bulk_hours_updated") && (p.hoursData || p.regularHours || p.specialHours) && (
        <SectionCard title="Hours">
          <HoursDisplay
            regularHours={p.hoursData?.regularHours || p.regularHours}
            specialHours={p.hoursData?.specialHours || p.specialHours}
          />
        </SectionCard>
      )}

      {(action === "photos_uploaded_in_app" || action === "photos_csv_uploaded") && (
        <SectionCard title="Photos">
          <div className="bg-white border border-gray-200 rounded p-3 text-[13px] text-gray-800">
            {p.photoCount != null && (<div><span className="text-gray-500">Total uploaded:</span> {p.photoCount}</div>)}
            {p.category && (<div><span className="text-gray-500">Category:</span> {p.category}</div>)}
          </div>
        </SectionCard>
      )}

      {/* Locations involved */}
      {involved.length > 0 && (
        <SectionCard title={`Location${involved.length === 1 ? "" : "s"} (${involved.length})`}>
          <div className="border border-gray-200 rounded divide-y bg-white max-h-64 overflow-auto">
            {involved.map((l, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-gray-800 font-medium truncate">{l.name}</p>
                  {l.address && (
                    <p className="text-[11px] text-gray-500 mt-0.5 flex items-start gap-1">
                      <MapPin className="w-3 h-3 mt-[2px] flex-shrink-0" />
                      <span className="truncate">{l.address}</span>
                    </p>
                  )}
                </div>
                {l.status && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                    l.status === "success" ? "bg-emerald-100 text-emerald-700"
                    : l.status === "failed" ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
                  }`}>
                    {l.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Job-level breakdown when an associated job exists */}
      {p.jobId && (
        <SectionCard title="Job result">
          <ActivityDetails jobId={p.jobId} />
        </SectionCard>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5 font-medium">{title}</p>
      {children}
    </div>
  );
}

function DetailField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-[13px] text-gray-800 mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function HoursDisplay({ regularHours, specialHours }: { regularHours?: any; specialHours?: any[] }) {
  const formatTime = (time: string) => {
    if (!time) return "";
    const [h, m] = time.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
  };
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return (
    <div className="bg-white border border-gray-200 rounded p-3 space-y-3">
      {regularHours && typeof regularHours === "object" && (
        <div className="grid grid-cols-2 gap-2">
          {days.filter((d) => regularHours[d]).map((day) => {
            const h = regularHours[day];
            return (
              <div key={day} className="text-[12px]">
                <span className="capitalize text-gray-500 block">{day}</span>
                <span className="text-gray-800 font-medium">
                  {h.isOpen ? `${formatTime(h.openTime)} – ${formatTime(h.closeTime)}` : "Closed"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {Array.isArray(specialHours) && specialHours.length > 0 && (
        <div className="border-t border-gray-100 pt-2 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Special dates</p>
          {specialHours.map((period: any, idx: number) => {
            const [y, mo, d] = String(period.date || "").split("-").map(Number);
            const dateLabel = y && mo && d ? new Date(y, mo - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : period.date;
            return (
              <div key={idx} className="flex items-center justify-between text-[12px]">
                <span className="text-gray-700">{dateLabel}</span>
                <span className="text-gray-800 font-medium">
                  {period.isClosed ? "Closed" : `${formatTime(period.openTime)} – ${formatTime(period.closeTime)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
