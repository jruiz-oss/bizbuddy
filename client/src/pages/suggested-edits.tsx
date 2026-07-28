import { SideNav } from "@/components/SideNav";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Check, X, MapPin, ArrowRight, Lightbulb, BarChart3, MessageSquare, Clock, History, Settings, Search, FolderOpen, ChevronDown, Star, Share2 } from "lucide-react";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { useScanProgress } from "@/contexts/scan-progress-context";
import { ScanStatusBanner } from "@/components/scan-status-banner";
import { parseApiError } from "@/lib/parseApiError";
import { isGoogleAuthError } from "@/lib/authError";
import { queryClient, apiRequest, getApiUrl } from "@/lib/queryClient";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Client, ClientLocation, LocationFolder } from "@shared/schema";

interface SuggestedEditsProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

interface ScanResult {
  locationId: string;
  locationName: string;
  // Nullable: client_locations.address is nullable.
  locationAddress: string | null;
  gbpLocationName: string;
  hasUpdates: boolean;
  originalLocation: any;
  suggestedLocation: any;
  diffMask: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Business Name',
  storefrontAddress: 'Address',
  phoneNumbers: 'Phone Number',
  websiteUri: 'Website',
  regularHours: 'Business Hours',
  specialHours: 'Special Hours',
  moreHours: 'More Hours',
  openInfo: 'Business Status',
  profile: 'Business Profile',
  categories: 'Business Categories',
  metadata: 'Other Updates',
};

function getFieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] || fieldName.replace(/([A-Z])/g, ' $1').trim();
}

export default function SuggestedEdits({ selectedClientId, setSelectedClientId }: SuggestedEditsProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const [location] = useLocation();

  // Scan state lives in ScanProgressProvider, which reads it from the server.
  // Keeping it out of this component is what lets a run survive navigation and
  // page reloads — this page is just one view onto it.
  const {
    scan,
    results: scanResults,
    setResults: setScanResults,
    isScanning,
    isLoadingScan,
    startScan: startScanRun,
    cancelScan,
    startError,
  } = useScanProgress();

  const [selectedEdit, setSelectedEdit] = useState<ScanResult | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"accept" | "reject" | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Time of the last run that actually completed, from the run record itself.
  const lastScannedTime = scan?.completedAt ? new Date(scan.completedAt) : null;
  const [viewingField, setViewingField] = useState<{ locationId: string; fieldName: string; originalValue: any; suggestedValue: any } | null>(null);
  const [viewingHistory, setViewingHistory] = useState<ActionHistory | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [showScanOptions, setShowScanOptions] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  // Fetch all folders for scan filtering
  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
  });

  // Fetch all locations for scan filtering
  const { data: allLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/all-locations"],
  });

  // Fetch action history
  interface ActionHistory {
    id: string;
    gbpLocationName: string;
    locationName: string;
    locationAddress: string | null;
    actionType: string;
    diffMask: string | null;
    changes: any;
    actedByName: string | null;
    localUserId: string | null;
    performedAt: string;
    createdAt: string;
  }

  const { data: history = [] } = useQuery<ActionHistory[]>({
    queryKey: ["/api/suggested-edits/history", { limit: 200 }],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/suggested-edits/history?limit=200"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch history");
      return response.json();
    },
  });

  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);

  // Kick off a scan. This only creates the run — the scan itself continues on
  // the server whether or not this page (or the browser) stays open.
  const startScan = async (folderIds: string[] = [], locationIds: string[] = []) => {
    setShowScanOptions(false);
    try {
      await startScanRun(folderIds, locationIds);
    } catch (error: any) {
      const detail = parseApiError(error, "Failed to start the scan. Please try again.");
      showApiError("Scan Failed", detail, { isAuthError: isGoogleAuthError(detail) });
    }
  };

  // Surface a failed run the same way the old inline scan did. Keyed on scan id
  // so re-renders never re-fire it for a run already reported.
  const reportedScanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scan || scan.status === "running") return;
    if (reportedScanRef.current === scan.scanId) return;

    // A run that was already finished when we first saw it (page load, refresh,
    // someone else's scan from yesterday) is history, not news — the banner
    // states its outcome. Only interrupt for a run that finished while watching.
    const justFinished =
      !!scan.completedAt && Date.now() - new Date(scan.completedAt).getTime() < 60_000;
    reportedScanRef.current = scan.scanId;
    if (!justFinished) return;

    if (scan.status === "failed") {
      const detail = scan.firstError || "Failed to scan for suggested edits. Please try again.";
      showApiError("Scan Failed", detail, { isAuthError: isGoogleAuthError(detail) });
    } else if (scan.status === "partial") {
      toast({
        title: "Scan Complete (with errors)",
        description: `Found ${scan.withUpdatesCount} update(s). ${scan.erroredCount} location(s) failed.${scan.firstError ? ` Google API error: ${scan.firstError}` : ""}`,
        variant: "destructive",
      });
    }
    // Clean success and cancelled/interrupted are shown inline in the banner —
    // no toast, matching the previous behavior of staying quiet on success.
  }, [scan?.scanId, scan?.status]);

  // Default to the first category that actually has results.
  useEffect(() => {
    if (scanResults.length === 0) return;
    const grouped = groupResultsByCategory(scanResults);
    if (selectedCategoryId && (grouped[selectedCategoryId] || []).length > 0) return;
    const firstCat = editCategories.find(c => (grouped[c.id] || []).length > 0);
    if (firstCat) setSelectedCategoryId(firstCat.id);
  }, [scanResults]);

  // Accept mutation
  const acceptMutation = useMutation({
    mutationFn: async ({ edit, field }: { edit: ScanResult; field: string }) => {
      const response = await apiRequest("POST", `/api/suggested-edits/inline/accept`, {
        gbpLocationName: edit.gbpLocationName,
        originalLocation: edit.originalLocation,
        suggestedLocation: edit.suggestedLocation,
        diffMask: field, // Only the specific field
        locationName: edit.locationName,
        locationAddress: edit.locationAddress,
        clientId: selectedClientId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Update Accepted",
        description: "The Google-suggested update has been applied to your business profile.",
      });
      // Remove only the specific field from the scan results
      if (selectedEdit && selectedField) {
        setScanResults(prev => 
          prev.map(r => {
            if (r.locationId === selectedEdit.locationId) {
              // Filter out the accepted field from diffMask
              const remainingFields = r.diffMask
                .split(',')
                .map(f => f.trim())
                .filter(f => f !== selectedField && f !== 'metadata')
                .join(',');
              
              // If no fields left, remove the location
              if (!remainingFields || remainingFields.trim() === '') {
                return null as any;
              }
              return { ...r, diffMask: remainingFields };
            }
            return r;
          }).filter(r => r !== null)
        );
      }
      setShowConfirmDialog(false);
      setSelectedEdit(null);
      setActionType(null);
      setSelectedField(null);
      queryClient.invalidateQueries({ queryKey: ["/api/suggested-edits/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
    },
    onError: (error: any) => {
      showApiError("Failed to Accept Update", parseApiError(error, "Failed to accept the suggested update."), { isAuthError: isGoogleAuthError(error) });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ edit, field }: { edit: ScanResult; field: string }) => {
      const response = await apiRequest("POST", `/api/suggested-edits/inline/reject`, {
        gbpLocationName: edit.gbpLocationName,
        originalLocation: edit.originalLocation,
        suggestedLocation: edit.suggestedLocation,
        diffMask: field, // Only the specific field
        locationName: edit.locationName,
        locationAddress: edit.locationAddress,
        clientId: selectedClientId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Update Rejected",
        description: "The Google-suggested update has been rejected.",
      });
      // Remove only the specific field from the scan results
      if (selectedEdit && selectedField) {
        setScanResults(prev => 
          prev.map(r => {
            if (r.locationId === selectedEdit.locationId) {
              // Filter out the rejected field from diffMask
              const remainingFields = r.diffMask
                .split(',')
                .map(f => f.trim())
                .filter(f => f !== selectedField && f !== 'metadata')
                .join(',');
              
              // If no fields left, remove the location
              if (!remainingFields || remainingFields.trim() === '') {
                return null as any;
              }
              return { ...r, diffMask: remainingFields };
            }
            return r;
          }).filter(r => r !== null)
        );
      }
      setShowConfirmDialog(false);
      setSelectedEdit(null);
      setActionType(null);
      setSelectedField(null);
      queryClient.invalidateQueries({ queryKey: ["/api/suggested-edits/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
    },
    onError: (error: any) => {
      showApiError("Failed to Reject Update", parseApiError(error, "Failed to reject the suggested update."), { isAuthError: isGoogleAuthError(error) });
    },
  });

  // Track which specific history item is being undone
  const [undoingId, setUndoingId] = useState<string | null>(null);

  // Undo mutation
  const undoMutation = useMutation({
    mutationFn: async (historyId: string) => {
      setUndoingId(historyId);
      const response = await apiRequest("POST", `/api/suggested-edits/history/${historyId}/undo`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Change Undone",
        description: "Your business profile has been updated accordingly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/suggested-edits/history", { limit: 200 }] });
      setUndoingId(null);
    },
    onError: (error: any) => {
      showApiError("Failed to Undo Change", parseApiError(error, "Failed to undo the change."), { isAuthError: isGoogleAuthError(error) });
      setUndoingId(null);
    },
  });

  const handleUndo = (e: React.MouseEvent, historyId: string) => {
    e.stopPropagation();
    undoMutation.mutate(historyId);
  };

  const handleScan = () => {
    startScan(selectedFolderIds, selectedLocationIds);
  };

  const handleScanAll = () => {
    setSelectedFolderIds([]);
    setSelectedLocationIds([]);
    startScan([], []);
  };

  const toggleFolderSelection = (folderId: string) => {
    setSelectedFolderIds(prev =>
      prev.includes(folderId)
        ? prev.filter(id => id !== folderId)
        : [...prev, folderId]
    );
  };

  const toggleLocationSelection = (locationId: string) => {
    setSelectedLocationIds(prev =>
      prev.includes(locationId)
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const clearSelection = () => {
    setSelectedFolderIds([]);
    setSelectedLocationIds([]);
  };

  const selectionCount = selectedFolderIds.length + selectedLocationIds.length;

  // Helper function to check if an edit is pending (not yet acted on)
  const isEditPending = (gbpLocationName: string) => {
    // Check if there are any history entries for this location
    const hasHistory = history.some(h => h.gbpLocationName === gbpLocationName);
    return !hasHistory;
  };

  const handleAction = (edit: ScanResult, field: string, action: "accept" | "reject") => {
    setSelectedEdit(edit);
    setSelectedField(field);
    setActionType(action);
    setShowConfirmDialog(true);
  };

  const confirmAction = () => {
    if (!selectedEdit || !selectedField || !actionType) return;
    
    if (actionType === "accept") {
      acceptMutation.mutate({ edit: selectedEdit, field: selectedField });
    } else {
      rejectMutation.mutate({ edit: selectedEdit, field: selectedField });
    }
  };

  // Accept all edits in a category
  const [isAcceptingAll, setIsAcceptingAll] = useState(false);
  
  const acceptAllInCategory = async (categoryId: string, categoryItems: { result: ScanResult; fields: string[] }[]) => {
    setIsAcceptingAll(true);
    const successfulAccepts: { locationId: string; field: string }[] = [];
    let failedCount = 0;
    
    for (const { result, fields } of categoryItems) {
      for (const field of fields) {
        try {
          await apiRequest("POST", `/api/suggested-edits/inline/accept`, {
            gbpLocationName: result.gbpLocationName,
            originalLocation: result.originalLocation,
            suggestedLocation: result.suggestedLocation,
            diffMask: field,
            locationName: result.locationName,
            locationAddress: result.locationAddress,
            clientId: selectedClientId,
          });
          successfulAccepts.push({ locationId: result.locationId, field });
        } catch {
          failedCount++;
        }
      }
    }
    
    // Update UI for successful accepts
    if (successfulAccepts.length > 0) {
      setScanResults(prev => 
        prev.map(r => {
          const acceptedFields = successfulAccepts
            .filter(s => s.locationId === r.locationId)
            .map(s => s.field);
          
          if (acceptedFields.length === 0) return r;
          
          const remainingFields = r.diffMask
            .split(',')
            .map(f => f.trim())
            .filter(f => !acceptedFields.includes(f) && f !== 'metadata')
            .join(',');
          
          if (!remainingFields || remainingFields.trim() === '') {
            return null as any;
          }
          return { ...r, diffMask: remainingFields };
        }).filter(r => r !== null)
      );
      
      queryClient.invalidateQueries({ queryKey: ["/api/suggested-edits/history"] });
    }
    
    // Show result toast
    if (failedCount === 0) {
      toast({
        title: "All Updates Accepted",
        description: `All ${successfulAccepts.length} updates in this category have been accepted.`,
      });
    } else if (successfulAccepts.length > 0) {
      toast({
        title: "Partial Success",
        description: `${successfulAccepts.length} accepted, ${failedCount} failed.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Failed to Accept",
        description: "Could not accept any updates in this category.",
        variant: "destructive",
      });
    }
    
    setIsAcceptingAll(false);
  };

  // Helper function to get nested value by path (e.g., "profile.description")
  const getNestedValue = (obj: any, path: string): any => {
    if (!obj) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  };

  // Helper function to format field changes
  const formatFieldChanges = (edit: ScanResult) => {
    if (!edit.suggestedLocation || !edit.diffMask) return [];
    
    const changes: { field: string; original: any; suggested: any }[] = [];
    const fields = edit.diffMask.split(",").map(f => f.trim());
    
    for (const field of fields) {
      const value = getNestedValue(edit.suggestedLocation, field);
      if (value !== undefined) {
        changes.push({
          field,
          original: "Current value",
          suggested: JSON.stringify(value, null, 2),
        });
      }
    }
    
    return changes;
  };

  // Helper function to format time (hour: 7, minutes: 30 -> "7:30 AM")
  const formatTime = (timeObj: { hours?: number; minutes?: number } | undefined, fallback = "") => {
    if (!timeObj || timeObj.hours === undefined) return fallback;
    const hours = timeObj.hours;
    const minutes = timeObj.minutes || 0;
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const displayMinutes = minutes.toString().padStart(2, "0");
    return `${displayHours}:${displayMinutes} ${period}`;
  };

  // Day order for sorting
  const dayOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

  // Helper function to create a brief preview of a field value
  const getFieldPreview = (fieldName: string, value: any): string => {
    if (value === null || value === undefined) return "No value";

    const fieldLower = fieldName.toLowerCase();

    // Hours preview
    if (fieldLower.includes("hours") && value?.periods && Array.isArray(value.periods)) {
      const firstPeriod = value.periods[0];
      if (firstPeriod) {
        const day = firstPeriod.openDay ? firstPeriod.openDay.charAt(0) + firstPeriod.openDay.slice(1).toLowerCase() : "";
        const openTime = formatTime(firstPeriod.openTime, "12:00 AM");
        const closeTime = formatTime(firstPeriod.closeTime, "");
        return closeTime ? `${day}: ${openTime} – ${closeTime}` : `${day}: ${openTime}`;
      }
    }

    // Phone preview
    if (fieldLower.includes("phone")) {
      if (Array.isArray(value) && value.length > 0) {
        return value[0];
      }
      if (value?.primaryPhone) {
        return value.primaryPhone;
      }
      if (typeof value === "string") {
        return value;
      }
    }

    // Categories preview
    if (fieldLower.includes("categor")) {
      if (value?.displayName) {
        return value.displayName;
      }
      if (value?.primaryCategory?.displayName) {
        return value.primaryCategory.displayName;
      }
      if (Array.isArray(value) && value.length > 0) {
        const names = value.map((c: any) => c.displayName || c.name || String(c)).join(", ");
        return names;
      }
      if (typeof value === "string") {
        return value;
      }
      return "Category";
    }

    // Address preview (including storefrontAddress)
    if ((fieldLower === "address" || fieldLower.includes("storefrontaddress")) && typeof value === "object") {
      const lines = value.addressLines?.[0] || "";
      const city = value.locality || "";
      const state = value.administrativeArea || "";
      return `${lines}${city ? ", " + city : ""}${state ? ", " + state : ""}`.substring(0, 80);
    }

    // Website/URL preview
    if (fieldLower.includes("website") || fieldLower.includes("uri") || fieldLower.includes("url")) {
      if (typeof value === "string") {
        return value.replace(/^https?:\/\//, "");
      }
    }

    // Description preview
    if (fieldLower.includes("description") || fieldLower === "profile") {
      const desc = typeof value === "object" ? value.description : value;
      if (typeof desc === "string") {
        return desc.substring(0, 80);
      }
    }

    // Default: stringify and truncate
    if (typeof value === "object") {
      return JSON.stringify(value).substring(0, 80);
    }

    return String(value).substring(0, 80);
  };

  // Helper function to render value in a user-friendly format
  const renderFormattedValue = (fieldName: string, value: any) => {
    if (value === null || value === undefined) {
      return <p className="text-gray-500">No value</p>;
    }

    const fieldLower = fieldName.toLowerCase();

    // Format regular hours
    if (fieldLower.includes("hours") && value?.periods) {
      const periods = value.periods as Array<{
        openDay?: string;
        closeDay?: string;
        openTime?: { hours?: number; minutes?: number };
        closeTime?: { hours?: number; minutes?: number };
      }>;

      // Group by day
      const byDay: Record<string, string[]> = {};
      for (const period of periods) {
        const day = period.openDay || "Unknown";
        // GBP omits openTime when a period starts at midnight — treat as 12:00 AM
        const open = formatTime(period.openTime, "12:00 AM");
        const close = formatTime(period.closeTime, "");
        const timeRange = close ? `${open} – ${close}` : open;
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(timeRange);
      }

      // Sort by day order
      const sortedDays = Object.keys(byDay).sort(
        (a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)
      );

      return (
        <div className="space-y-2">
          {sortedDays.map((day) => (
            <div key={day} className="flex items-start gap-4 py-2 border-b border-gray-100 last:border-0">
              <span className="font-medium text-gray-700 w-28 capitalize">
                {day.charAt(0) + day.slice(1).toLowerCase()}
              </span>
              <div className="flex flex-col gap-1">
                {byDay[day].map((time, idx) => (
                  <span key={idx} className="text-gray-600">{time}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Format phone numbers
    if (fieldLower.includes("phone") && (Array.isArray(value) || value?.primaryPhone)) {
      const phones = Array.isArray(value) 
        ? value 
        : [value.primaryPhone, ...(value.additionalPhones || [])].filter(Boolean);
      return (
        <div className="space-y-2">
          {phones.map((phone: string, idx: number) => (
            <div key={idx} className="flex items-center gap-2 py-1">
              <span className="text-gray-600">{phone}</span>
              {idx === 0 && <Badge variant="outline" className="text-xs">Primary</Badge>}
            </div>
          ))}
        </div>
      );
    }

    // Format address (including storefrontAddress)
    if ((fieldLower === "address" || fieldLower.includes("storefrontaddress")) && typeof value === "object") {
      const addr = value as {
        addressLines?: string[];
        locality?: string;
        administrativeArea?: string;
        postalCode?: string;
        regionCode?: string;
      };
      return (
        <div className="space-y-1">
          {addr.addressLines?.map((line: string, idx: number) => (
            <p key={idx} className="text-gray-700 font-medium">{line}</p>
          ))}
          <p className="text-gray-600">
            {[addr.locality, addr.administrativeArea, addr.postalCode].filter(Boolean).join(", ")}
          </p>
          {addr.regionCode && (
            <p className="text-gray-500 text-sm">{addr.regionCode}</p>
          )}
        </div>
      );
    }

    // Format categories
    if (fieldLower.includes("categor")) {
      if (value?.displayName) {
        return <span className="text-gray-700">{value.displayName}</span>;
      }
      if (value?.primaryCategory?.displayName) {
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 font-medium">Primary:</span>
              <Badge variant="secondary">{value.primaryCategory.displayName}</Badge>
            </div>
            {value.additionalCategories && Array.isArray(value.additionalCategories) && value.additionalCategories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {value.additionalCategories.map((cat: any, idx: number) => (
                  <Badge key={idx} variant="outline">
                    {cat.displayName || cat.name || String(cat)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      }
      if (Array.isArray(value)) {
        return (
          <div className="flex flex-wrap gap-2">
            {value.map((cat: any, idx: number) => (
              <Badge key={idx} variant="secondary">
                {cat.displayName || cat.name || String(cat)}
              </Badge>
            ))}
          </div>
        );
      }
    }

    // Format website/URL
    if (fieldLower.includes("website") || fieldLower.includes("uri") || fieldLower.includes("url")) {
      if (typeof value === "string") {
        return (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
            {value}
          </a>
        );
      }
    }

    // Format description
    if (fieldLower.includes("description") || fieldLower === "profile") {
      const desc = typeof value === "object" ? value.description : value;
      if (typeof desc === "string") {
        return <p className="text-gray-700 whitespace-pre-wrap">{desc}</p>;
      }
    }

    // Default: show formatted JSON for objects, plain text for strings
    if (typeof value === "object") {
      return (
        <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-3 rounded-lg overflow-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }

    return <span className="text-gray-700">{String(value)}</span>;
  };

  // Categories for organizing edits
  const editCategories = [
    { 
      id: 'title', 
      label: 'Business Name / Title', 
      icon: '🏢',
      fields: ['title', 'name', 'storeCode', 'storefrontAddress.businessName']
    },
    { 
      id: 'hours', 
      label: 'Business Hours', 
      icon: '🕐',
      fields: ['regularHours', 'specialHours', 'moreHours', 'openInfo']
    },
    { 
      id: 'phone', 
      label: 'Phone Number', 
      icon: '📞',
      fields: ['phoneNumbers', 'primaryPhone', 'additionalPhones']
    },
    { 
      id: 'address', 
      label: 'Address / Location', 
      icon: '📍',
      fields: ['address', 'storefrontAddress', 'serviceArea', 'adWordsLocationExtensions']
    },
    { 
      id: 'categories', 
      label: 'Business Categories', 
      icon: '🏷️',
      fields: ['categories', 'primaryCategory', 'additionalCategories']
    },
    { 
      id: 'website', 
      label: 'Website / Links', 
      icon: '🌐',
      fields: ['websiteUri', 'uri', 'urls', 'menu', 'orderUrl', 'reservationUrl']
    },
    { 
      id: 'description', 
      label: 'Description', 
      icon: '📝',
      fields: ['profile.description', 'description', 'profile']
    },
    { 
      id: 'photos', 
      label: 'Photos / Media', 
      icon: '📸',
      fields: ['media', 'photos', 'coverPhoto', 'logo', 'profilePhoto']
    },
    { 
      id: 'services', 
      label: 'Services', 
      icon: '🛠️',
      fields: ['serviceItems', 'services', 'foodMenus', 'products']
    },
    { 
      id: 'attributes', 
      label: 'Attributes', 
      icon: '✨',
      fields: ['attributes', 'labels']
    },
  ];

  // Categorize a field based on the editCategories. Returns null if no category matches.
  const categorizeField = (field: string): string | null => {
    const fieldLower = field.toLowerCase();
    for (const category of editCategories) {
      if (category.fields.some(f => {
        const fLower = f.toLowerCase();
        // Exact match or the incoming field starts with the category field (for nested props)
        // e.g., field "storefrontAddress.businessName" matches category field "storefrontAddress.businessName"
        // but field "storefrontAddress" does NOT match "storefrontAddress.businessName"
        return fieldLower === fLower || fieldLower.startsWith(fLower + '.');
      })) {
        return category.id;
      }
    }
    return null; // unrecognised technical field — skip
  };

  // Group scan results by category.
  // Only includes fields where the suggestedLocation actually has a non-null value —
  // this keeps counts and rendering in sync (no "13 items" tab that renders nothing).
  const groupResultsByCategory = (results: ScanResult[]) => {
    const grouped: Record<string, { result: ScanResult; fields: string[] }[]> = {};
    
    // Initialize all categories with empty arrays
    for (const category of editCategories) {
      grouped[category.id] = [];
    }

    for (const result of results) {
      const NON_ACTIONABLE = new Set(['latlng', 'plusCode', 'plus_code', 'metadata']);
      const rawFields = (result.diffMask || '').split(",").map(f => f.trim()).filter(Boolean);

      // Only keep fields that have an actual suggested value — same check as the render filter
      // Also skip purely technical/non-actionable fields like GPS coordinates
      const validFields = rawFields.filter(field => {
        if (NON_ACTIONABLE.has(field)) return false;
        const sv = getNestedValue(result.suggestedLocation, field);
        return sv !== null && sv !== undefined;
      });
      
      // Group valid fields by category for this result (skip unrecognised technical fields)
      const fieldsByCategory: Record<string, string[]> = {};
      for (const field of validFields) {
        const categoryId = categorizeField(field);
        if (!categoryId) continue; // unrecognised field — don't show
        if (!fieldsByCategory[categoryId]) {
          fieldsByCategory[categoryId] = [];
        }
        fieldsByCategory[categoryId].push(field);
      }

      // Add this result to each category it has displayable fields for
      for (const [categoryId, fields] of Object.entries(fieldsByCategory)) {
        grouped[categoryId].push({ result, fields });
      }
    }

    return grouped;
  };

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />

      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">
          {/* Header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">QUALITY</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">Suggested Edits</h1>
              {lastScannedTime && !isScanning && (
                <p className="text-xs text-gray-400 mt-1">Last scanned {formatPhoenixDateTime(lastScannedTime)}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
                <Popover open={showScanOptions} onOpenChange={setShowScanOptions}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={isScanning}
                      className="border-orange-300 text-orange-600 hover:bg-orange-50"
                      data-testid="button-scan-options"
                    >
                      <FolderOpen className="w-4 h-4 mr-2" />
                      {selectionCount > 0 ? `${selectionCount} selected` : 'Filter locations'}
                      <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <div className="p-3 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">Select folders or locations to scan</h4>
                        {selectionCount > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearSelection}
                            className="text-xs h-7 px-2"
                            data-testid="button-clear-selection"
                          >
                            Clear all
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {selectionCount === 0 
                          ? "Select items to scan specific locations, or use 'Scan All' to scan everything."
                          : `${selectionCount} item${selectionCount > 1 ? 's' : ''} selected`}
                      </p>
                    </div>
                    <ScrollArea className="h-[300px]">
                      {folders.length > 0 && (
                        <div className="p-3 border-b border-gray-100">
                          <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Folders</h5>
                          <div className="space-y-2">
                            {folders.map((folder) => (
                              <label
                                key={folder.id}
                                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded"
                                data-testid={`checkbox-folder-${folder.id}`}
                              >
                                <Checkbox
                                  checked={selectedFolderIds.includes(folder.id)}
                                  onCheckedChange={() => toggleFolderSelection(folder.id)}
                                />
                                <FolderOpen className="w-4 h-4 text-orange-500" />
                                <span className="text-sm truncate">{folder.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {allLocations.length > 0 && (
                        <div className="p-3">
                          <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Individual Locations</h5>
                          <div className="space-y-2">
                            {allLocations.map((loc) => (
                              <label
                                key={loc.id}
                                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded"
                                data-testid={`checkbox-location-${loc.id}`}
                              >
                                <Checkbox
                                  checked={selectedLocationIds.includes(loc.id)}
                                  onCheckedChange={() => toggleLocationSelection(loc.id)}
                                />
                                <MapPin className="w-4 h-4 text-cyan-500" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm truncate">{loc.name}</p>
                                  <p className="text-xs text-gray-500 truncate">{loc.address}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {folders.length === 0 && allLocations.length === 0 && (
                        <div className="p-6 text-center text-gray-500">
                          <p className="text-sm">No folders or locations available</p>
                        </div>
                      )}
                    </ScrollArea>
                    {selectionCount > 0 && (
                      <div className="p-3 border-t border-gray-200 flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleScan}
                          className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
                          data-testid="button-scan-selected"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Scan Selected ({selectionCount})
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <Button
                  onClick={selectionCount > 0 ? handleScan : handleScanAll}
                  disabled={isScanning}
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
                  data-testid="button-scan"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {scan && scan.totalLocations > 0
                        ? `Scanning ${scan.scannedCount} of ${scan.totalLocations}...`
                        : 'Starting scan...'}
                    </>
                  ) : selectionCount > 0 ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Scan {selectionCount} Selected
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Scan All Locations
                    </>
                  )}
                </Button>
              </div>
            </div>

          {/* Run status. The scan is a server-side run with a record, so this
              can always say exactly what happened — including for runs started
              in another tab, or ones killed by a deploy. */}
          <ScanStatusBanner
            scan={scan}
            isLoading={isLoadingScan}
            startError={startError}
            onCancel={cancelScan}
            // Repeat the scope of the run being reported on, not whatever
            // happens to be selected in this tab — otherwise "Run again" on an
            // interrupted folder scan silently rescans all 150 locations.
            onRescan={() =>
              startScan(
                scan?.scope?.folderIds ?? selectedFolderIds,
                scan?.scope?.locationIds ?? selectedLocationIds,
              )
            }
          />

          {/* Scan Results */}
          <Card className="border-gray-200 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-400" />
                    Pending Google Updates
                  </h2>
                  {scanResults.length > 0 && (
                    <span className="bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                      {scanResults.length}
                    </span>
                  )}
                </div>
                {scanResults.length > 0 && (
                  <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <Search className="w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search by company name or address..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="border-0 focus:ring-0 focus-visible:ring-0 bg-transparent"
                      data-testid="input-search-companies"
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                const filteredResults = scanResults.filter((result) => {
                  const searchLower = searchQuery.toLowerCase();
                  // Address is nullable in client_locations — guard it. Results
                  // are persisted now, so an unguarded null would blank this
                  // page on every load until the next scan, not just once.
                  return (
                    (result.locationName || "").toLowerCase().includes(searchLower) ||
                    (result.locationAddress || "").toLowerCase().includes(searchLower)
                  );
                });

                if (searchQuery && filteredResults.length === 0) {
                  return (
                    <div className="p-12 text-center">
                      <Search className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        No Matches Found
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        No companies match "{searchQuery}"
                      </p>
                    </div>
                  );
                }

                // Sort results: pending edits first, then acted-upon ones
                const sortedResults = [...filteredResults].sort((a, b) => {
                  const aPending = isEditPending(a.gbpLocationName);
                  const bPending = isEditPending(b.gbpLocationName);
                  if (aPending === bPending) return 0;
                  return aPending ? -1 : 1;
                });

                const groupedResults = groupResultsByCategory(sortedResults);
                const availableCategories = editCategories.filter(category => (groupedResults[category.id] || []).length > 0);
                const activeCategory = selectedCategoryId || availableCategories[0]?.id;

                return availableCategories.length === 0 ? (
                  <div className="p-12 text-center">
                    {isScanning ? (
                      <>
                        <Loader2 className="w-8 h-8 text-orange-400 mx-auto mb-4 animate-spin" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                          Scan in progress
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400">
                          {scan && scan.totalLocations > 0
                            ? `Checked ${scan.scannedCount} of ${scan.totalLocations} locations so far. Results appear here as they're found.`
                            : "Getting the list of locations to check…"}
                        </p>
                      </>
                    ) : (
                      <>
                        <Lightbulb className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                        {lastScannedTime ? (
                          <>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                              No Pending Suggestions
                            </h3>
                            <p className="text-gray-600 dark:text-gray-400">
                              Google has no suggested edits for your locations right now. Check back later.
                            </p>
                            <p className="text-xs text-gray-400 mt-3">
                              Last scanned {formatPhoenixDateTime(lastScannedTime)}
                            </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                              No Scan Run Yet
                            </h3>
                            <p className="text-gray-600 dark:text-gray-400">
                              Run a scan to check if Google has any suggested edits for your locations.
                            </p>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <Tabs value={activeCategory} onValueChange={setSelectedCategoryId} className="w-full">
                    <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                      <TabsList className="justify-start rounded-none bg-transparent p-0 h-auto flex flex-wrap w-full">
                        {availableCategories.map((category) => {
                          const count = (groupedResults[category.id] || []).length;
                          return (
                            <TabsTrigger
                              key={category.id}
                              value={category.id}
                              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 px-4 py-3 flex items-center gap-2"
                              data-testid={`tab-${category.id}`}
                            >
                              <span className="text-lg">{category.icon}</span>
                              <span>{category.label}</span>
                              <Badge variant="secondary" className="ml-1">{count}</Badge>
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>
                    </div>

                    {availableCategories.map((category) => {
                      const categoryItems = groupedResults[category.id] || [];
                      return (
                        <TabsContent key={category.id} value={category.id} className="p-6">
                          {categoryItems.length > 0 && (
                            <div className="space-y-3">
                              <div className="flex justify-end mb-4">
                                <Button
                                  size="sm"
                                  onClick={() => acceptAllInCategory(category.id, categoryItems)}
                                  disabled={isAcceptingAll}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  data-testid={`button-accept-all-${category.id}`}
                                >
                                  {isAcceptingAll ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                      Accepting...
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-4 h-4 mr-1" />
                                      Accept All ({categoryItems.reduce((acc, item) => acc + item.fields.length, 0)})
                                    </>
                                  )}
                                </Button>
                              </div>
                              {categoryItems.map(({ result, fields }) => 
                                fields.filter((field) => {
                                  // Skip fields where Google has no actual suggested value — these are
                                  // false positives where the field appears in the diffMask but Google
                                  // didn't return a replacement value (it's not suggesting a change).
                                  const sv = getNestedValue(result.suggestedLocation, field);
                                  return sv !== null && sv !== undefined;
                                }).map((field) => {
                                  const suggestedValue = getNestedValue(result.suggestedLocation, field);
                                  const originalValue = getNestedValue(result.originalLocation, field);
                                  const displayValue = getFieldPreview(field, suggestedValue);
                                  
                                  return (
                                    <div
                                      key={`${category.id}-${result.locationId}-${field}`}
                                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                                      data-testid={`suggested-edit-${category.id}-${result.locationId}-${field}`}
                                    >
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2">
                                            <MapPin className="w-4 h-4 text-orange-500" />
                                            <h4 className="font-medium text-gray-900 dark:text-white">
                                              {result.locationName}
                                            </h4>
                                            <Badge variant="outline" className="text-orange-600 border-orange-300">
                                              Pending Update
                                            </Badge>
                                          </div>
                                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                            {result.locationAddress}
                                          </p>
                                          
                                          <div className="bg-gray-50 dark:bg-gray-700/30 rounded p-3">
                                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{getFieldLabel(field)}</p>
                                            <p className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:underline" 
                                               onClick={() => setViewingField({ locationId: result.locationId, fieldName: field, originalValue, suggestedValue })}>
                                              {displayValue}
                                            </p>
                                          </div>
                                        </div>

                                        {/* Individual Actions */}
                                        <div className="flex gap-2 ml-4 flex-shrink-0">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleAction(result, field, "reject")}
                                            disabled={rejectMutation.isPending}
                                            className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                                            data-testid={`button-reject-${result.locationId}-${field}`}
                                          >
                                            <X className="w-4 h-4 mr-1" />
                                            Reject
                                          </Button>
                                          <Button
                                            size="sm"
                                            onClick={() => handleAction(result, field, "accept")}
                                            disabled={acceptMutation.isPending}
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                            data-testid={`button-accept-${result.locationId}-${field}`}
                                          >
                                            <Check className="w-4 h-4 mr-1" />
                                            Accept
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                );
              })()}
            </CardContent>
          </Card>
          {/* Recent Changes History */}
          <Card className="border-gray-200 shadow-sm rounded-2xl mt-4">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                  <History className="w-4 h-4 text-[#02bdf2]" />
                  Recent Changes
                </h2>
                {history.length > 0 && (
                  <span className="bg-cyan-100 text-cyan-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                    {history.length}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <History className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    No History Yet
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Accept or reject suggested edits to see your history here.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {history.slice(0, visibleHistoryCount).map((action) => (
                      <div
                        key={action.id}
                        className={`p-4 transition-colors cursor-pointer ${
                          ['undone', 'undone_from_accepted', 'undone_from_rejected'].includes(action.actionType)
                            ? 'opacity-50 bg-gray-50 dark:bg-gray-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'
                        }`}
                        onClick={() => setViewingHistory(action)}
                        data-testid={`history-item-${action.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              <span className={`font-medium text-sm ${
                                ['undone', 'undone_from_accepted', 'undone_from_rejected'].includes(action.actionType)
                                  ? 'text-gray-500 dark:text-gray-500 line-through' 
                                  : 'text-gray-900 dark:text-white'
                              }`}>
                                {action.locationName}
                              </span>
                              <Badge 
                                variant={action.actionType === 'accepted' ? 'default' : 'destructive'}
                                className={
                                  ['undone', 'undone_from_accepted', 'undone_from_rejected'].includes(action.actionType)
                                    ? 'bg-gray-100 text-gray-500 border-gray-200'
                                    : action.actionType === 'accepted'
                                      ? 'bg-green-100 text-green-700 border-green-200'
                                      : 'bg-red-100 text-red-700 border-red-200'
                                }
                              >
                                {action.actionType === 'undone_from_accepted' ? (
                                  <><RefreshCw className="w-3 h-3 mr-1" /> Undone · was Accepted</>
                                ) : action.actionType === 'undone_from_rejected' ? (
                                  <><RefreshCw className="w-3 h-3 mr-1" /> Undone · was Rejected</>
                                ) : action.actionType === 'undone' ? (
                                  <><RefreshCw className="w-3 h-3 mr-1" /> Undone</>
                                ) : action.actionType === 'accepted' ? (
                                  <><Check className="w-3 h-3 mr-1" /> Accepted</>
                                ) : (
                                  <><X className="w-3 h-3 mr-1" /> Rejected</>
                                )}
                              </Badge>
                            </div>
                            {action.locationAddress && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 ml-6 mb-2">
                                {action.locationAddress}
                              </p>
                            )}
                            {action.diffMask && (
                              <div className="ml-6 flex flex-wrap gap-1">
                                {action.diffMask.split(',').filter(f => f.trim() && f.trim() !== 'metadata').map((field, idx) => (
                                  <Badge key={idx} variant="outline" className={`text-xs ${['undone', 'undone_from_accepted', 'undone_from_rejected'].includes(action.actionType) ? 'opacity-60' : ''}`}>
                                    {field.trim()}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {action.actedByName && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                <span className="w-4 h-4 rounded-full bg-[#001f3f] text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                  {action.actedByName.charAt(0).toUpperCase()}
                                </span>
                                {action.actedByName}
                              </span>
                            )}
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {formatPhoenixDateTime(action.performedAt)}
                            </span>
                            {['accepted', 'rejected', 'undone', 'undone_from_accepted', 'undone_from_rejected'].includes(action.actionType) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => handleUndo(e, action.id)}
                                disabled={undoingId === action.id}
                                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 h-7 px-2"
                                data-testid={`button-undo-${action.id}`}
                              >
                                {undoingId === action.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <>
                                    <RefreshCw className="w-3 h-3 mr-1" />
                                    {action.actionType === 'undone_from_accepted' || action.actionType === 'undone'
                                      ? 'Re-accept'
                                      : action.actionType === 'undone_from_rejected'
                                        ? 'Re-reject'
                                        : 'Undo'}
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {history.length > visibleHistoryCount && (
                    <div className="p-4 border-t border-gray-100 dark:border-gray-800">
                      <Button
                        variant="ghost"
                        className="w-full text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => setVisibleHistoryCount(prev => Math.min(prev + 20, 200))}
                        data-testid="button-see-more-history"
                      >
                        <ChevronDown className="w-4 h-4 mr-2" />
                        See More ({history.length - visibleHistoryCount} remaining)
                      </Button>
                    </div>
                  )}
                  {visibleHistoryCount > 10 && (
                    <div className="px-4 pb-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-500 hover:text-gray-700"
                        onClick={() => setVisibleHistoryCount(10)}
                        data-testid="button-collapse-history"
                      >
                        Collapse
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* View Full Change Dialog */}
      <Dialog open={!!viewingField} onOpenChange={() => setViewingField(null)}>
        <DialogContent className="max-h-[80vh] overflow-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {viewingField ? getFieldLabel(viewingField.fieldName) : ''}
            </DialogTitle>
            <DialogDescription>Compare your current value with Google's suggestion</DialogDescription>
          </DialogHeader>
          
          {/* Side-by-side Before/After Comparison */}
          <div className="grid grid-cols-2 gap-4">
            {/* Current Value (Before) */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase">Your Current Value</p>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 min-h-[120px]">
                {viewingField?.originalValue !== undefined && viewingField?.originalValue !== null ? (
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {renderFormattedValue(viewingField.fieldName, viewingField.originalValue)}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No current value</p>
                )}
              </div>
            </div>
            
            {/* Suggested Value (After) */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase">Google Suggesting</p>
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 min-h-[120px]">
                {viewingField?.suggestedValue !== undefined && viewingField?.suggestedValue !== null ? (
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {renderFormattedValue(viewingField.fieldName, viewingField.suggestedValue)}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No suggested value</p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View History Details Dialog */}
      <Dialog open={!!viewingHistory} onOpenChange={() => setViewingHistory(null)}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-gray-400" />
              {viewingHistory?.locationName}
            </DialogTitle>
            <DialogDescription>
              <div className="flex items-center gap-2 mt-2">
                <Badge 
                  variant={viewingHistory?.actionType === 'accepted' ? 'default' : 'destructive'}
                  className={viewingHistory?.actionType === 'accepted' 
                    ? 'bg-green-100 text-green-700 border-green-200' 
                    : 'bg-red-100 text-red-700 border-red-200'
                  }
                >
                  {viewingHistory?.actionType === 'accepted' ? (
                    <><Check className="w-3 h-3 mr-1" /> Accepted</>
                  ) : (
                    <><X className="w-3 h-3 mr-1" /> Rejected</>
                  )}
                </Badge>
                <span className="text-xs text-gray-500">
                  {viewingHistory && formatPhoenixDateTime(viewingHistory.performedAt)}
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {viewingHistory?.locationAddress && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">Location</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{viewingHistory.locationAddress}</p>
              </div>
            )}
            {viewingHistory?.diffMask && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-3">Changes Made</p>
                <div className="space-y-4">
                  {viewingHistory.diffMask.split(',').filter(f => f.trim() && f.trim() !== 'metadata').map((field, idx) => {
                    const fieldName = field.trim();
                    // Find the change object in the changes array that matches this field
                    const changeObj = Array.isArray(viewingHistory.changes) 
                      ? viewingHistory.changes.find((c: any) => c.fieldPath === fieldName)
                      : null;
                    const originalValue = changeObj?.originalValue;
                    const suggestedValue = changeObj?.suggestedValue;
                    
                    return (
                      <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        {/* Field Name */}
                        <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2">
                          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{fieldName}</p>
                        </div>
                        
                        {/* Before/After Comparison */}
                        <div className="grid grid-cols-2 gap-0 p-3">
                          {/* Original Value (Before) */}
                          <div className="pr-2 border-r border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-2 uppercase">Before</p>
                            <div className="text-sm text-gray-700 dark:text-gray-300 bg-red-50 dark:bg-red-900/20 p-2 rounded min-h-[60px]">
                              {originalValue !== undefined && originalValue !== null ? (
                                renderFormattedValue(fieldName, originalValue)
                              ) : (
                                <span className="text-gray-400 italic">No value</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Suggested Value (After) */}
                          <div className="pl-2">
                            <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-2 uppercase">
                              {viewingHistory.actionType === 'accepted' ? 'Applied' : 'Suggested'}
                            </p>
                            <div className="text-sm text-gray-700 dark:text-gray-300 bg-green-50 dark:bg-green-900/20 p-2 rounded min-h-[60px]">
                              {suggestedValue !== undefined && suggestedValue !== null ? (
                                renderFormattedValue(fieldName, suggestedValue)
                              ) : (
                                <span className="text-gray-400 italic">No value</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!viewingHistory?.diffMask && (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500">No changes recorded</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === "accept" ? "Accept Suggested Update?" : "Reject Suggested Update?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === "accept" ? (
                <>
                  This will apply Google's suggested changes to <strong>{selectedEdit?.locationName}</strong>.
                  The changes will be visible on Google Maps and Search.
                </>
              ) : (
                <>
                  This will reject Google's suggested changes for <strong>{selectedEdit?.locationName}</strong>.
                  Your current business information will remain unchanged.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-action">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction}
              className={actionType === "accept" 
                ? "bg-green-600 hover:bg-green-700" 
                : "bg-red-600 hover:bg-red-700"
              }
              data-testid="button-confirm-action"
            >
              {acceptMutation.isPending || rejectMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {actionType === "accept" ? "Accept Update" : "Reject Update"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
