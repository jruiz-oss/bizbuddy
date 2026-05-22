import { SideNav } from "@/components/SideNav";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Search, MapPin, Phone, Star, Folder, FolderPlus, FolderMinus, Loader2,
  EyeOff, Eye, RefreshCw, Pencil, ExternalLink, AlertTriangle,
  Map as MapIcon, Table as TableIcon, Columns as ColumnsIcon, LayoutGrid,
  Download, SlidersHorizontal, Maximize2, Clock, MessageSquarePlus, ImagePlus, Tag as TagIcon, CheckSquare, X,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { HoursEditorModal } from "@/components/modals/hours-editor-modal";
import { PostCreationModal } from "@/components/modals/post-creation-modal";
import { PhotoUploadModal } from "@/components/modals/photo-upload-modal";
import { FolderManagementModal } from "@/components/modals/folder-management-modal";
import { AddToFolderModal } from "@/components/modals/add-to-folder-modal";
import { TagManagementModal } from "@/components/modals/tag-management-modal";
import { AddToTagModal } from "@/components/modals/add-to-tag-modal";
import { LocationDetailView } from "@/components/location-detail-view";
import type { Client, ClientLocation, LocationFolder, LocationTag } from "@shared/schema";

import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LocationsProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

type PinStatus = "verified" | "edit_pending" | "needs_reauth" | "suspended" | "temp_closed";

const PIN_COLORS: Record<PinStatus, string> = {
  verified: "#16a34a",       // green
  edit_pending: "#eab308",   // yellow
  needs_reauth: "#f59e0b",   // amber
  suspended: "#dc2626",      // red
  temp_closed: "#9ca3af",    // grey
};

const PIN_LABELS: Record<PinStatus, string> = {
  verified: "Verified",
  edit_pending: "Edit pending",
  needs_reauth: "Needs re-auth",
  suspended: "Suspended / closed",
  temp_closed: "Temp closed",
};

interface CardColumns {
  calls: boolean;
  views: boolean;
  rating: boolean;
  phone: boolean;
}

const DEFAULT_COLUMNS: CardColumns = { calls: true, views: true, rating: true, phone: true };

// Type-safe payload for the PATCH /api/locations/:id/details endpoint
interface LocationDetailsPayload {
  phone?: string;
  website?: string;
  description?: string;
}

function pinStatusFor(loc: ClientLocation, client?: Client): PinStatus {
  if (client?.accountState === "suspended") return "suspended";
  if (loc.status === "permanently_closed") return "suspended";
  if (client?.accountState === "needs_reauth") return "needs_reauth";
  if (loc.status === "temporarily_closed") return "temp_closed";
  if (loc.editPending) return "edit_pending";
  return "verified";
}

function makePinIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 36 : 28;
  const ring = selected ? `box-shadow:0 0 0 4px rgba(0,0,0,0.12),0 2px 6px rgba(0,0,0,0.25);` : `box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
  return L.divIcon({
    className: "gbp-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
      <div style="width:${size - 8}px;height:${size - 8}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;${ring}">
        <div style="width:8px;height:8px;background:#fff;border-radius:50%;margin:auto;margin-top:6px;transform:rotate(45deg);"></div>
      </div>
    </div>`,
  });
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

interface PinPoint {
  id: string;
  lat: number;
  lng: number;
  loc: ClientLocation;
  status: PinStatus;
}

function FitBounds({
  points,
  primaryId,
  selectionIds,
}: {
  points: PinPoint[];
  primaryId: string | null;
  selectionIds: string[];
}) {
  const map = useMap();
  const selectionKey = selectionIds.slice().sort().join(",");
  // Mainland US bounds (SW, NE).
  const US_BOUNDS = L.latLngBounds([24.5, -125], [49.5, -66]);
  // On first mount, force the map to mainland US (overrides any preserved
  // Leaflet state from a previous session/HMR).
  useEffect(() => {
    map.fitBounds(US_BOUNDS, { padding: [10, 10], animate: false });
  }, []);
  useEffect(() => {
    if (selectionIds.length >= 1) {
      const subset = points.filter((p) => selectionIds.includes(p.id));
      if (subset.length > 1) {
        const bounds = L.latLngBounds(subset.map((p) => [p.lat, p.lng] as [number, number]));
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
        return;
      }
      if (subset.length === 1) {
        map.flyTo([subset[0].lat, subset[0].lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
        return;
      }
    }
    if (primaryId) {
      const sel = points.find((p) => p.id === primaryId);
      if (sel) {
        map.flyTo([sel.lat, sel.lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
        return;
      }
    }
    // No selection and no focused pin → snap back to mainland US.
    map.fitBounds(US_BOUNDS, { padding: [10, 10], animate: false });
  }, [primaryId, selectionKey]);
  return null;
}

// Build a CSV string from the filtered locations + status + call counts
function toCsv(rows: Array<{ loc: ClientLocation; status: PinStatus; client?: Client; calls: number }>): string {
  const header = ["Name", "Status", "Client", "Address", "City", "Phone", "Website", "Calls (30d)", "Rating", "Reviews", "Latitude", "Longitude"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      escape(r.loc.name),
      escape(PIN_LABELS[r.status]),
      escape(r.client?.name ?? ""),
      escape(r.loc.address ?? ""),
      escape(r.loc.city ?? ""),
      escape(r.loc.phone ?? ""),
      escape(r.loc.website ?? ""),
      escape(r.calls),
      escape(r.loc.averageRating ?? ""),
      escape(r.loc.totalReviews ?? ""),
      escape(r.loc.latitude ?? ""),
      escape(r.loc.longitude ?? ""),
    ].join(","));
  }
  return lines.join("\n");
}

export default function Locations({ selectedClientId, setSelectedClientId }: LocationsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  // Page-local client filter, separate from the global selectedClientId
  // used by other pages (Posts, Hours, etc.). Defaults to "all" so the
  // map and list show every location across every client by default.
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showFolderManagementModal, setShowFolderManagementModal] = useState(false);
  const [showAddToFolderModal, setShowAddToFolderModal] = useState(false);
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showAddToTagModal, setShowAddToTagModal] = useState(false);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ClientLocation | null>(null);
  const [detailLocation, setDetailLocation] = useState<ClientLocation | null>(null);
  // Multi-select on the map: a primary "focused" pin + a Set of selected pins
  // (the right-pane uses checkboxes; map auto-fits to the selected subset)
  const [primaryPinId, setPrimaryPinId] = useState<string | null>(null);
  const [selectedPinIds, setSelectedPinIds] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<CardColumns>(DEFAULT_COLUMNS);
  const [editFormData, setEditFormData] = useState<LocationDetailsPayload>({ phone: "", website: "", description: "" });

  const { toast } = useToast();
  const { showApiError } = useApiError();
  const queryClientInstance = useQueryClient();

  // ───────── Queries ─────────
  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: allLocations = [] } = useQuery<ClientLocation[]>({ queryKey: ["/api/locations/all"] });
  const { data: hiddenLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/locations/hidden"],
    queryFn: async () => {
      const r = await fetch("/api/locations/hidden");
      if (!r.ok) throw new Error("Failed to fetch hidden locations");
      return r.json() as Promise<ClientLocation[]>;
    },
    enabled: folderFilter === "hidden",
  });
  const { data: folders = [] } = useQuery<LocationFolder[]>({ queryKey: ["/api/folders"] });
  const { data: tags = [] } = useQuery<LocationTag[]>({ queryKey: ["/api/tags"] });
  const { data: tagLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/tags", tagFilter, "locations"],
    queryFn: async () => {
      const r = await fetch(`/api/tags/${tagFilter}/locations`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<ClientLocation[]>;
    },
    enabled: tagFilter !== "all",
  });
  const { data: folderLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const r = await fetch(`/api/folders/${folderFilter}/locations`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<ClientLocation[]>;
    },
    enabled: folderFilter !== "all" && folderFilter !== "hidden",
  });

  // Bulk call counts for the NEARBY badges (cached server-side, no rate limits)
  const { data: callCountsResp } = useQuery<{ counts: Record<string, number>; days: number }>({
    queryKey: ["/api/locations/call-counts"],
  });
  const callCounts: Record<string, number> = callCountsResp?.counts ?? {};

  // Auto-sync once on mount — surfaces fresh lat/lng + pending edits + accountState
  useEffect(() => {
    if (selectedClientId && !hasAutoSynced) {
      (async () => {
        try {
          const r = await fetch("/api/sync/accounts", { method: "POST", headers: { "Content-Type": "application/json" } });
          if (r.ok) {
            queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });
            queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
            setHasAutoSynced(true);
          } else if (r.status === 401) {
            const body = (await r.json().catch(() => ({}))) as { accountState?: string };
            if (body?.accountState === "needs_reauth") {
              queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
              showApiError("Reconnect required", "Your Google connection has expired. Please reconnect your account.");
            }
          }
        } catch (err) {
          console.error("Auto-sync failed:", err);
        }
      })();
    }
  }, [selectedClientId]);

  // ───────── Mutations ─────────
  const syncMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/sync/accounts", {}),
    onSuccess: () => {
      queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/all"] });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/call-counts"] });
      toast({ title: "Sync complete", description: "Locations refreshed from Google." });
    },
    onError: (error: unknown) => {
      showApiError("Sync Failed", parseApiError(error, "Could not sync locations from Google."));
    },
  });

  const updateDetailsMutation = useMutation<unknown, unknown, { locationId: string; data: LocationDetailsPayload }>({
    mutationFn: async ({ locationId, data }) => {
      const r = await apiRequest("PATCH", `/api/locations/${locationId}/details`, data);
      if (!r.ok) {
        const e = (await r.json()) as { error?: string };
        throw new Error(e.error || "Failed to update location details");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/all"] });
      toast({ title: "Saved", description: "Location updated and pushed to Google." });
      setEditingLocation(null);
    },
    onError: (error: unknown) => {
      showApiError("Failed to update", parseApiError(error, "Something went wrong."));
    },
  });

  const handleEditClick = (loc: ClientLocation) => {
    setEditFormData({
      phone: loc.phone || "",
      website: loc.website || "",
      description: loc.description || "",
    });
    setEditingLocation(loc);
  };

  const handleSaveDetails = () => {
    if (!editingLocation) return;
    const updates: LocationDetailsPayload = {};
    if (editFormData.phone !== (editingLocation.phone || "")) updates.phone = editFormData.phone;
    if (editFormData.website !== (editingLocation.website || "")) updates.website = editFormData.website;
    if (editFormData.description !== (editingLocation.description || "")) updates.description = editFormData.description;
    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes" });
      setEditingLocation(null);
      return;
    }
    updateDetailsMutation.mutate({ locationId: editingLocation.id, data: updates });
  };

  // Auto-open edit dialog when ?edit=<locationId> is in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!editId || !allLocations?.length) return;
    const target = allLocations.find((l) => l.id === editId);
    if (target) {
      handleEditClick(target);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [allLocations]);

  // ───────── Derived ─────────
  const baseLocations: ClientLocation[] = folderFilter === "hidden" ? hiddenLocations : allLocations;
  const isShowingHidden = folderFilter === "hidden";
  const clientById = useMemo(() => {
    const m = new Map<string, Client>();
    clients.forEach((c) => m.set(c.id, c));
    return m;
  }, [clients]);

  const filteredLocations = useMemo(() => {
    return baseLocations.filter((loc) => {
      const matchesClient = clientFilter === "all" || loc.clientId === clientFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        loc.name.toLowerCase().includes(q) ||
        (loc.city || "").toLowerCase().includes(q) ||
        (loc.address || "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || pinStatusFor(loc, clientById.get(loc.clientId)) === statusFilter;
      const matchesFolder =
        folderFilter === "all" || folderFilter === "hidden" || folderLocations.some((fl) => fl.id === loc.id);
      const matchesTag = tagFilter === "all" || tagLocations.some((tl) => tl.id === loc.id);
      return matchesClient && matchesSearch && matchesStatus && matchesFolder && matchesTag;
    });
  }, [baseLocations, selectedClientId, searchQuery, statusFilter, folderFilter, folderLocations, tagFilter, tagLocations, clientById]);

  // Pin-able locations (have lat/lng)
  const pinnedLocations: PinPoint[] = useMemo(() => {
    const out: PinPoint[] = [];
    for (const l of filteredLocations) {
      const lat = l.latitude != null ? Number(l.latitude) : NaN;
      const lng = l.longitude != null ? Number(l.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({ id: l.id, lat, lng, loc: l, status: pinStatusFor(l, clientById.get(l.clientId)) });
    }
    return out;
  }, [filteredLocations, clientById]);

  const totalCount = filteredLocations.length;
  const shownCount = pinnedLocations.length;
  const showingAll = shownCount === totalCount;
  const overallTotal = allLocations.length;

  const needAttentionCount = useMemo(() => {
    return allLocations.filter((l) => {
      const s = pinStatusFor(l, clientById.get(l.clientId));
      return s === "needs_reauth" || s === "suspended" || s === "edit_pending";
    }).length;
  }, [allLocations, clientById]);

  // Currently-selected location for the details panel. Works for any
  // filtered location, including those without lat/lng (which won't show
  // a pin on the map but can still be inspected from the side list).
  const primaryLocation: ClientLocation | null = useMemo(() => {
    if (!primaryPinId) return null;
    return filteredLocations.find((l) => l.id === primaryPinId) || null;
  }, [primaryPinId, filteredLocations]);

  // Map-coords version of the primary (only when the location has lat/lng).
  const primary: PinPoint | null = useMemo(() => {
    if (!primaryLocation) return null;
    return pinnedLocations.find((p) => p.id === primaryLocation.id) || null;
  }, [primaryLocation, pinnedLocations]);

  useEffect(() => {
    if (primaryPinId && filteredLocations.length > 0 && !filteredLocations.find((l) => l.id === primaryPinId)) {
      setPrimaryPinId(null);
    }
  }, [filteredLocations.map((l) => l.id).join(",")]);

  // Right-side list shows ALL filtered locations (scrollable), not just
  // those that have map coords. When a primary with coords is selected,
  // sort the others by geographic distance; otherwise sort alphabetically.
  const nearby = useMemo(() => {
    type Row = { id: string; loc: ClientLocation; status: PinStatus; lat: number | null; lng: number | null; distance: number };
    const rows: Row[] = filteredLocations
      .filter((l) => l.id !== primaryLocation?.id)
      .map((l) => {
        const lat = l.latitude != null ? Number(l.latitude) : NaN;
        const lng = l.longitude != null ? Number(l.longitude) : NaN;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        const status = pinStatusFor(l, clientById.get(l.clientId));
        const distance =
          primary && hasCoords ? distanceKm(primary, { lat, lng } as PinPoint) : Number.POSITIVE_INFINITY;
        return { id: l.id, loc: l, status, lat: hasCoords ? lat : null, lng: hasCoords ? lng : null, distance };
      });

    if (primary) {
      // Distance ascending; locations without coords sink to the bottom.
      rows.sort((a, b) => a.distance - b.distance);
    } else {
      rows.sort((a, b) => a.loc.name.localeCompare(b.loc.name));
    }
    return rows;
  }, [primaryLocation, primary, filteredLocations, clientById]);

  // ───────── Selected location performance (Calls / Views / Rating) ─────────
  const [perfRange, setPerfRange] = useState<"7" | "30" | "90">("30");

  const { data: selectedPerf } = useQuery<{ callClicks: number; impressionsTotal: number; websiteClicks: number; directionRequests: number; daily: Array<{ date: string; callClicks: number; impressions: number; websiteClicks: number; directionRequests: number }> }>({
    queryKey: ["/api/locations", primary?.id, "performance", perfRange],
    queryFn: async () => {
      const r = await fetch(`/api/locations/${primary!.id}/performance?days=${perfRange}&_t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!primary,
  });

  // CSV export — uses the currently filtered set (includes locations without coords)
  const handleExportCsv = () => {
    const rows = filteredLocations.map((l) => ({
      loc: l,
      status: pinStatusFor(l, clientById.get(l.clientId)),
      client: clientById.get(l.clientId),
      calls: callCounts[l.id] ?? 0,
    }));
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `locations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Multi-select helpers
  const toggleSelected = (id: string) => {
    setSelectedPinIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedPinIds(new Set());
  const selectAllVisible = () => setSelectedPinIds(new Set(pinnedLocations.map((p) => p.id)));
  const selectionList = useMemo(() => Array.from(selectedPinIds), [selectedPinIds]);
  const fitToSelection = () => {
    if (selectionList.length === 1) setPrimaryPinId(selectionList[0]);
  };

  const openBulkAction = (modal: "hours" | "post" | "photo" | "folder" | "tag") => {
    const ids = selectedPinIds.size > 0
      ? Array.from(selectedPinIds)
      : (primary ? [primary.id] : []);
    if (ids.length === 0) {
      toast({ title: "Nothing selected", description: "Pick one or more pins first." });
      return;
    }
    setSelectedLocations(new Set(ids));
    if (modal === "hours") setShowHoursModal(true);
    else if (modal === "post") setShowPostModal(true);
    else if (modal === "photo") setShowPhotoModal(true);
    else if (modal === "folder") setShowAddToFolderModal(true);
    else if (modal === "tag") setShowAddToTagModal(true);
  };

  const handleRemoveFromFolder = async () => {
    if (!folderFilter || folderFilter === "all" || folderFilter === "hidden") return;
    const ids = Array.from(selectedPinIds);
    if (ids.length === 0) return;

    let successCount = 0;
    let errorCount = 0;

    for (const locationId of ids) {
      try {
        await apiRequest("DELETE", `/api/folders/${folderFilter}/locations/${locationId}`, {});
        successCount++;
      } catch {
        errorCount++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/folders", folderFilter, "locations"] });
    clearSelection();

    if (errorCount === 0) {
      toast({ title: "Removed", description: `Removed ${successCount} location${successCount !== 1 ? "s" : ""} from folder.` });
    } else {
      toast({ title: "Partial success", description: `Removed ${successCount}, ${errorCount} failed.`, variant: "default" });
    }
  };

  const handleDeselectByTag = async (tagId: string, tagName: string) => {
    try {
      const response = await fetch(`/api/tags/${tagId}/locations`);
      if (!response.ok) throw new Error();
      const tagLocs: { id: string }[] = await response.json();
      const tagLocationIds = new Set(tagLocs.map(l => l.id));
      const newSelected = new Set(Array.from(selectedLocations).filter(id => !tagLocationIds.has(id)));
      const deselectedCount = selectedLocations.size - newSelected.size;
      setSelectedLocations(newSelected);
      if (deselectedCount > 0) {
        toast({ title: "Locations excluded", description: `Removed ${deselectedCount} location${deselectedCount > 1 ? "s" : ""} with "${tagName}" tag` });
      } else {
        toast({ title: "No change", description: `No selected locations have the "${tagName}" tag` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to exclude locations by tag", variant: "destructive" });
    }
  };

  if (detailLocation) {
    return (
      <div className="h-screen bg-background flex overflow-hidden">
        <SideNav />
        <main className="flex-1 ml-56 flex flex-col overflow-hidden">
          <LocationDetailView
            location={detailLocation}
            onBack={() => setDetailLocation(null)}
            onEditClick={(loc) => { setDetailLocation(null); handleEditClick(loc); }}
            onCreatePost={(loc) => { setDetailLocation(null); setSelectedLocations(new Set([loc.id])); setShowPostModal(true); }}
            onUpdateHours={(loc) => { setDetailLocation(null); setSelectedLocations(new Set([loc.id])); setShowHoursModal(true); }}
          />
        </main>
      </div>
    );
  }

  const accountStateBanner = (() => {
    const needReauth = clients.some((c) => c.accountState === "needs_reauth");
    const suspended = clients.some((c) => c.accountState === "suspended");
    if (needReauth) {
      return { tone: "amber" as const, text: "Your Google connection has expired. Reconnect to refresh location data." };
    }
    if (suspended) {
      return { tone: "red" as const, text: "One or more accounts have been suspended by Google." };
    }
    return null;
  })();

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <SideNav />

      <main className="flex-1 ml-56 flex flex-col overflow-hidden">
        {/* Header — matches /posts typography (uppercase kicker + large title) */}
        <header className="bg-transparent border-b border-gray-200 px-8 pt-5 pb-2">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-[10px] font-semibold tracking-[0.18em] text-gray-500" data-testid="text-kicker-manage">MANAGE</span>
              <h2 className="text-xl font-semibold text-gray-900 tracking-tight leading-none" data-testid="text-page-title">Locations</h2>
              <div className="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap" data-testid="text-page-subtitle">
                <span><span className="font-semibold text-gray-900">{overallTotal}</span> total</span>
                <span className="text-gray-300">·</span>
                <span className={needAttentionCount > 0 ? "text-amber-700 font-medium" : ""}>
                  <span className="font-semibold">{needAttentionCount}</span> need attention
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="client-select" className="text-sm font-medium text-gray-600">Client:</label>
                <Select
                  value={clientFilter}
                  onValueChange={(v) => {
                    setClientFilter(v);
                    // Keep the global "active client" in sync when picking a
                    // specific client, so other pages (Posts/Hours/etc.) and
                    // bulk-action modals on this page have a meaningful
                    // client context. Picking "All clients" leaves the
                    // global selection alone.
                    if (v !== "all") setSelectedClientId(v);
                  }}
                >
                  <SelectTrigger className="w-48" data-testid="select-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="client-option-all">
                      All clients ({allLocations.length.toLocaleString()})
                    </SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id} data-testid={`client-option-${client.id}`}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-add-location"
              >
                {syncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
                + Add location
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-sync-locations"
              >
                {syncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {syncMutation.isPending ? "Syncing..." : "Sync from Google"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowFolderManagementModal(true)} data-testid="button-manage-folders">
                <FolderPlus className="w-4 h-4 mr-2" /> Folders
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowTagManagementModal(true)} data-testid="button-manage-tags">
                Tags
              </Button>
            </div>
          </div>
        </header>

        {/* Filters — single compact row */}
        <div className="px-8 py-2 border-b border-border/40 space-y-2">
          {accountStateBanner && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${
                accountStateBanner.tone === "amber"
                  ? "bg-amber-50 border border-amber-200 text-amber-900"
                  : "bg-red-50 border border-red-200 text-red-900"
              }`}
              data-testid="banner-account-state"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{accountStateBanner.text}</span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <Input
                placeholder="Search name, city, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs"
                data-testid="input-search-locations"
              />
            </div>

            <Select value={folderFilter} onValueChange={setFolderFilter}>
              <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-folder-filter">
                <SelectValue placeholder="Folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                <SelectItem value="hidden" data-testid="folder-option-hidden">
                  <span className="flex items-center gap-2"><EyeOff className="w-4 h-4" /> Hidden ({hiddenLocations.length})</span>
                </SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id} data-testid={`folder-option-${f.id}`}>
                    <span className="flex items-center gap-2"><Folder className="w-4 h-4" /> {f.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {tags.length > 0 && (
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-tag-filter">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id} data-testid={`tag-option-${t.id}`}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {tags.length > 0 && selectedLocations.size > 0 && (
              <Select
                value="none"
                onValueChange={(tagId) => {
                  const tag = tags.find(t => t.id === tagId);
                  if (tag) handleDeselectByTag(tag.id, tag.name);
                }}
              >
                <SelectTrigger className="w-36 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50" data-testid="select-exclude-tag">
                  <SelectValue placeholder="− Exclude Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>Pick a tag to exclude</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "verified", "edit_pending", "needs_reauth", "suspended", "temp_closed"] as const).map((s) => {
                const active = statusFilter === s;
                const color = s === "all" ? "#374151" : PIN_COLORS[s as PinStatus];
                const label = s === "all" ? "All" : PIN_LABELS[s as PinStatus];
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    data-testid={`badge-filter-${s}`}
                    className={`text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1 transition-colors ${
                      active ? "bg-gray-900 text-white border-gray-900" : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700"
                    }`}
                  >
                    {s !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1 text-xs" data-testid="button-columns">
                    <SlidersHorizontal className="w-3.5 h-3.5" /> Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-3" data-testid="popover-columns">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Selected card</div>
                  {(Object.keys(DEFAULT_COLUMNS) as Array<keyof CardColumns>).map((k) => (
                    <label key={k} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={columns[k]}
                        onCheckedChange={(v) => setColumns((c) => ({ ...c, [k]: !!v }))}
                        data-testid={`checkbox-column-${k}`}
                      />
                      <span className="capitalize">{k}</span>
                    </label>
                  ))}
                </PopoverContent>
              </Popover>

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 gap-1 text-xs"
                onClick={handleExportCsv}
                disabled={filteredLocations.length === 0}
                data-testid="button-export-csv"
              >
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
            </div>
          </div>
        </div>

        {/* Body: Map + Side panel */}
        <div className="flex-1 flex overflow-hidden gap-3 p-3 bg-gray-50">
          {/* Map (~70%) */}
          <div className="relative flex-1 min-w-0 bg-gray-100 rounded-lg overflow-hidden border border-border/60 shadow-sm isolate">
            {pinnedLocations.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Card className="max-w-md mx-auto">
                  <CardContent className="py-10 text-center">
                    <MapPin className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    {(() => {
                      const filterIsActive =
                        folderFilter !== "all" ||
                        tagFilter !== "all" ||
                        statusFilter !== "all" ||
                        searchQuery.trim().length > 0;
                      const folderName =
                        folderFilter !== "all" && folderFilter !== "hidden"
                          ? folders.find((f) => f.id === folderFilter)?.name
                          : null;

                      if (folderName && totalCount === 0) {
                        return (
                          <>
                            <h3 className="font-semibold text-gray-900 mb-1" data-testid="text-empty-title">
                              "{folderName}" is empty
                            </h3>
                            <p className="text-sm text-gray-600 mb-4">
                              No locations have been added to this folder yet.
                            </p>
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setFolderFilter("all")}
                                data-testid="button-clear-folder-filter"
                              >
                                Show all locations
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => setShowFolderManagementModal(true)}
                                data-testid="button-manage-folders-empty"
                              >
                                Manage folders
                              </Button>
                            </div>
                          </>
                        );
                      }

                      if (filterIsActive && totalCount === 0) {
                        return (
                          <>
                            <h3 className="font-semibold text-gray-900 mb-1" data-testid="text-empty-title">
                              No matches for the current filters
                            </h3>
                            <p className="text-sm text-gray-600 mb-4">
                              Try clearing the filters to see all locations.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFolderFilter("all");
                                setTagFilter("all");
                                setStatusFilter("all");
                                setSearchQuery("");
                              }}
                              data-testid="button-clear-filters"
                            >
                              Clear filters
                            </Button>
                          </>
                        );
                      }

                      return (
                        <>
                          <h3 className="font-semibold text-gray-900 mb-1" data-testid="text-empty-title">
                            No locations on the map yet
                          </h3>
                          <p className="text-sm text-gray-600">
                            {totalCount === 0
                              ? "Sync from Google to load your business locations."
                              : "We don't have lat/lng for the filtered locations yet. Try Sync from Google to refresh coordinates."}
                          </p>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <MapContainer
                center={[39.5, -98.35]}
                zoom={4}
                scrollWheelZoom
                className="h-full w-full"
                data-testid="leaflet-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {pinnedLocations.map((p) => {
                  const isFocus = primaryPinId === p.id;
                  const isInSelection = selectedPinIds.has(p.id);
                  return (
                    <Marker
                      key={p.id}
                      position={[p.lat, p.lng]}
                      icon={makePinIcon(PIN_COLORS[p.status], isFocus || isInSelection)}
                      eventHandlers={{ click: () => setPrimaryPinId(p.id) }}
                    />
                  );
                })}
                <FitBounds
                  points={pinnedLocations}
                  primaryId={primaryPinId}
                  selectionIds={selectionList}
                />
              </MapContainer>
            )}

            {pinnedLocations.length > 0 && (
              <div
                className="absolute top-4 right-4 z-[400] inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/95 backdrop-blur shadow-md border border-gray-200 text-gray-700"
                data-testid="pill-shown-count"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>
                  <span className="font-semibold">{shownCount}</span> of <span className="font-semibold">{totalCount}</span> shown
                </span>
                {!showingAll && shownCount > 0 && (
                  <button
                    className="text-cyan-700 hover:underline font-medium"
                    onClick={() => {
                      setStatusFilter("all");
                      setSearchQuery("");
                      setFolderFilter("all");
                      setTagFilter("all");
                    }}
                    data-testid="button-show-all"
                  >
                    · Show all
                  </button>
                )}
              </div>
            )}

            {/* Status legend */}
            {pinnedLocations.length > 0 && (
              <div
                className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur shadow-md border border-gray-200 rounded-lg px-3 py-2 text-xs"
                data-testid="map-legend"
              >
                <div className="font-semibold text-gray-700 mb-1.5">Status</div>
                <div className="space-y-1">
                  {(Object.keys(PIN_COLORS) as PinStatus[]).map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PIN_COLORS[s] }} />
                      <span className="text-gray-700">{PIN_LABELS[s]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Floating selected-location card — overlaid on the map */}
            {primaryLocation && (
              <div className="absolute top-14 right-4 z-[500] w-[320px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden" data-testid="map-popup-card">
                <SelectedCard
                  location={primaryLocation}
                  client={clientById.get(primaryLocation.clientId)}
                  status={pinStatusFor(primaryLocation, clientById.get(primaryLocation.clientId))}
                  callCount={selectedPerf?.callClicks ?? null}
                  viewCount={selectedPerf?.impressionsTotal ?? null}
                  dailyPerf={selectedPerf?.daily ?? null}
                  perfRange={perfRange}
                  onPerfRangeChange={setPerfRange}
                  columns={columns}
                  onOpenDetail={() => setDetailLocation(primaryLocation)}
                  onEdit={() => handleEditClick(primaryLocation)}
                  onHide={async () => {
                    await apiRequest("POST", `/api/locations/${primaryLocation.id}/hide`, {});
                    queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/all"] });
                    toast({ title: "Hidden", description: "Location hidden from map" });
                  }}
                  isShowingHidden={isShowingHidden}
                  onUnhide={async () => {
                    await apiRequest("POST", `/api/locations/${primaryLocation.id}/unhide`, {});
                    queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/all"] });
                    queryClientInstance.invalidateQueries({ queryKey: ["/api/locations/hidden"] });
                    toast({ title: "Restored" });
                  }}
                  onClose={() => setPrimaryPinId(null)}
                />
              </div>
            )}
          </div>

          {/* Right pane (~30%) */}
          <aside className="w-[360px] xl:w-[440px] 2xl:w-[560px] border border-border/60 flex flex-col bg-white overflow-hidden rounded-lg shadow-sm" data-testid="side-pane">
            {selectedPinIds.size > 0 && (
              <div className="border-b border-border/60 bg-cyan-50/60 px-4 py-2 flex items-center justify-between gap-2 flex-wrap" data-testid="nearby-selection-toolbar">
                <span className="text-xs font-medium text-gray-800" data-testid="text-selection-count">{selectedPinIds.size} selected</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openBulkAction("hours")} data-testid="button-bulk-hours">
                    <Clock className="w-3 h-3" /> Hours
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openBulkAction("post")} data-testid="button-bulk-post">
                    <MessageSquarePlus className="w-3 h-3" /> Post
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openBulkAction("photo")} data-testid="button-bulk-photo">
                    <ImagePlus className="w-3 h-3" /> Photo
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openBulkAction("folder")} data-testid="button-bulk-folder">
                    <Folder className="w-3 h-3" /> Folder
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs" onClick={() => openBulkAction("tag")} data-testid="button-bulk-tag">
                    <TagIcon className="w-3 h-3" /> Tag
                  </Button>
                  {folderFilter !== "all" && folderFilter !== "hidden" && (
                    <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={handleRemoveFromFolder} data-testid="button-bulk-remove-folder">
                      <FolderMinus className="w-3 h-3" /> Remove from folder
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" onClick={fitToSelection} data-testid="button-fit-selection">
                    <Maximize2 className="w-3 h-3" /> Fit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-gray-600" onClick={clearSelection} data-testid="button-clear-selection">
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* NEARBY header */}
            <div className="border-b border-border/60 px-4 py-3 flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide" data-testid="text-nearby-header">
                {primary ? "Nearby" : "All locations"}{" "}
                <span className="ml-1 text-gray-400 normal-case tracking-normal">
                  · {nearby.length.toLocaleString()} {primary ? "shown" : "in list"}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-gray-600"
                onClick={selectedPinIds.size === pinnedLocations.length && pinnedLocations.length > 0 ? clearSelection : selectAllVisible}
                disabled={pinnedLocations.length === 0}
                data-testid="button-select-all-visible"
              >
                <CheckSquare className="w-3.5 h-3.5 mr-1" />
                {selectedPinIds.size === pinnedLocations.length && pinnedLocations.length > 0 ? "Clear all" : "Select all"}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto" data-testid="nearby-list">
              {nearby.length === 0 ? (
                <div className="p-4 text-xs text-gray-500">No other locations to show.</div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {nearby.map((p) => {
                    const calls = callCounts[p.id] ?? 0;
                    const checked = selectedPinIds.has(p.id);
                    return (
                      <li
                        key={p.id}
                        className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50"
                        data-testid={`nearby-item-${p.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSelected(p.id)}
                          data-testid={`checkbox-nearby-${p.id}`}
                        />
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIN_COLORS[p.status] }} />
                        <button
                          className="flex-1 min-w-0 text-left"
                          onClick={() => setPrimaryPinId(p.id)}
                          data-testid={`button-nearby-focus-${p.id}`}
                        >
                          <div className="text-sm font-medium text-gray-900 truncate" data-testid={`text-nearby-name-${p.id}`}>{p.loc.name}</div>
                          <div className="text-xs text-gray-500 truncate">{p.loc.city || "—"}</div>
                        </button>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium tabular-nums"
                          title={`${calls.toLocaleString()} calls in the last 30 days`}
                          data-testid={`badge-nearby-calls-${p.id}`}
                        >
                          {calls > 999 ? `${(calls / 1000).toFixed(1)}k` : calls.toLocaleString()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Modals */}
      <HoursEditorModal open={showHoursModal} onClose={() => setShowHoursModal(false)} clientId={selectedClientId} selectedLocationIds={Array.from(selectedLocations)} />
      <PostCreationModal open={showPostModal} onClose={() => setShowPostModal(false)} clientId={selectedClientId} selectedLocationIds={Array.from(selectedLocations)} />
      <PhotoUploadModal open={showPhotoModal} onClose={() => setShowPhotoModal(false)} clientId={selectedClientId} selectedLocationIds={Array.from(selectedLocations)} />
      <FolderManagementModal open={showFolderManagementModal} onClose={() => setShowFolderManagementModal(false)} />
      <AddToFolderModal open={showAddToFolderModal} onClose={() => { setShowAddToFolderModal(false); setSelectedLocations(new Set()); }} selectedLocationIds={Array.from(selectedLocations)} />
      <TagManagementModal open={showTagManagementModal} onClose={() => setShowTagManagementModal(false)} />
      <AddToTagModal open={showAddToTagModal} onClose={() => { setShowAddToTagModal(false); setSelectedLocations(new Set()); }} selectedLocationIds={Array.from(selectedLocations)} />

      {/* Edit Location dialog */}
      <Dialog open={!!editingLocation} onOpenChange={(open) => !open && setEditingLocation(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Location Details</DialogTitle>
            <DialogDescription>Update location information. Changes will be pushed to Google Business Profile.</DialogDescription>
          </DialogHeader>
          {editingLocation && (
            <div className="space-y-4 py-4">
              <div className="mb-2 p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">{editingLocation.name}</p>
                <p className="text-xs text-muted-foreground">{editingLocation.address}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" value={editFormData.phone ?? ""} onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })} placeholder="(555) 123-4567" data-testid="input-edit-phone" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={editFormData.website ?? ""} onChange={(e) => setEditFormData({ ...editFormData, website: e.target.value })} placeholder="https://example.com" data-testid="input-edit-website" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={editFormData.description ?? ""} onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })} placeholder="Enter location description..." rows={4} data-testid="input-edit-description" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLocation(null)} disabled={updateDetailsMutation.isPending} data-testid="button-cancel-edit">Cancel</Button>
            <Button onClick={handleSaveDetails} disabled={updateDetailsMutation.isPending} data-testid="button-save-edit">
              {updateDetailsMutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Tiny SVG sparkline — no external deps
function MiniSparkline({ data, color = "#6b7280", width = 80, height = 28 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Selected card (right-pane top) — name, address, status, mini metrics
// ─────────────────────────────────────────────────────────────────────
type PerfDay = { date: string; callClicks: number; impressions: number; websiteClicks: number; directionRequests: number };

function SelectedCard({
  location,
  client,
  status,
  callCount,
  viewCount,
  dailyPerf,
  perfRange,
  onPerfRangeChange,
  columns,
  onOpenDetail,
  onEdit,
  onHide,
  onUnhide,
  onClose,
  isShowingHidden,
}: {
  location: ClientLocation;
  client?: Client;
  status: PinStatus;
  callCount: number | null;
  viewCount: number | null;
  dailyPerf: PerfDay[] | null;
  perfRange: "7" | "30" | "90";
  onPerfRangeChange: (r: "7" | "30" | "90") => void;
  columns: CardColumns;
  onOpenDetail: () => void;
  onEdit: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onClose: () => void;
  isShowingHidden: boolean;
}) {
  const rating = location.averageRating != null ? Number(location.averageRating) : null;
  const visibleStats: Array<{ label: string; value: string; icon?: React.ReactNode; testid: string; spark?: number[] }> = [];

  const callsSpark = dailyPerf ? dailyPerf.map((d) => d.callClicks) : null;
  const viewsSpark = dailyPerf ? dailyPerf.map((d) => d.impressions) : null;
  const hasCallsData = callsSpark ? callsSpark.some((v) => v > 0) : false;
  const hasViewsData = viewsSpark ? viewsSpark.some((v) => v > 0) : false;

  if (columns.calls) visibleStats.push({
    label: "Calls",
    value: callCount != null ? callCount.toLocaleString() : "—",
    testid: "stat-calls",
    spark: hasCallsData ? callsSpark! : undefined,
  });
  if (columns.views) visibleStats.push({
    label: "Views",
    value: viewCount != null ? viewCount.toLocaleString() : "—",
    testid: "stat-views",
    spark: hasViewsData ? viewsSpark! : undefined,
  });
  if (columns.rating) visibleStats.push({
    label: "Rating",
    value: rating != null ? rating.toFixed(1) : "—",
    icon: rating != null ? <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" /> : undefined,
    testid: "stat-rating",
  });

  const RANGES: Array<"7" | "30" | "90"> = ["7", "30", "90"];

  return (
    <div className="p-4 border-b border-border/60 relative" data-testid="selected-card">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        aria-label="Clear selection"
        data-testid="button-clear-selected"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Selected</div>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5" data-testid="perf-range-toggle">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onPerfRangeChange(r)}
              data-testid={`button-perf-range-${r}d`}
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                perfRange === r ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ background: PIN_COLORS[status] }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 leading-tight" data-testid="text-selected-name">{location.name}</div>
          <div className="text-xs text-gray-600 mt-0.5 truncate">{location.address || "—"}</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide" style={{ background: `${PIN_COLORS[status]}1a`, color: PIN_COLORS[status] }}>
              {PIN_LABELS[status]}
            </Badge>
            {client && <span className="text-[11px] text-gray-500">· {client.name}</span>}
          </div>
        </div>
      </div>

      {visibleStats.length > 0 && (
        <div
          className={`mt-4 grid gap-2 ${
            visibleStats.length >= 3 ? "grid-cols-3" : visibleStats.length === 2 ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {visibleStats.map((s) => (
            <StatWithSpark key={s.label} label={s.label} value={s.value} icon={s.icon} testid={s.testid} spark={s.spark} />
          ))}
        </div>
      )}

      {dailyPerf !== null && !hasCallsData && !hasViewsData && (
        <p className="mt-2 text-[11px] text-gray-400 text-center" data-testid="perf-empty-state">No performance data for this period.</p>
      )}

      {columns.phone && location.phone && (
        <a href={`tel:${location.phone}`} className="mt-3 flex items-center gap-2 text-xs text-gray-700 hover:text-gray-900" data-testid="link-selected-phone">
          <Phone className="w-3.5 h-3.5" /> {location.phone}
        </a>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="flex-1" onClick={onOpenDetail} data-testid="button-open-detail">
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open detail
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit} data-testid="button-edit-location">
          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
        </Button>
        {isShowingHidden ? (
          <Button size="sm" variant="ghost" onClick={onUnhide} data-testid="button-unhide-selected"><Eye className="w-3.5 h-3.5" /></Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onHide} data-testid="button-hide-selected"><EyeOff className="w-3.5 h-3.5" /></Button>
        )}
      </div>
    </div>
  );
}

function StatWithSpark({ label, value, icon, testid, spark }: { label: string; value: string; icon?: React.ReactNode; testid?: string; spark?: number[] }) {
  return (
    <div className="rounded-md bg-gray-50 border border-gray-100 p-2" data-testid={testid}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900 flex items-center gap-1">{icon}{value}</div>
      {spark && spark.length >= 2 && (
        <div className="mt-1.5" data-testid={`sparkline-${label.toLowerCase()}`}>
          <MiniSparkline data={spark} color="#1f3a5f" width={60} height={20} />
        </div>
      )}
    </div>
  );
}
