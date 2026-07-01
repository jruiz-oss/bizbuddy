import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, MapPin, Phone, Globe, Star, Clock,
  Pencil, MessageSquare, BarChart3, AlertCircle, Navigation, Eye,
  BarChart2, TrendingUp, Calendar, FileText, Share2,
  Twitter, Instagram, Facebook, Linkedin, Youtube,
  Check, X, Loader2,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import type { ClientLocation } from "@shared/schema";

interface GbpPerformanceData {
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  impressionsTotal: number;
  daily: Array<{
    date: string;
    impressions: number;
    callClicks: number;
    websiteClicks: number;
    directionRequests: number;
  }>;
  earliestDate: string | null;
}

function formatTime12(hours: number, minutes: number) {
  const h = hours || 0;
  const m = minutes || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};

interface LocationDetailViewProps {
  location: ClientLocation;
  onBack: () => void;
  onEditClick: (location: ClientLocation) => void;
  onCreatePost: (location: ClientLocation) => void;
  onUpdateHours: (location: ClientLocation) => void;
}

const RANGE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1yr", days: 365 },
] as const;

type MetricKey = "impressions" | "callClicks" | "websiteClicks" | "directionRequests";

const METRICS: Array<{
  key: MetricKey;
  label: string;
  color: string;
  iconBg: string;
  dataKey: string;
  statKey: keyof GbpPerformanceData;
}> = [
  {
    key: "impressions",
    label: "Impressions",
    color: "#f59e0b",
    iconBg: "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
    dataKey: "impressions",
    statKey: "impressionsTotal",
  },
  {
    key: "callClicks",
    label: "Call Clicks",
    color: "#3b82f6",
    iconBg: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    dataKey: "callClicks",
    statKey: "callClicks",
  },
  {
    key: "websiteClicks",
    label: "Website Clicks",
    color: "#8b5cf6",
    iconBg: "bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400",
    dataKey: "websiteClicks",
    statKey: "websiteClicks",
  },
  {
    key: "directionRequests",
    label: "Directions",
    color: "#10b981",
    iconBg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    dataKey: "directionRequests",
    statKey: "directionRequests",
  },
];

const METRIC_ICONS: Record<MetricKey, JSX.Element> = {
  impressions: <Eye className="w-4 h-4" />,
  callClicks: <Phone className="w-4 h-4" />,
  websiteClicks: <Globe className="w-4 h-4" />,
  directionRequests: <Navigation className="w-4 h-4" />,
};

function PerformanceSection({ locationId }: { locationId: string }) {
  const [days, setDays] = useState(30);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(new Set(["impressions"]));

  // Current period
  const { data, isLoading, isError, error } = useQuery<GbpPerformanceData>({
    queryKey: ["/api/locations", locationId, "performance", days, 0],
    queryFn: async () => {
      const res = await fetch(getApiUrl(`/api/locations/${locationId}/performance?days=${days}&offset=0&_t=${Date.now()}`), { cache: "no-store", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load performance data");
      }
      return res.json();
    },
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  // Previous period (only fetched when Compare is on)
  const { data: prevData, isLoading: prevLoading } = useQuery<GbpPerformanceData>({
    queryKey: ["/api/locations", locationId, "performance", days, 1],
    queryFn: async () => {
      const res = await fetch(getApiUrl(`/api/locations/${locationId}/performance?days=${days}&offset=1&_t=${Date.now()}`), { cache: "no-store", credentials: "include" });
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: !!locationId && compareEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const earliestDate = data?.earliestDate ?? null;
  const daysOfHistory = earliestDate
    ? Math.round((Date.now() - new Date(earliestDate).getTime()) / 86400000)
    : 90;

  function toggleMetric(key: MetricKey) {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Build chart data: merge current + comparison into one series per day-index
  const currentDaily = data?.daily || [];
  const prevDaily = prevData?.daily || [];

  const chartData = currentDaily.map((d, i) => {
    const row: Record<string, any> = {
      date: d.date.slice(5),
      impressions: d.impressions,
      callClicks: d.callClicks,
      websiteClicks: d.websiteClicks,
      directionRequests: d.directionRequests,
    };
    if (compareEnabled && prevDaily[i]) {
      row["impressions_prev"] = prevDaily[i].impressions;
      row["callClicks_prev"] = prevDaily[i].callClicks;
      row["websiteClicks_prev"] = prevDaily[i].websiteClicks;
      row["directionRequests_prev"] = prevDaily[i].directionRequests;
    }
    return row;
  });

  const tickInterval = Math.max(1, Math.floor(chartData.length / 7));

  const tooltipStyle = {
    contentStyle: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      fontSize: "12px",
      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    },
  };

  const activeMetricList = METRICS.filter((m) => activeMetrics.has(m.key));

  // Label for the comparison period
  const comparePeriodLabel = days <= 7 ? "Prev 7d" : days <= 30 ? "Prev 30d" : days <= 90 ? "Prev 90d" : days <= 180 ? "Prev 180d" : "Prev yr";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 tracking-wide uppercase">
            GBP Performance
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Chart type toggle */}
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs" data-testid="chart-type-toggle">
            <button
              onClick={() => setChartType("line")}
              data-testid="chart-type-line"
              title="Line chart"
              className={`px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${
                chartType === "line"
                  ? "bg-[#001f3f] text-white"
                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Line
            </button>
            <button
              onClick={() => setChartType("bar")}
              data-testid="chart-type-bar"
              title="Bar chart"
              className={`px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${
                chartType === "bar"
                  ? "bg-[#001f3f] text-white"
                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Bar
            </button>
          </div>

          {/* Compare toggle */}
          <button
            onClick={() => setCompareEnabled((v) => !v)}
            data-testid="chart-compare-toggle"
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
              compareEnabled
                ? "bg-[#001f3f] text-white border-[#001f3f]"
                : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
            title="Compare with previous period"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Compare
          </button>

          {/* Date range */}
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs" data-testid="panel-toggle-date-range">
            {RANGE_OPTIONS.map((opt) => {
              const available = opt.days <= Math.max(daysOfHistory, 90);
              return (
                <button
                  key={opt.days}
                  onClick={() => setDays(opt.days)}
                  disabled={!available}
                  title={
                    !available
                      ? `Data collection started ${earliestDate ?? "recently"} — not enough history yet`
                      : undefined
                  }
                  data-testid={`panel-toggle-days-${opt.days}`}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    days === opt.days
                      ? "bg-[#001f3f] text-white"
                      : available
                      ? "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-6">
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-14" />
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm mb-4"
            data-testid="panel-gbp-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{(error as Error)?.message || "Failed to load data from Google."}</p>
            </div>
          </div>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Metric stat cards — click to toggle on chart */}
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
              Click a metric to show/hide it on the chart
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {METRICS.map((m) => {
                const isActive = activeMetrics.has(m.key);
                const value = (data[m.statKey] as number) ?? 0;
                const prevValue = compareEnabled ? (prevData?.[m.statKey] as number) ?? null : null;
                const pctChange = prevValue != null && prevValue > 0
                  ? Math.round(((value - prevValue) / prevValue) * 100)
                  : null;
                return (
                  <button
                    key={m.key}
                    onClick={() => toggleMetric(m.key)}
                    data-testid={`panel-stat-${m.key}`}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      isActive
                        ? "border-gray-300 dark:border-gray-500 shadow-sm"
                        : "border-gray-100 dark:border-gray-700 opacity-50 hover:opacity-75"
                    }`}
                    style={isActive ? { boxShadow: `0 0 0 2px ${m.color}44` } : undefined}
                  >
                    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-3 ${m.iconBg}`}>
                      {METRIC_ICONS[m.key]}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{m.label}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                      {value.toLocaleString()}
                    </p>
                    {compareEnabled && prevValue !== null && (
                      <p className={`text-xs mt-1 font-medium ${
                        pctChange === null ? "text-gray-400"
                          : pctChange > 0 ? "text-emerald-600"
                          : pctChange < 0 ? "text-red-500"
                          : "text-gray-400"
                      }`}>
                        {pctChange === null ? "—"
                          : pctChange > 0 ? `+${pctChange}% vs prev`
                          : pctChange < 0 ? `${pctChange}% vs prev`
                          : "No change"}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Chart */}
            <div data-testid="panel-gbp-chart">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  {activeMetricList.length === 1
                    ? `Daily ${activeMetricList[0].label}`
                    : "Daily Metrics"}
                </p>
                {/* Legend */}
                <div className="flex items-center gap-4 flex-wrap justify-end">
                  {activeMetricList.map((m) => (
                    <span key={m.key} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className="w-2.5 h-0.5 inline-block rounded" style={{ background: m.color }} />
                      {m.label}
                    </span>
                  ))}
                  {compareEnabled && activeMetricList.map((m) => (
                    <span key={`${m.key}_prev`} className="flex items-center gap-1 text-xs text-gray-400">
                      <span className="w-2.5 h-0.5 inline-block rounded opacity-50" style={{ background: m.color }} />
                      {comparePeriodLabel}
                    </span>
                  ))}
                </div>
              </div>

              {(prevLoading && compareEnabled) && (
                <div className="h-2 mb-2">
                  <div className="h-1 bg-gray-100 rounded animate-pulse" />
                </div>
              )}

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  {chartType === "bar" ? (
                    <BarChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickInterval} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle} />
                      {activeMetricList.map((m) => (
                        <Bar key={m.key} dataKey={m.dataKey} name={m.label} radius={[3, 3, 0, 0]} fill={m.color} />
                      ))}
                      {compareEnabled && activeMetricList.map((m) => (
                        <Bar key={`${m.key}_prev`} dataKey={`${m.dataKey}_prev`} name={`${m.label} (prev)`} radius={[3, 3, 0, 0]} fill={m.color} opacity={0.35} />
                      ))}
                    </BarChart>
                  ) : (
                    <LineChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={tickInterval} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle} />
                      {activeMetricList.map((m) => (
                        <Line key={m.key} type="monotone" dataKey={m.dataKey} name={m.label} stroke={m.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      ))}
                      {compareEnabled && activeMetricList.map((m) => (
                        <Line key={`${m.key}_prev`} type="monotone" dataKey={`${m.dataKey}_prev`} name={`${m.label} (prev)`} stroke={m.color} strokeWidth={1.5} strokeDasharray="5 3" dot={false} opacity={0.5} />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No data for this period.</p>
              )}
            </div>

            {/* Data history note */}
            {earliestDate && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3" data-testid="panel-history-note">
                {daysOfHistory < 180
                  ? `Historical data collection started ${earliestDate}. Longer ranges (180d, 1yr) will unlock as data accumulates.`
                  : `Historical data available from ${earliestDate}.`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SOCIAL_ICONS: Record<string, JSX.Element> = {
  twitter: <Twitter className="w-3.5 h-3.5" />,
  instagram: <Instagram className="w-3.5 h-3.5" />,
  facebook: <Facebook className="w-3.5 h-3.5" />,
  linkedin: <Linkedin className="w-3.5 h-3.5" />,
  youtube: <Youtube className="w-3.5 h-3.5" />,
};

type EditableField = "phone" | "website" | "description";

export function LocationDetailView({
  location,
  onBack,
  onEditClick,
  onCreatePost,
  onUpdateHours,
}: LocationDetailViewProps) {
  const loc = location as any;
  const hours: any[] = loc.regularHours?.periods ?? [];
  const social: Record<string, string> = loc.socialMedia ?? {};
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Inline edit state — tracks which field is open and its draft value
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  // Local overrides so UI updates immediately after save without waiting for refetch
  const [localOverrides, setLocalOverrides] = useState<Partial<Record<EditableField, string>>>({});

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editingField) inputRef.current?.focus();
  }, [editingField]);

  const currentValue = (field: EditableField) =>
    localOverrides[field] !== undefined ? localOverrides[field]! : (loc[field] ?? "");

  function startEdit(field: EditableField) {
    setEditingField(field);
    setDraft(currentValue(field));
  }
  function cancelEdit() {
    setEditingField(null);
    setDraft("");
  }

  const detailsMutation = useMutation({
    mutationFn: async ({ field, value }: { field: EditableField; value: string }) =>
      apiRequest("PATCH", `/api/locations/${location.id}/details`, { [field]: value }),
    onSuccess: (_, { field, value }) => {
      setLocalOverrides((prev) => ({ ...prev, [field]: value }));
      setEditingField(null);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Saved", description: "Change pushed to Google Business Profile." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message || "Something went wrong.", variant: "destructive" });
    },
  });

  function saveEdit() {
    if (!editingField) return;
    detailsMutation.mutate({ field: editingField, value: draft.trim() });
  }

  // Inline editable field row component (defined inside so it shares closure)
  function InlineFieldRow({
    field,
    icon,
    label,
    multiline = false,
    renderDisplay,
    testId,
  }: {
    field: EditableField;
    icon: JSX.Element;
    label: string;
    multiline?: boolean;
    renderDisplay?: () => JSX.Element;
    testId?: string;
  }) {
    const isEditing = editingField === field;
    const isSaving = detailsMutation.isPending && detailsMutation.variables?.field === field;
    const val = currentValue(field);

    return (
      <div className="group flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
          {isEditing ? (
            <div className="flex flex-col gap-2">
              {multiline ? (
                <textarea
                  ref={inputRef as any}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#001f3f] resize-none"
                  data-testid={`inline-input-${field}`}
                  onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                />
              ) : (
                <input
                  ref={inputRef as any}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#001f3f]"
                  data-testid={`inline-input-${field}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={saveEdit}
                  disabled={isSaving}
                  data-testid={`inline-save-${field}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#001f3f] text-white text-xs font-medium hover:bg-[#002a57] disabled:opacity-60 transition-colors"
                >
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={isSaving}
                  data-testid={`inline-cancel-${field}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0" data-testid={testId}>
                {renderDisplay ? renderDisplay() : (
                  <p className="text-sm font-medium text-gray-900 dark:text-white break-all">
                    {val || <span className="text-gray-400 font-normal">Not set</span>}
                  </p>
                )}
              </div>
              <button
                onClick={() => startEdit(field)}
                disabled={!!editingField}
                data-testid={`inline-edit-btn-${field}`}
                className="shrink-0 p-1 rounded-md text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                title={`Edit ${label}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const statusColor =
    location.status === "active"
      ? "bg-green-100 text-green-700"
      : location.status === "temporarily_closed"
      ? "bg-yellow-100 text-yellow-700"
      : location.status === "permanently_closed"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  const statusLabel =
    location.status === "temporarily_closed"
      ? "Temp Closed"
      : location.status === "permanently_closed"
      ? "Perm Closed"
      : location.status ?? "Unknown";

  const socialEntries = Object.entries(social).filter(([, v]) => v);

  return (
    <div className="flex-1 overflow-auto" data-testid="location-detail-view">
      {/* Back button + header */}
      <div className="bg-[#001f3f] px-6 pt-5 pb-6">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm mb-4 transition-colors"
            data-testid="button-back-to-locations"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Locations
          </button>
          <div className="flex items-start justify-between gap-4">
            <h2
              className="text-2xl font-bold text-white leading-tight"
              data-testid="detail-location-name"
            >
              {location.name}
            </h2>
            <Badge
              className={`shrink-0 mt-1 ${statusColor}`}
              data-testid="detail-location-status"
            >
              {statusLabel}
            </Badge>
          </div>
          {location.address && (
            <div className="flex items-start gap-2 mt-2">
              <MapPin className="w-4 h-4 text-white/60 mt-0.5 shrink-0" />
              <p className="text-sm text-white/75" data-testid="detail-location-address">
                {location.address}
                {loc.city ? `, ${loc.city}` : ""}
              </p>
            </div>
          )}
          {location.averageRating && (
            <div className="flex items-center gap-2 mt-2">
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
              <span className="text-sm text-white/90 font-medium" data-testid="detail-location-rating">
                {location.averageRating} ({loc.totalReviews ?? 0} reviews)
              </span>
            </div>
          )}
          {(localOverrides.description !== undefined ? localOverrides.description : loc.description) && (
            <p className="text-sm text-white/70 mt-3 leading-relaxed max-w-2xl" data-testid="detail-location-description">
              {localOverrides.description ?? loc.description}
            </p>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-4xl mx-auto w-full">
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => onCreatePost(location)} data-testid="detail-button-create-post" className="border-gray-300">
            <MessageSquare className="w-4 h-4 mr-2" />
            Create Post
          </Button>
          <Button variant="outline" onClick={() => onUpdateHours(location)} data-testid="detail-button-update-hours" className="border-gray-300">
            <Clock className="w-4 h-4 mr-2" />
            Update Hours
          </Button>
        </div>

        {/* GBP Performance */}
        <PerformanceSection locationId={location.id} />

        {/* Location Info — inline editable */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          <div className="px-6 py-4 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Location Info</h3>
            <p className="text-xs text-gray-400">Hover a field to edit</p>
          </div>

          {/* Phone + Website */}
          <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <InlineFieldRow
              field="phone"
              icon={<Phone className="w-4 h-4" />}
              label="Phone"
              testId="detail-location-phone"
            />
            <InlineFieldRow
              field="website"
              icon={<Globe className="w-4 h-4" />}
              label="Website"
              testId="detail-location-website"
              renderDisplay={() => {
                const val = currentValue("website");
                return val ? (
                  <a href={val} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                    {val}
                  </a>
                ) : (
                  <p className="text-sm text-gray-400">Not set</p>
                );
              }}
            />

            {/* GBP ID — read only */}
            {location.gbpLocationId && (
              <div className="flex items-start gap-3 sm:col-span-2">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">GBP Location ID</p>
                  <p className="text-xs font-mono text-gray-600 dark:text-gray-300 break-all" data-testid="detail-location-gbp-id">
                    {location.gbpLocationId}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="px-6 py-4">
            <InlineFieldRow
              field="description"
              icon={<FileText className="w-4 h-4" />}
              label="Business Description"
              multiline
              testId="detail-location-description-field"
              renderDisplay={() => {
                const val = currentValue("description");
                return val ? (
                  <p className="text-sm text-gray-900 dark:text-white leading-relaxed">{val}</p>
                ) : (
                  <p className="text-sm text-gray-400">Not set</p>
                );
              }}
            />
          </div>

          {/* Business Hours */}
          <div className="px-6 py-4">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">Business Hours</p>
                  <button
                    onClick={() => onUpdateHours(location)}
                    data-testid="inline-edit-btn-hours"
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                </div>
                {hours.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1" data-testid="detail-location-hours">
                    {hours.map((period: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm max-w-xs">
                        <span className="text-gray-500 w-10">{DAY_LABELS[period.openDay] ?? period.openDay}</span>
                        <span className="text-gray-900 dark:text-white">
                          {formatTime12(period.openTime?.hours, period.openTime?.minutes)} –{" "}
                          {formatTime12(period.closeTime?.hours, period.closeTime?.minutes)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Not set</p>
                )}
              </div>
            </div>
          </div>

          {/* Social Media */}
          {socialEntries.length > 0 && (
            <div className="px-6 py-4">
              <div className="flex items-start gap-3">
                <Share2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 mb-2">Social Media</p>
                  <div className="flex flex-wrap gap-2" data-testid="detail-location-social">
                    {socialEntries.map(([platform, url]) => (
                      <a
                        key={platform}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors capitalize"
                        data-testid={`detail-social-${platform}`}
                      >
                        {SOCIAL_ICONS[platform] ?? <Globe className="w-3.5 h-3.5" />}
                        {platform.charAt(0).toUpperCase() + platform.slice(1)}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Activity Timestamps */}
          <div className="px-6 py-4">
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 mb-2">Activity (via BizBuddy)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-2">
                  <div>
                    <p className="text-xs text-gray-400">Last Post</p>
                    <p className="text-sm text-gray-900 dark:text-white" data-testid="detail-last-post">
                      {formatDate(loc.lastPostAt) ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Last Hours Update</p>
                    <p className="text-sm text-gray-900 dark:text-white" data-testid="detail-last-hours">
                      {formatDate(loc.lastHoursUpdateAt) ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Last Photo</p>
                    <p className="text-sm text-gray-900 dark:text-white" data-testid="detail-last-photo">
                      {formatDate(loc.lastPhotoAt) ?? "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {location.hidden && (
            <div className="px-6 py-3 bg-yellow-50 dark:bg-yellow-900/20">
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                This location is hidden from filtered views.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
