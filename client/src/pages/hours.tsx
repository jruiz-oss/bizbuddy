import { SideNav } from "@/components/SideNav";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Search, AlertCircle, Plus, X, Calendar, Folder, BarChart3, History, Settings, MapPin, MessageSquare, Lightbulb, Trash2, Star, Share2 } from "lucide-react";
import { useLocation, Link as WouterLink } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import { isGoogleAuthError } from "@/lib/authError";
import { queryClient, apiRequest, getApiUrl } from "@/lib/queryClient";
import { useJobProgress } from "@/hooks/use-job-progress";
import { useJobProgressContext } from "@/contexts/job-progress-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Client, ClientLocation, JobItem, LocationFolder, LocationTag } from "@shared/schema";

interface HoursProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

interface DayHours {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

interface WeekHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

interface SpecialHourPeriod {
  date: string;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const defaultWeekdayHours: WeekHours = {
  monday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
  tuesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
  wednesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
  thursday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
  friday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
  saturday: { isOpen: true, openTime: "10:00", closeTime: "16:00" },
  sunday: { isOpen: false, openTime: "09:00", closeTime: "17:00" },
};

const defaultRetailHours: WeekHours = {
  monday: { isOpen: true, openTime: "10:00", closeTime: "20:00" },
  tuesday: { isOpen: true, openTime: "10:00", closeTime: "20:00" },
  wednesday: { isOpen: true, openTime: "10:00", closeTime: "20:00" },
  thursday: { isOpen: true, openTime: "10:00", closeTime: "20:00" },
  friday: { isOpen: true, openTime: "10:00", closeTime: "21:00" },
  saturday: { isOpen: true, openTime: "10:00", closeTime: "21:00" },
  sunday: { isOpen: true, openTime: "11:00", closeTime: "18:00" },
};

const defaultRestaurantHours: WeekHours = {
  monday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
  tuesday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
  wednesday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
  thursday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
  friday: { isOpen: true, openTime: "11:00", closeTime: "23:00" },
  saturday: { isOpen: true, openTime: "11:00", closeTime: "23:00" },
  sunday: { isOpen: true, openTime: "12:00", closeTime: "21:00" },
};

export default function Hours({ selectedClientId, setSelectedClientId }: HoursProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const { startJobProgress } = useJobProgressContext();
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState<WeekHours>(defaultWeekdayHours);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoursType, setHoursType] = useState<"regular" | "special">("regular");
  const [specialHours, setSpecialHours] = useState<SpecialHourPeriod[]>([]);
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [selectedDayForApply, setSelectedDayForApply] = useState<keyof WeekHours | null>(null);
  
  // Job tracking state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [failedLocationsDialogOpen, setFailedLocationsDialogOpen] = useState(false);
  const [failedJobItems, setFailedJobItems] = useState<JobItem[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityLogWithLocation | null>(null);
  
  // Confirmation dialog state
  const [showUpdateHoursDialog, setShowUpdateHoursDialog] = useState(false);
  const [pendingHoursUpdate, setPendingHoursUpdate] = useState<any>(null);
  
  // Delete activity log state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<ActivityLogWithLocation | null>(null);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  // Fetch user's custom folders
  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
  });

  // Fetch locations for selected folder (only when a folder is selected)
  const { data: folderLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/folders/${folderFilter}/locations`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch folder locations");
      return response.json();
    },
    enabled: folderFilter !== "all",
  });

  // Fetch user's custom tags
  const { data: tags = [] } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
  });

  // Fetch locations for selected tag (only when a tag is selected)
  const { data: tagLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/tags", tagFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/tags/${tagFilter}/locations`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch tag locations");
      return response.json();
    },
    enabled: tagFilter !== "all",
  });


  // Fetch activity logs for hours updates
  interface ActivityLogWithLocation {
    id: string;
    clientId: string;
    clientLocationId: string | null;
    action: string;
    payloadJson: any;
    timestamp: string;
    locationName?: string;
    locationAddress?: string;
    localUser?: {
      id: string;
      name: string;
      title: string | null;
      profilePictureUrl: string | null;
    } | null;
  }

  const { data: activityLogs = [] } = useQuery<ActivityLogWithLocation[]>({
    queryKey: ["/api/activity-log", selectedClientId],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/activity-log?client_id=${selectedClientId}`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch activity log");
      const logs = await response.json();
      // Ensure payloadJson is parsed as object if it's a string
      return logs.map((log: any) => ({
        ...log,
        payloadJson: typeof log.payloadJson === 'string' ? JSON.parse(log.payloadJson) : log.payloadJson
      }));
    },
    enabled: !!selectedClientId,
  });

  // Fetch job details if an activity is selected
  const jobId = selectedActivity?.payloadJson?.jobId;
  const { data: jobDetails, isLoading: jobLoading } = useQuery<any>({
    queryKey: ["/api/jobs", jobId],
    enabled: !!jobId,
  });

  // Debug logging
  if (selectedActivity?.payloadJson?.jobId) {
    console.log("🔍 Job fetching:", { jobId, jobLoading, hasPayload: !!jobDetails?.payload, payload: jobDetails?.payload });
  }

  // Filter only hours-related activity logs
  const hoursActivityLogs = activityLogs.filter(log => 
    log.action.includes("hours") || log.action.includes("schedule")
  );

  const selectedClient = clients.find(c => c.id === selectedClientId);
  
  // Use folder locations if a folder is selected, otherwise use client locations
  // Then further filter by tag if a tag is selected
  const baseLocations = folderFilter !== "all" ? folderLocations : locations;
  const displayLocations = tagFilter !== "all" 
    ? baseLocations.filter(loc => tagLocations.some(tl => tl.id === loc.id))
    : baseLocations;

  // Clear selections from locations not in current display when filters change
  useEffect(() => {
    const displayedIds = new Set(displayLocations.map(l => l.id));
    const validSelections = Array.from(selectedLocations).filter(id => displayedIds.has(id));
    if (validSelections.length !== selectedLocations.size) {
      setSelectedLocations(new Set(validSelections));
    }
  }, [displayLocations.map(l => l.id).join(',')]);

  // Deselect locations by tag
  const handleDeselectByTag = async (tagId: string, tagName: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/tags/${tagId}/locations`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch tag locations");
      const tagLocs: ClientLocation[] = await response.json();
      
      const tagLocationIds = new Set(tagLocs.map(l => l.id));
      const newSelected = new Set(Array.from(selectedLocations).filter(id => !tagLocationIds.has(id)));
      const deselectedCount = selectedLocations.size - newSelected.size;
      
      setSelectedLocations(newSelected);
      
      if (deselectedCount > 0) {
        toast({
          title: "Locations Deselected",
          description: `Removed ${deselectedCount} location${deselectedCount > 1 ? 's' : ''} with "${tagName}" tag`,
        });
      } else {
        toast({
          title: "No Change",
          description: `No selected locations have the "${tagName}" tag`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to deselect locations by tag",
        variant: "destructive",
      });
    }
  };

  // Track job progress
  const { progress, isComplete } = useJobProgress(currentJobId, {
    onComplete: async (progress) => {
      if (progress.errorCount > 0) {
        // Fetch failed items using the job ID from progress, not state
        try {
          const response = await fetch(getApiUrl(`/api/jobs/${progress.jobId}/items`), { credentials: "include" });
          const items: JobItem[] = await response.json();
          const failed = items.filter(item => item.status === "failed");
          setFailedJobItems(failed);
          
          // Show error notification with View Failed button
          if (failed.length > 0) {
            setFailedLocationsDialogOpen(true);
          }
          
          toast({
            title: "Hours Update Completed",
            description: `${progress.errorCount} out of ${progress.totalItems} locations failed. ${failed.length > 0 ? 'Check the failed locations dialog for details.' : ''}`,
            variant: "destructive",
          });
        } catch (error) {
          console.error("Failed to fetch job items:", error);
        }
      } else if (progress.status === "success") {
        toast({
          title: "Success",
          description: `All ${progress.totalItems} locations updated successfully`,
        });
      }
      
      // Only reset job tracking if this is the currently tracked job
      setCurrentJobId(prev => prev === progress.jobId ? null : prev);
      
      // Refresh activity log and jobs
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });

  const updateHoursMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/jobs/create-hours", data);
      return response.json();
    },
    onSuccess: (job) => {
      // Trigger global progress modal
      startJobProgress(job.id, "hours");
      
      // Also track locally for completion handler
      setCurrentJobId(job.id);

      // Immediately refresh jobs and activity log so the new job appears in dashboard
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: any) => {
      showApiError("Failed to Update Hours", parseApiError(error, "Failed to update hours."), { isAuthError: isGoogleAuthError(error) });
    },
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async (activityId: string) => {
      const response = await fetch(getApiUrl(`/api/activity-log/${activityId}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Hours update entry deleted",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log", selectedClientId] });
      setDeleteDialogOpen(false);
      setActivityToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete entry",
        variant: "destructive",
      });
    },
  });

  const handleLocationToggle = (locationId: string) => {
    const newSelected = new Set(selectedLocations);
    if (newSelected.has(locationId)) {
      newSelected.delete(locationId);
    } else {
      newSelected.add(locationId);
    }
    setSelectedLocations(newSelected);
  };

  const handleDeselectAll = () => {
    setSelectedLocations(new Set());
  };

  const handleSelectAll = () => {
    const allFilteredIds = filteredLocations.map(loc => loc.id);
    setSelectedLocations(new Set(allFilteredIds));
  };

  const handleApplyToAllDays = (day: keyof WeekHours) => {
    const dayHours = hours[day];
    setHours(prev => {
      const newHours = { ...prev };
      days.forEach(({ key }) => {
        newHours[key] = { ...dayHours };
      });
      return newHours;
    });
    setSelectedDayForApply(null);
    toast({
      title: "Applied to all days",
      description: `${day.charAt(0).toUpperCase() + day.slice(1)}'s hours copied to all days`,
    });
  };

  const handleHourChange = (day: keyof WeekHours, field: keyof DayHours, value: string | boolean) => {
    setHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const handleUpdateHours = () => {
    if (selectedLocations.size === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location to update",
        variant: "destructive",
      });
      return;
    }

    setPendingHoursUpdate({
      clientId: selectedClientId,
      locationIds: Array.from(selectedLocations),
      scheduleData: { regularHours: hours },
    });
    setShowUpdateHoursDialog(true);
  };

  const handleConfirmUpdateHours = () => {
    if (pendingHoursUpdate) {
      updateHoursMutation.mutate(pendingHoursUpdate);
      setShowUpdateHoursDialog(false);
      setPendingHoursUpdate(null);
    }
  };

  const formatTime = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const days: Array<{ key: keyof WeekHours; label: string }> = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
    { key: "saturday", label: "Saturday" },
    { key: "sunday", label: "Sunday" },
  ];

  // Filter locations based on search query
  const filteredLocations = displayLocations.filter(location => 
    location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (location.address && location.address.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const allFilteredSelected = filteredLocations.length > 0 && filteredLocations.every(l => selectedLocations.has(l.id));
  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedLocations(new Set());
    } else {
      setSelectedLocations(new Set(filteredLocations.map(l => l.id)));
    }
  };

  const handleSelectAllInFolder = () => {
    if (folderFilter !== "all") {
      const allFolderLocationIds = displayLocations.map(loc => loc.id);
      setSelectedLocations(new Set(allFolderLocationIds));
    }
  };

  const [pathLoc] = useLocation();

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />
      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">
          {/* Header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">HOURS</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">Business Hours</h1>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4 items-start">
            {/* Select Locations */}
            <Card className="col-span-12 lg:col-span-4 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-gray-900">
                      <span className="text-gray-400 font-medium mr-1">1.</span>Locations
                    </h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">of {locations.length} locations</p>
                  </div>
                  {selectedLocations.size > 0 && (
                    <span className="bg-cyan-100 text-cyan-700 text-[11px] font-semibold px-2 py-0.5 rounded-full" data-testid="badge-selected-count">
                      {selectedLocations.size} selected
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                  <Input
                    placeholder="Search locations…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm rounded-lg"
                    data-testid="input-search-locations"
                  />
                </div>

                {/* Folder + Tag filter chips */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <Select value={folderFilter} onValueChange={(v) => { setFolderFilter(v); setSelectedLocations(new Set()); }}>
                    <SelectTrigger
                      className="h-7 text-xs rounded-full border-gray-200 px-2.5 w-auto inline-flex gap-1 [&>svg]:hidden"
                      data-testid="select-folder-filter"
                    >
                      <span className="truncate">
                        {folderFilter === "all" ? "+ Folder" : <>Folder: <strong className="font-semibold ml-0.5">{folders.find(f => f.id === folderFilter)?.name || "—"}</strong></>}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All folders</SelectItem>
                      {folders.map(folder => (
                        <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {folderFilter !== "all" && (
                    <button onClick={() => setFolderFilter("all")} className="text-gray-400 hover:text-gray-700 transition-colors" data-testid="button-clear-folder">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  {tags.length > 0 && (
                    <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v); setSelectedLocations(new Set()); }}>
                      <SelectTrigger
                        className="h-7 text-xs rounded-full border-gray-200 px-2.5 w-auto inline-flex gap-1 [&>svg]:hidden"
                        data-testid="select-tag-filter"
                      >
                        <span className="truncate">
                          {tagFilter === "all" ? "+ Tag" : <>Tag: <strong className="font-semibold ml-0.5">{tags.find(t => t.id === tagFilter)?.name || "—"}</strong></>}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All tags</SelectItem>
                        {tags.map(tag => (
                          <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {tagFilter !== "all" && (
                    <button onClick={() => setTagFilter("all")} className="text-gray-400 hover:text-gray-700 transition-colors" data-testid="button-clear-tag">
                      <X className="w-3 h-3" />
                    </button>
                  )}

                  {/* Exclude tag — deselects locations that have this tag */}
                  {tags.length > 0 && selectedLocations.size > 0 && (
                    <Select
                      value="none"
                      onValueChange={(tagId) => {
                        const tag = tags.find(t => t.id === tagId);
                        if (tag) handleDeselectByTag(tag.id, tag.name);
                      }}
                    >
                      <SelectTrigger
                        className="h-7 text-xs rounded-full border-red-200 text-red-600 px-2.5 w-auto inline-flex gap-1 [&>svg]:hidden hover:bg-red-50"
                        data-testid="select-exclude-tag"
                      >
                        <span>− Exclude Tag</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>Pick a tag to exclude</SelectItem>
                        {tags.map(tag => (
                          <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Select all visible */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={handleToggleSelectAll}
                      data-testid="checkbox-select-all-visible"
                    />
                    Select all visible ({filteredLocations.length})
                  </label>
                  {selectedLocations.size > 0 && (
                    <button onClick={() => setSelectedLocations(new Set())} className="text-xs text-gray-500 hover:text-gray-800" data-testid="button-clear-all">
                      Clear
                    </button>
                  )}
                </div>

                {/* Location list */}
                <div className="space-y-0.5 max-h-[420px] overflow-y-auto -mx-1 pr-1">
                  {filteredLocations.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">No locations match your filters.</p>
                  ) : filteredLocations.map((location) => {
                    const checked = selectedLocations.has(location.id);
                    return (
                      <div
                        key={location.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleLocationToggle(location.id)}
                        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleLocationToggle(location.id); } }}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left cursor-pointer transition-colors ${checked ? "bg-cyan-50" : "hover:bg-gray-50"}`}
                        data-testid={`location-row-${location.id}`}
                      >
                        <Checkbox checked={checked} onCheckedChange={() => handleLocationToggle(location.id)} className="pointer-events-none" data-testid={`checkbox-location-${location.id}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] truncate ${checked ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>{location.name}</p>
                          {location.address && <p className="text-[11px] text-gray-500 truncate">{location.address}</p>}
                        </div>
                        {location.status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                        {location.status === "temporarily_closed" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
                        {location.status === "permanently_closed" && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Business Hours Editor */}
            <Card className="col-span-12 lg:col-span-8 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 font-medium text-[15px]">2.</span>
                  <h2 className="text-[15px] font-semibold text-gray-900">Business Hours</h2>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <Tabs value={hoursType} onValueChange={(v) => setHoursType(v as any)} className="mb-6">
                  <TabsList>
                    <TabsTrigger value="regular" data-testid="tab-regular-hours">Regular Hours</TabsTrigger>
                    <TabsTrigger value="special" data-testid="tab-special-hours">Special Hours</TabsTrigger>
                  </TabsList>

                  <TabsContent value="regular">
                    <div className="space-y-4">
                    {days.map(({ key, label }) => (
                      <div key={key} className={`flex items-center justify-between py-3 px-4 border rounded-lg ${selectedDayForApply === key ? 'bg-cyan-50 border-cyan-300' : 'border-gray-200'}`}>
                        <div className="w-32">
                          <p className="font-medium text-gray-900 dark:text-gray-900">{label}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          {hours[key].isOpen ? (
                            <>
                              <Input
                                type="time"
                                value={hours[key].openTime}
                                onChange={(e) => handleHourChange(key, 'openTime', e.target.value)}
                                className="w-32"
                                data-testid={`input-${key}-open`}
                              />
                              <span className="text-gray-600 dark:text-gray-400">–</span>
                              <Input
                                type="time"
                                value={hours[key].closeTime}
                                onChange={(e) => handleHourChange(key, 'closeTime', e.target.value)}
                                className="w-32"
                                data-testid={`input-${key}-close`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleHourChange(key, 'isOpen', false)}
                                data-testid={`button-${key}-close`}
                              >
                                Mark Closed
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-600 dark:text-gray-400 font-mono">Closed</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleHourChange(key, 'isOpen', true)}
                                data-testid={`button-${key}-open`}
                              >
                                Mark Open
                              </Button>
                            </>
                          )}
                          <Button
                            variant={selectedDayForApply === key ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedDayForApply(selectedDayForApply === key ? null : key)}
                            data-testid={`button-select-${key}`}
                            className={selectedDayForApply === key ? 'bg-[#02bdf2] hover:bg-[#02bdf2]/90 text-white border-0' : ''}
                          >
                            {selectedDayForApply === key ? 'Selected' : 'Select'}
                          </Button>
                        </div>
                      </div>
                    ))}
                    </div>

                    {selectedDayForApply && (
                      <Button
                        className="w-full mt-6 bg-gray-200 hover:bg-gray-300 text-gray-900 border border-gray-300"
                        size="lg"
                        onClick={() => handleApplyToAllDays(selectedDayForApply)}
                        data-testid="button-apply-to-all-days"
                      >
                        Apply {selectedDayForApply.charAt(0).toUpperCase() + selectedDayForApply.slice(1)}'s Hours to All Days
                      </Button>
                    )}

                      <Button
                        className="w-full mt-6 bg-[#02bdf2] hover:bg-[#02bdf2]/90 text-white"
                        size="lg"
                        onClick={handleUpdateHours}
                        disabled={updateHoursMutation.isPending || selectedLocations.size === 0}
                        data-testid="button-update-hours"
                      >
                        {updateHoursMutation.isPending ? 'Updating...' : `Update Hours for ${selectedLocations.size} Location${selectedLocations.size !== 1 ? 's' : ''}`}
                      </Button>
                  </TabsContent>

                  <TabsContent value="special">
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Add special hours for holidays and events (e.g., Christmas, New Year's)
                      </p>
                      
                      {specialHours.map((period, index) => (
                        <div key={index} className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <Input
                            type="date"
                            value={period.date}
                            onChange={(e) => {
                              const newHours = [...specialHours];
                              newHours[index].date = e.target.value;
                              setSpecialHours(newHours);
                            }}
                            className="w-48"
                          />
                          {!period.isClosed ? (
                            <>
                              <Input
                                type="time"
                                value={period.openTime}
                                onChange={(e) => {
                                  const newHours = [...specialHours];
                                  newHours[index].openTime = e.target.value;
                                  setSpecialHours(newHours);
                                }}
                                className="w-32"
                              />
                              <span>–</span>
                              <Input
                                type="time"
                                value={period.closeTime}
                                onChange={(e) => {
                                  const newHours = [...specialHours];
                                  newHours[index].closeTime = e.target.value;
                                  setSpecialHours(newHours);
                                }}
                                className="w-32"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const newHours = [...specialHours];
                                  newHours[index].isClosed = true;
                                  setSpecialHours(newHours);
                                }}
                              >
                                Mark Closed
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-600 dark:text-gray-400">Closed</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const newHours = [...specialHours];
                                  newHours[index].isClosed = false;
                                  setSpecialHours(newHours);
                                }}
                              >
                                Mark Open
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSpecialHours(specialHours.filter((_, i) => i !== index));
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        onClick={() => {
                          setSpecialHours([...specialHours, { date: '', openTime: '09:00', closeTime: '17:00', isClosed: false }]);
                        }}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Special Hours Period
                      </Button>

                      <Button
                        className="w-full mt-6 bg-[#02bdf2] hover:bg-[#02bdf2]/90 text-white"
                        size="lg"
                        onClick={() => {
                          if (selectedLocations.size === 0) {
                            toast({
                              title: "No locations selected",
                              description: "Please select at least one location",
                              variant: "destructive",
                            });
                            return;
                          }
                          setPendingHoursUpdate({
                            clientId: selectedClientId,
                            locationIds: Array.from(selectedLocations),
                            scheduleData: { specialHours },
                          });
                          setShowUpdateHoursDialog(true);
                        }}
                        disabled={updateHoursMutation.isPending || selectedLocations.size === 0 || specialHours.length === 0}
                        data-testid="button-update-special-hours"
                      >
                        {updateHoursMutation.isPending ? 'Updating...' : `Update Special Hours for ${selectedLocations.size} Location${selectedLocations.size !== 1 ? 's' : ''}`}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Recent Hours Updates */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Recent Hours Updates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {hoursActivityLogs.length > 0 ? (
                  <>
                    {hoursActivityLogs.slice(0, showAllActivity ? hoursActivityLogs.length : 5).map((log) => {
                      const isRegularHours = log.action.includes("regular");
                      const isSpecialHours = log.action.includes("special");
                      
                      // Generate detailed change summary
                      let changesSummary = "";
                      if (log.payloadJson?.scheduleData) {
                        if (log.payloadJson.scheduleData.regularHours) {
                          const hours = log.payloadJson.scheduleData.regularHours;
                          const changedDays = Object.entries(hours)
                            .map(([day, h]: [string, any]) => {
                              const dayName = day.charAt(0).toUpperCase() + day.slice(1);
                              return h.isOpen ? `${dayName}: ${h.openTime}-${h.closeTime}` : `${dayName}: Closed`;
                            })
                            .join(", ");
                          changesSummary = changedDays;
                        } else if (log.payloadJson.scheduleData.specialHours) {
                          const periods = log.payloadJson.scheduleData.specialHours;
                          const specialDays = periods.map((p: any) => {
                            const [y, mo, d] = (p.date as string).split('-').map(Number);
                            const date = new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            if (p.isClosed) return `${date}: Closed`;
                            const fmt = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
                            return `${date}: ${fmt(p.openTime)} – ${fmt(p.closeTime)}`;
                          }).join(", ");
                          changesSummary = specialDays;
                        }
                      }
                      
                      // Location names summary
                      let locationsSummary = "";
                      if (log.payloadJson?.locations && log.payloadJson.locations.length > 0) {
                        const locationNames = log.payloadJson.locations.map((loc: any) => loc.name).slice(0, 3);
                        locationsSummary = locationNames.join(", ");
                        if (log.payloadJson.locations.length > 3) {
                          locationsSummary += ` +${log.payloadJson.locations.length - 3} more`;
                        }
                      }
                      
                      return (
                        <div 
                          key={log.id} 
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-orange-500 transition-colors cursor-pointer"
                          data-testid={`activity-log-${log.id}`}
                          onClick={() => setSelectedActivity(log)}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                <h3 className="font-semibold text-gray-900 dark:text-gray-900">
                                  {isRegularHours ? "Regular Hours Updated" : isSpecialHours ? "Special Hours Updated" : log.action}
                                </h3>
                              </div>
                              
                              {/* Locations affected */}
                              {locationsSummary && (
                                <div className="mb-2">
                                  <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                                    📍 {locationsSummary}
                                  </p>
                                </div>
                              )}
                              
                              {/* Changes made */}
                              {changesSummary && (
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 mt-2">
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Changes:
                                  </p>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">
                                    {changesSummary}
                                  </p>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex flex-col items-end gap-2 ml-4">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  Updated
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivityToDelete(log);
                                    setDeleteDialogOpen(true);
                                  }}
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  data-testid={`button-delete-activity-${log.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: 'UTC'
                                })}
                              </span>
                              {log.localUser?.name && (
                                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                                  by: {log.localUser.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    
                    {hoursActivityLogs.length > 5 && (
                      <Button
                        variant="ghost"
                        className="w-full text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                        onClick={() => setShowAllActivity(!showAllActivity)}
                        data-testid="button-toggle-activity"
                      >
                        {showAllActivity ? (
                          <>
                            <Search className="w-4 h-4 mr-2" />
                            Show Less
                          </>
                        ) : (
                          <>
                            <Search className="w-4 h-4 mr-2" />
                            Show {hoursActivityLogs.length - 5} More
                          </>
                        )}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No recent hours updates</p>
                    <p className="text-sm mt-1">Update hours for locations to see activity here</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      {/* Failed Locations Dialog */}
      <Dialog open={failedLocationsDialogOpen} onOpenChange={setFailedLocationsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Failed Locations ({failedJobItems.length})
            </DialogTitle>
            <DialogDescription>
              The following locations failed to update. Review the errors below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {failedJobItems.map((item) => {
              const location = locations.find(l => l.id === item.clientLocationId);
              const payload = item.payload as any;
              return (
                <div 
                  key={item.id} 
                  className="p-4 border border-red-200 dark:border-red-900 rounded-lg bg-red-50 dark:bg-red-950/30"
                  data-testid={`failed-location-${item.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-900">
                        {location?.name || payload?.locationTitle || 'Unknown Location'}
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {location?.address || 'No address available'}
                      </p>
                      {item.errorText && (
                        <div className="mt-3 p-2 bg-white dark:bg-gray-900 rounded border border-red-300 dark:border-red-800">
                          <p className="text-xs font-mono text-red-700 dark:text-red-300">
                            {item.errorText}
                          </p>
                        </div>
                      )}
                    </div>
                    <Badge variant="destructive" data-testid={`badge-failed-${item.id}`}>
                      Failed
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end pt-4">
            <Button 
              onClick={() => setFailedLocationsDialogOpen(false)}
              data-testid="button-close-failures"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Activity Details Dialog */}
      <Dialog open={!!selectedActivity} onOpenChange={() => setSelectedActivity(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600" />
              Hours Update Details
            </DialogTitle>
            <DialogDescription>
              View complete details of this hours update including all affected locations and their status
            </DialogDescription>
          </DialogHeader>
          {selectedActivity && (
            <div className="space-y-6 pb-4 overflow-y-auto flex-1">
              {/* Status Summary */}
              <div className="bg-muted/50 dark:bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedActivity.payloadJson?.hoursType === "regular" ? "Regular Hours" : "Special Hours"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(selectedActivity.timestamp).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC'
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-foreground">
                      {selectedActivity.payloadJson?.locationCount || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">Locations</p>
                  </div>
                </div>
              </div>
              {/* Hours Changes - Show FIRST so users see what was set - Get from job details */}
              <div className="border-2 border-orange-200 dark:border-orange-900 bg-white dark:bg-gray-900 rounded-lg p-4 border-t-[#034657] border-r-[#034657] border-b-[#034657] border-l-[#034657]">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">
                  📋 Hours Set:
                </h3>

                {/* Get schedule data from job payload */}
                {jobDetails?.payload?.hoursData ? (
                  <>
                    {/* Regular Hours */}
                    {jobDetails.payload.hoursData.regularHours && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-3">
                          Regular Hours
                        </h4>
                        <div className="space-y-2">
                          {Object.entries(jobDetails.payload.hoursData.regularHours).map(([day, hours]: [string, any]) => {
                            const formatTime = (time: string) => {
                              if (!time) return "";
                              const [hourStr, minuteStr] = time.split(':');
                              const hour = parseInt(hourStr, 10);
                              const ampm = hour >= 12 ? 'PM' : 'AM';
                              const displayHour = hour % 12 || 12;
                              return `${displayHour}:${minuteStr} ${ampm}`;
                            };
                            return (
                              <div key={day} className="flex items-center justify-between">
                                <span className="font-medium capitalize text-gray-900 dark:text-gray-100 w-24">
                                  {day}
                                </span>
                                <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                                  {hours.isOpen ? `${formatTime(hours.openTime)} - ${formatTime(hours.closeTime)}` : 'Closed'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Special Hours */}
                    {jobDetails.payload.hoursData.specialHours && 
                     jobDetails.payload.hoursData.specialHours.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-3">
                          Special Hours
                        </h4>
                        <div className="space-y-2">
                          {jobDetails.payload.hoursData.specialHours.map((period: any, index: number) => {
                            const formatTime = (time: string) => {
                              if (!time) return "";
                              const [hourStr, minuteStr] = time.split(':');
                              const hour = parseInt(hourStr, 10);
                              const ampm = hour >= 12 ? 'PM' : 'AM';
                              const displayHour = hour % 12 || 12;
                              return `${displayHour}:${minuteStr} ${ampm}`;
                            };
                            return (
                              <div key={index} className="flex items-center justify-between">
                                <span className="font-medium text-gray-900 dark:text-gray-100">
                                  {(() => { const [y,mo,d] = (period.date as string).split('-').map(Number); return new Date(y, mo-1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); })()}
                                </span>
                                <span className="text-sm font-semibold text-[#001f3f] dark:text-orange-400">
                                  {period.isClosed ? (
                                    <span className="text-red-600 dark:text-red-400">Closed</span>
                                  ) : (
                                    `${formatTime(period.openTime)} - ${formatTime(period.closeTime)}`
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : jobLoading ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4 animate-pulse">
                      Loading hours data...
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400 text-center py-2">
                      No hours data found
                    </p>
                    <details className="text-xs text-gray-600 dark:text-gray-400">
                      <summary className="cursor-pointer font-semibold">Debug Info</summary>
                      <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-40 text-xs mt-2">
                        {JSON.stringify({ jobId, hasJobDetails: !!jobDetails, payload: jobDetails?.payload }, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

              {/* Locations List - Show from job details if available, otherwise from activity payload */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">
                  📍 Locations Applied To:
                </h3>
                {jobDetails?.items && jobDetails.items.length > 0 ? (
                  <div className="grid gap-3">
                    {jobDetails.items.map((item: any, index: number) => {
                      // Get location title and address from job item payload
                      const locTitle = item.payload?.locationTitle || `Location ${index + 1}`;
                      const locAddress = item.payload?.locationAddress || 'Address not available';
                      const status = item.status || 'pending';
                      
                      return (
                        <div
                          key={item.id || index}
                          className="flex items-start gap-3 p-4 bg-white dark:bg-gray-700 rounded-lg border-l-4 border-orange-500 border-t-[#024254] border-r-[#024254] border-b-[#024254] border-l-[#024254]"
                        >
                          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                            <span className={`w-3 h-3 rounded-full ${
                              status === 'success' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                            }`}></span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-900 dark:text-gray-100 block text-sm">{locTitle}</span>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                              {locAddress}
                            </p>
                            {status === 'failed' && item.errorText && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-2 leading-relaxed">
                                <span className="font-semibold">Error: </span>{item.errorText}
                              </p>
                            )}
                          </div>
                          <span className={`text-xs px-2.5 py-1 rounded-full flex-shrink-0 whitespace-nowrap font-medium capitalize ${
                            status === 'success'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : status === 'failed'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                          }`}>
                            {status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border-2 border-orange-200 dark:border-orange-900 bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-950/40 dark:to-yellow-950/40 rounded-lg p-6 text-center">
                    <p className="text-gray-900 dark:text-gray-100 font-semibold mb-2">
                      Hours applied to {selectedActivity?.payloadJson?.locationCount || 'multiple'} location{(selectedActivity?.payloadJson?.locationCount || 0) !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Individual location details are being loaded...
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Hours Update Confirmation Dialog */}
      <AlertDialog open={showUpdateHoursDialog} onOpenChange={setShowUpdateHoursDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Hours Update</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to update hours for {pendingHoursUpdate?.locationIds?.length || 0} location{pendingHoursUpdate?.locationIds?.length !== 1 ? 's' : ''}.
              {pendingHoursUpdate?.scheduleData?.regularHours && (
                <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <p className="font-semibold">Regular Hours:</p>
                  {Object.entries(pendingHoursUpdate.scheduleData.regularHours).map(([day, dayHours]: [string, any]) => (
                    <p key={day} className="ml-2">
                      {day.charAt(0).toUpperCase() + day.slice(1)}: {dayHours.isOpen ? `${formatTime(dayHours.openTime)} - ${formatTime(dayHours.closeTime)}` : 'Closed'}
                    </p>
                  ))}
                </div>
              )}
              {pendingHoursUpdate?.scheduleData?.specialHours && (
                <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <p className="font-semibold">Special Hours:</p>
                  {pendingHoursUpdate.scheduleData.specialHours.map((period: any, idx: number) => {
                    const [y, m, d] = (period.date as string).split('-').map(Number);
                    const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
                    return (
                      <p key={idx} className="ml-2">
                        {label}: {period.isClosed ? 'Closed' : `${formatTime(period.openTime)} – ${formatTime(period.closeTime)}`}
                      </p>
                    );
                  })}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-update-hours">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmUpdateHours}
              disabled={updateHoursMutation.isPending}
              data-testid="button-confirm-update-hours"
              className="bg-orange-600 hover:bg-orange-700"
            >
              {updateHoursMutation.isPending ? 'Updating...' : 'Confirm & Update'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Delete Activity Log Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Hours Update Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this hours update entry? This will only remove the record from your activity history - it will not undo the actual hours changes on Google.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-activity">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => activityToDelete && deleteActivityMutation.mutate(activityToDelete.id)}
              disabled={deleteActivityMutation.isPending}
              data-testid="button-confirm-delete-activity"
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteActivityMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
