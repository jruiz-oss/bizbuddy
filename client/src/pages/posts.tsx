import { SideNav } from "@/components/SideNav";
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Trash2, Search, ChevronDown, ChevronUp, Copy, Link, AlertCircle, BarChart3, Clock, History, Settings, MapPin, FileText, MessageSquare, Lightbulb, Star, Share2, Eye, Smartphone, Monitor, Calendar, CheckCircle2, Image as ImageIcon, X, PenLine, Send, Upload, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import { useJobProgress } from "@/hooks/use-job-progress";
import { useJobProgressContext } from "@/contexts/job-progress-context";
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
import type { Client, ClientLocation, Post, JobItem, LocationFolder, LocationTag } from "@shared/schema";

interface EnrichedPost extends Post {
  callToAction?: {
    actionType: string;
    url: string;
  } | null;
  media?: Array<{
    mediaFormat: string;
    sourceUrl: string;
  }> | null;
  topicType?: string | null;
  locationName?: string;
  locationAddress?: string;
}

interface PostsProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

// Helper function to convert UTC stored time back to local time for display
function formatScheduledTimeLocal(scheduledDate: string, scheduledTime: string): { date: string; time: string } {
  // Parse the UTC date and time
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  const utcDate = new Date(scheduledDate);
  utcDate.setUTCHours(hours, minutes, 0, 0);
  
  // Format in local time
  const localDate = utcDate.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  
  const localTime = utcDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return { date: localDate, time: localTime };
}

export default function Posts({ selectedClientId, setSelectedClientId }: PostsProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const { startJobProgress } = useJobProgressContext();
  
  const [postDescription, setPostDescription] = useState("");
  const [buttonType, setButtonType] = useState("LEARN_MORE");
  const [buttonUrl, setButtonUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [locationSearch, setLocationSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [postToDelete, setPostToDelete] = useState<EnrichedPost | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [selectedPost, setSelectedPost] = useState<EnrichedPost | null>(null);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [isDescClamped, setIsDescClamped] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewPostData, setPreviewPostData] = useState<any>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [selectedScheduledPost, setSelectedScheduledPost] = useState<any>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [postToCancel, setPostToCancel] = useState<any>(null);
  const [showAllPreviewLocations, setShowAllPreviewLocations] = useState(false);
  
  // Job tracking state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [failedLocationsDialogOpen, setFailedLocationsDialogOpen] = useState(false);
  const [failedJobItems, setFailedJobItems] = useState<JobItem[]>([]);
  
  // Preview device toggle (visual only)
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");
  // UTM section ref to scroll to when "Customize" is clicked
  const utmSectionRef = useRef<HTMLDivElement>(null);

  // Upload a local image to Google Cloud Storage and fill in the public URL
  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type)) {
      toast({
        title: "Unsupported file",
        description: "Use JPG, PNG, or GIF (HEIC/HEIF not supported)",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      if (selectedClientId) formData.append('clientId', selectedClientId);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Upload failed');
      }

      const { url } = await response.json();
      setImageUrl(url);
    } catch (error: any) {
      toast({
        title: "Image upload failed",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsUploadingImage(false);
      e.target.value = "";
    }
  };

  // UTM Builder state
  const [utmBaseUrl, setUtmBaseUrl] = useState("");
  const [utmSource, setUtmSource] = useState("local");
  const [utmMedium, setUtmMedium] = useState("gbppost");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmTerm, setUtmTerm] = useState("");
  const [utmContent, setUtmContent] = useState("");

  // Auto-fill UTM campaign with today's date on mount
  useEffect(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    setUtmCampaign(`${month}${day}${year}`);
  }, []);

  // Pre-fill form from a retry action on the dashboard
  useEffect(() => {
    const raw = sessionStorage.getItem("postRetryData");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.content) setPostDescription(data.content);
      if (data.imageUrl) setImageUrl(data.imageUrl);
      if (data.ctaType) setButtonType(data.ctaType);
      if (data.ctaUrl) setButtonUrl(data.ctaUrl);
      if (Array.isArray(data.locationIds) && data.locationIds.length > 0) {
        setSelectedLocations(new Set(data.locationIds));
      }
      sessionStorage.removeItem("postRetryData");
      toast({ title: "Form pre-filled from failed job — review and hit Publish." });
    } catch {}
  }, []);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  const { data: posts = [] } = useQuery<EnrichedPost[]>({
    queryKey: ["/api/clients", selectedClientId, "posts"],
    enabled: !!selectedClientId,
  });

  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
  });

  const { data: folderLocations = [], isLoading: isFolderLocationsLoading } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(`/api/folders/${folderFilter}/locations`);
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
      const response = await fetch(`/api/tags/${tagFilter}/locations`);
      if (!response.ok) throw new Error("Failed to fetch tag locations");
      return response.json();
    },
    enabled: tagFilter !== "all",
  });

  const { data: scheduledPosts = [] } = useQuery<any[]>({
    queryKey: ["/api/scheduled-posts"],
    refetchInterval: 30000,
  });

  const selectedClient = clients.find(c => c.id === selectedClientId);

  // Track job progress
  const { progress, isComplete } = useJobProgress(currentJobId, {
    onComplete: async (progress) => {
      if (progress.errorCount > 0) {
        // Fetch failed items using the job ID from progress, not state
        try {
          const response = await fetch(`/api/jobs/${progress.jobId}/items`);
          const items: JobItem[] = await response.json();
          const failed = items.filter(item => item.status === "failed");
          setFailedJobItems(failed);
          
          // Show error notification
          toast({
            title: "Job Completed with Errors",
            description: `${progress.errorCount} out of ${progress.totalItems} locations failed`,
            variant: "destructive",
            action: failed.length > 0 ? (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setFailedLocationsDialogOpen(true)}
                data-testid="button-view-failures"
              >
                View Failed
              </Button>
            ) : undefined,
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
      
      // Refresh posts list
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "posts"] });
    },
  });

  const createPostMutation = useMutation({
    mutationFn: async (data: { clientId: string; locationIds: string[]; postData: any; imageUrl?: string; isScheduled?: boolean; scheduledDate?: string; scheduledTime?: string; timezoneOffset?: number }) => {
      const response = await apiRequest('POST', '/api/jobs/create-post', {
        clientId: data.clientId,
        locationIds: data.locationIds,
        postData: data.postData,
        imageUrl: data.imageUrl,
        isScheduled: data.isScheduled,
        scheduledDate: data.scheduledDate,
        scheduledTime: data.scheduledTime,
        timezoneOffset: data.timezoneOffset,
      });
      return await response.json();
    },
    onSuccess: (job) => {
      // Trigger global progress toast
      if (!isScheduled) {
        startJobProgress(job.id, "posts");
      }
      
      // Also track locally for completion handler (failed locations dialog, etc.)
      setCurrentJobId(job.id);
      
      // Reset form
      setPostDescription("");
      setButtonType("LEARN_MORE");
      setButtonUrl("");
      setImageUrl("");
      setSelectedLocations(new Set());
      setIsScheduled(false);
      setScheduledDate("");
      setScheduledTime("09:00");
      
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: any) => {
      showApiError("Failed to Create Post", parseApiError(error, "Failed to create post. Your Google session may have expired."));
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      const response = await fetch(`/api/posts/${postId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Post deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "posts"] });
      setDeleteDialogOpen(false);
      setPostToDelete(null);
    },
    onError: (error: any) => {
      showApiError("Failed to Delete Post", parseApiError(error, "Failed to delete post. Your Google session may have expired."));
    },
  });

  const cancelScheduledPostMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest('POST', `/api/scheduled-posts/${jobId}/cancel`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Scheduled post cancelled",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-posts"] });
      setCancelDialogOpen(false);
      setPostToCancel(null);
      setSelectedScheduledPost(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel scheduled post",
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

  // Filter locations based on folder and tag selection
  const folderFilteredLocations = folderFilter === "all" 
    ? locations 
    : locations.filter(location => folderLocations.some(fl => fl.id === location.id));
  
  const displayedLocations = tagFilter === "all"
    ? folderFilteredLocations
    : folderFilteredLocations.filter(location => tagLocations.some(tl => tl.id === location.id));

  // Memoize displayed location IDs for stable dependency
  const displayedLocationIds = useMemo(() => 
    displayedLocations.map(l => l.id).sort().join(','),
    [displayedLocations]
  );

  // Filter by search
  const filteredLocations = displayedLocations.filter((location) => 
    location.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
    location.address?.toLowerCase().includes(locationSearch.toLowerCase())
  );

  // Clear selections from locations not in current display when folder/tag filters change
  useEffect(() => {
    // Only run when we have valid location data (not loading)
    if (isFolderLocationsLoading) {
      return; // Still loading folder locations
    }
    
    const displayedIds = new Set(displayedLocations.map(l => l.id));
    const validSelections = Array.from(selectedLocations).filter(id => displayedIds.has(id));
    if (validSelections.length !== selectedLocations.size) {
      setSelectedLocations(new Set(validSelections));
    }
  }, [displayedLocationIds, isFolderLocationsLoading]);

  useEffect(() => {
    if (!selectedPost) return;
    setShowFullDesc(false);
    setIsDescClamped(false);
    requestAnimationFrame(() => {
      if (descRef.current) {
        setIsDescClamped(descRef.current.scrollHeight > descRef.current.clientHeight);
      }
    });
  }, [selectedPost]);

  // Deselect locations by tag
  const handleDeselectByTag = async (tagId: string, tagName: string) => {
    try {
      const response = await fetch(`/api/tags/${tagId}/locations`);
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

  const handleSelectAll = () => {
    const filteredIds = new Set(filteredLocations.map(l => l.id));
    const allFilteredSelected = filteredLocations.every(loc => selectedLocations.has(loc.id));
    
    if (allFilteredSelected && filteredLocations.length > 0) {
      // Deselect all filtered locations
      const newSet = new Set(Array.from(selectedLocations).filter(id => !filteredIds.has(id)));
      setSelectedLocations(newSet);
    } else {
      // Select all filtered locations
      const newSet = new Set(selectedLocations);
      filteredLocations.forEach(loc => newSet.add(loc.id));
      setSelectedLocations(newSet);
    }
  };

  const handleCreatePost = () => {
    if (!postDescription.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a description",
        variant: "destructive",
      });
      return;
    }

    if (!buttonUrl.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a button URL",
        variant: "destructive",
      });
      return;
    }

    if (selectedLocations.size === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    const postData: any = {
      summary: postDescription,
      callToAction: {
        actionType: buttonType,
        url: buttonUrl,
      },
      topicType: "STANDARD",
    };

    // Store the data for preview and show preview dialog
    // Include timezone offset for proper UTC conversion on server
    const timezoneOffset = new Date().getTimezoneOffset();
    setPreviewPostData({
      clientId: selectedClientId,
      locationIds: Array.from(selectedLocations),
      postData,
      imageUrl: imageUrl || undefined,
      isScheduled,
      scheduledDate: isScheduled ? scheduledDate : undefined,
      scheduledTime: isScheduled ? scheduledTime : undefined,
      timezoneOffset: isScheduled ? timezoneOffset : undefined,
    });
    setShowAllPreviewLocations(false);
    setShowPreviewDialog(true);
  };

  const handleConfirmPublish = () => {
    if (previewPostData) {
      console.log('🎬 Creating post with data:', {
        hasImageUrl: !!previewPostData.imageUrl,
        postData: JSON.stringify(previewPostData.postData, null, 2)
      });

      createPostMutation.mutate(previewPostData);
      setShowPreviewDialog(false);
      setPreviewPostData(null);
    }
  };

  const handleDeleteClick = (post: Post) => {
    setPostToDelete(post);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (postToDelete) {
      deletePostMutation.mutate(postToDelete.id);
    }
  };

  // Generate UTM URL
  const generateUtmUrl = () => {
    if (!utmBaseUrl) return "";
    
    const params = new URLSearchParams();
    if (utmSource) params.append("utm_source", utmSource);
    if (utmMedium) params.append("utm_medium", utmMedium);
    if (utmCampaign) params.append("utm_campaign", utmCampaign);
    if (utmTerm) params.append("utm_term", utmTerm);
    if (utmContent) params.append("utm_content", utmContent);
    
    const queryString = params.toString();
    return queryString ? `${utmBaseUrl}?${queryString}` : utmBaseUrl;
  };

  const handleCopyUtmUrl = () => {
    const utmUrl = generateUtmUrl();
    if (utmUrl) {
      navigator.clipboard.writeText(utmUrl);
      toast({
        title: "Copied!",
        description: "UTM URL copied to clipboard",
      });
    }
  };

  // Pre-flight checks (computed from real form state)
  const ctaLabelMap: Record<string, string> = {
    LEARN_MORE: "Learn more",
    BOOK: "Book",
    ORDER: "Order",
    CALL: "Call",
    SIGN_UP: "Sign up",
  };
  const preflightChecks: { ok: "good" | "warn" | "info"; label: string }[] = [
    {
      ok: postDescription.trim().length > 0 && postDescription.length <= 1500 ? "good" : "warn",
      label: postDescription.trim().length === 0
        ? "Add a description"
        : `Description within 1500 chars (${postDescription.length})`,
    },
    {
      ok: buttonUrl.trim().length > 0 ? "good" : "warn",
      label: buttonUrl.trim() ? "Destination URL set" : "Destination URL missing",
    },
    {
      ok: imageUrl.trim() ? "good" : "info",
      label: imageUrl.trim() ? "Photo attached" : "No photo attached (optional)",
    },
    {
      ok: selectedLocations.size > 0 ? "good" : "warn",
      label: selectedLocations.size > 0
        ? `${selectedLocations.size} location${selectedLocations.size === 1 ? "" : "s"} selected`
        : "Select at least one location",
    },
    ...(isScheduled
      ? [{
          ok: (scheduledDate && scheduledTime ? "good" : "warn") as "good" | "warn",
          label: scheduledDate && scheduledTime
            ? `Scheduled for ${scheduledDate} at ${scheduledTime}`
            : "Choose a date & time",
        }]
      : []),
  ];

  const canPublish = postDescription.trim().length > 0
    && buttonUrl.trim().length > 0
    && selectedLocations.size > 0
    && (!isScheduled || (!!scheduledDate && !!scheduledTime));

  const allFilteredSelected = filteredLocations.length > 0
    && filteredLocations.every(loc => selectedLocations.has(loc.id));

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />

      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">

          {/* Header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">POSTS</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">
                New post
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {selectedLocations.size > 0 && (
                <button
                  onClick={() => setSelectedLocations(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5"
                  data-testid="button-clear-selections"
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleCreatePost}
                disabled={!canPublish || createPostMutation.isPending}
                className="bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-full px-4 py-2 inline-flex items-center gap-2 transition-colors"
                data-testid="button-publish-post"
              >
                {isScheduled ? <Calendar className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                {createPostMutation.isPending
                  ? "Publishing…"
                  : isScheduled
                    ? `Schedule for ${selectedLocations.size || 0} location${selectedLocations.size === 1 ? "" : "s"}`
                    : `Publish to ${selectedLocations.size || 0} location${selectedLocations.size === 1 ? "" : "s"}`
                }
              </button>
            </div>
          </div>

          {/* Top: 3-column compose layout */}
          <div className="grid grid-cols-12 gap-4 items-start">

            {/* 1. Targets */}
            <Card className="col-span-12 lg:col-span-3 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-gray-900">
                      <span className="text-gray-400 font-medium mr-1">1.</span>Targets
                    </h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">of {locations.length} locations</p>
                  </div>
                  {selectedLocations.size > 0 && (
                    <span className="bg-orange-100 text-orange-700 text-[11px] font-semibold px-2 py-0.5 rounded-full" data-testid="badge-selected-count">
                      {selectedLocations.size} selected
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                  <Input
                    placeholder="Search locations…"
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="pl-8 h-8 text-sm rounded-lg"
                    data-testid="input-location-search"
                  />
                </div>

                {/* Folder + Tag filter chips */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <Select value={folderFilter} onValueChange={setFolderFilter}>
                    <SelectTrigger
                      className="h-7 text-xs rounded-full border-gray-200 px-2.5 w-auto inline-flex gap-1 [&>svg]:hidden"
                      data-testid="select-folder-filter"
                    >
                      <span className="truncate">
                        {folderFilter === "all"
                          ? "+ Folder"
                          : <>Folder: <strong className="font-semibold ml-0.5">{folders.find(f => f.id === folderFilter)?.name || "—"}</strong></>}
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
                    <button
                      onClick={() => setFolderFilter("all")}
                      className="text-gray-400 hover:text-gray-700 transition-colors"
                      data-testid="button-clear-folder"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}

                  {tags.length > 0 && (
                    <Select value={tagFilter} onValueChange={setTagFilter}>
                      <SelectTrigger
                        className="h-7 text-xs rounded-full border-gray-200 px-2.5 w-auto inline-flex gap-1 [&>svg]:hidden"
                        data-testid="select-tag-filter"
                      >
                        <span className="truncate">
                          {tagFilter === "all"
                            ? "+ Tag"
                            : <>Tag: <strong className="font-semibold ml-0.5">{tags.find(t => t.id === tagFilter)?.name || "—"}</strong></>}
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
                    <button
                      onClick={() => setTagFilter("all")}
                      className="text-gray-400 hover:text-gray-700 transition-colors"
                      data-testid="button-clear-tag"
                    >
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
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all-visible"
                    />
                    Select all visible ({filteredLocations.length})
                  </label>
                  {selectedLocations.size > 0 && (
                    <button
                      onClick={() => setSelectedLocations(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-800"
                      data-testid="button-clear-all"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Location list */}
                <div className="space-y-0.5 max-h-[420px] overflow-y-auto -mx-1 pr-1">
                  {filteredLocations.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">No locations match your filters.</p>
                  ) : (
                    filteredLocations.map((location) => {
                      const checked = selectedLocations.has(location.id);
                      return (
                        <div
                          key={location.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleLocationToggle(location.id)}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              handleLocationToggle(location.id);
                            }
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                            checked ? "bg-orange-50" : "hover:bg-gray-50"
                          }`}
                          data-testid={`location-row-${location.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => handleLocationToggle(location.id)}
                            className="pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-[13px] truncate ${checked ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
                              {location.name}
                            </p>
                            {location.address && (
                              <p className="text-[11px] text-gray-500 truncate">{location.address}</p>
                            )}
                          </div>
                          {location.status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                          {location.status === "temporarily_closed" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
                          {location.status === "permanently_closed" && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 2. Compose */}
            <Card className="col-span-12 lg:col-span-5 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <h2 className="text-[15px] font-semibold text-gray-900">
                  <span className="text-gray-400 font-medium mr-1">2.</span>Compose
                </h2>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0 space-y-5">
                {/* Description */}
                <div>
                  <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5 block">
                    Description
                  </label>
                  <Textarea
                    placeholder="What would you like to share?"
                    value={postDescription}
                    onChange={(e) => setPostDescription(e.target.value)}
                    rows={5}
                    maxLength={1500}
                    className="resize-none rounded-lg border-gray-200 text-sm"
                    data-testid="textarea-post-description"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    {postDescription.length}/1500 characters
                  </p>
                </div>

                {/* Button + URL */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5 block">
                      Button
                    </label>
                    <Select value={buttonType} onValueChange={setButtonType}>
                      <SelectTrigger className="h-9 rounded-lg text-sm border-gray-200" data-testid="select-button-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LEARN_MORE">Learn more</SelectItem>
                        <SelectItem value="BOOK">Book</SelectItem>
                        <SelectItem value="ORDER">Order</SelectItem>
                        <SelectItem value="CALL">Call</SelectItem>
                        <SelectItem value="SIGN_UP">Sign up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5 block">
                      Destination URL
                    </label>
                    <div className="relative">
                      <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                      <Input
                        placeholder="https://example.com"
                        value={buttonUrl}
                        onChange={(e) => setButtonUrl(e.target.value)}
                        className="pl-8 h-9 rounded-lg text-sm border-gray-200"
                        data-testid="input-button-url"
                      />
                    </div>
                  </div>
                </div>

                {/* Photo */}
                <div>
                  <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5 block">
                    Photo <span className="text-gray-400 normal-case font-medium tracking-normal">(optional)</span>
                  </label>
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => imageFileInputRef.current?.click()}
                      disabled={isUploadingImage}
                      className="text-xs font-medium px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      data-testid="button-upload-image"
                    >
                      {isUploadingImage ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-3 h-3" />
                          Upload Image
                        </>
                      )}
                    </button>
                    <span className="text-[11px] text-gray-400">or paste a URL below</span>
                  </div>
                  <input
                    ref={imageFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif"
                    className="hidden"
                    onChange={handleImageFileSelect}
                    data-testid="input-image-file"
                  />
                  <Input
                    placeholder="https://storage.googleapis.com/your-image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="h-9 rounded-lg text-sm border-gray-200"
                    data-testid="input-image-url"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Direct link to image · 1200×900 recommended · JPG/PNG
                  </p>
                </div>

                {/* Schedule */}
                <div>
                  <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5 block">
                    Schedule
                  </label>
                  <div className="flex gap-1.5 mb-3">
                    <button
                      onClick={() => setIsScheduled(false)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                        !isScheduled
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                      data-testid="button-schedule-now"
                    >
                      Post now
                    </button>
                    <button
                      onClick={() => setIsScheduled(true)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors ${
                        isScheduled
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                      data-testid="button-schedule-later"
                    >
                      <Calendar className="w-3 h-3" />
                      Schedule
                    </button>
                  </div>
                  {isScheduled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5 pointer-events-none" />
                        <Input
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={new Date().toISOString().split("T")[0]}
                          className="pl-8 h-9 rounded-lg text-sm border-gray-200"
                          data-testid="input-scheduled-date"
                        />
                      </div>
                      <div className="relative">
                        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5 pointer-events-none" />
                        <Input
                          type="time"
                          value={scheduledTime}
                          onChange={(e) => setScheduledTime(e.target.value)}
                          className="pl-8 h-9 rounded-lg text-sm border-gray-200"
                          data-testid="input-scheduled-time"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* UTM tracking quick info */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold">
                      UTM tracking
                    </label>
                    <span className="bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Auto
                    </span>
                  </div>
                  <button
                    onClick={() => utmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="w-full text-left text-xs text-gray-500 hover:text-gray-800 transition-colors border border-dashed border-gray-200 rounded-lg px-3 py-2 hover:border-gray-300"
                    data-testid="link-customize-utm"
                  >
                    Source <strong className="font-mono text-gray-800">{utmSource}</strong> · Medium <strong className="font-mono text-gray-800">{utmMedium}</strong> · Campaign <strong className="font-mono text-gray-800">{utmCampaign || "—"}</strong>
                    <span className="float-right text-gray-400">Customize ↓</span>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* 3. Preview */}
            <Card className="col-span-12 lg:col-span-4 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-gray-900">
                    <span className="text-gray-400 font-medium mr-1">3.</span>Preview
                  </h2>
                  <div className="flex bg-gray-100 rounded-full p-0.5">
                    <button
                      onClick={() => setPreviewDevice("mobile")}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition-colors ${
                        previewDevice === "mobile" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                      }`}
                      data-testid="button-preview-mobile"
                    >
                      <Smartphone className="w-3 h-3" />
                      Mobile
                    </button>
                    <button
                      onClick={() => setPreviewDevice("desktop")}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition-colors ${
                        previewDevice === "desktop" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                      }`}
                      data-testid="button-preview-desktop"
                    >
                      <Monitor className="w-3 h-3" />
                      Desktop
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                {/* GBP-style preview card */}
                <div
                  className={`mx-auto bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm ${
                    previewDevice === "mobile" ? "max-w-[280px]" : "w-full"
                  }`}
                  data-testid="preview-card"
                >
                  {/* Header */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 inline-flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                      {(selectedClient?.name || "GB").split(/\s+/).slice(0, 2).map((s: string) => s[0]).join("").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900 truncate">
                        {selectedClient?.name || "Your business"}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Posted just now · Update
                      </p>
                    </div>
                  </div>
                  {/* Hero photo */}
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="Post hero"
                      className="w-full h-40 object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-40 bg-gray-100 inline-flex items-center justify-center">
                      <div className="text-gray-500 text-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 140 96"
                          className="w-24 h-16 mx-auto"
                          aria-hidden="true"
                        >
                          {/* Ground line */}
                          <line x1="14" y1="84" x2="126" y2="84" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />

                          {/* Back foot (behind body) */}
                          <ellipse cx="40" cy="80" rx="9" ry="5" fill="#9ca3af" />
                          {/* Front foot (behind body) */}
                          <ellipse cx="92" cy="80" rx="9" ry="5" fill="#9ca3af" />

                          {/* Tail */}
                          <path d="M28 64 Q18 64 14 70 Q22 66 28 70 Z" fill="#9ca3af" />

                          {/* Body (under shell) */}
                          <ellipse cx="66" cy="68" rx="38" ry="10" fill="#9ca3af" />

                          {/* Neck + Head */}
                          <path d="M100 64 Q112 60 118 52 Q124 50 124 56 Q124 64 116 68 Q108 70 100 70 Z" fill="#9ca3af" />
                          {/* Eye */}
                          <circle cx="120" cy="55" r="1.6" fill="#1f2937" />
                          {/* Mouth */}
                          <path d="M122 60 L126 60" stroke="#1f2937" strokeWidth="1.2" strokeLinecap="round" />

                          {/* Shell — domed */}
                          <path d="M30 64 Q66 12 102 64 Z" fill="#6b7280" stroke="#374151" strokeWidth="1.6" strokeLinejoin="round" />
                          {/* Shell rim highlight */}
                          <path d="M30 64 L102 64" stroke="#374151" strokeWidth="1.6" strokeLinecap="round" />

                          {/* Shell plates — hexagonal pattern */}
                          <g stroke="#374151" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.85">
                            {/* center top hex */}
                            <polygon points="66,28 76,34 76,46 66,52 56,46 56,34" />
                            {/* left side plates */}
                            <path d="M56 34 L46 38 L42 50 L52 56 L56 46" />
                            <path d="M46 38 L34 56 L52 56" />
                            {/* right side plates */}
                            <path d="M76 34 L86 38 L90 50 L80 56 L76 46" />
                            <path d="M86 38 L98 56 L80 56" />
                            {/* lower row connecting to rim */}
                            <path d="M52 56 L48 64" />
                            <path d="M66 52 L66 64" />
                            <path d="M80 56 L84 64" />
                          </g>
                        </svg>
                        <p className="text-[11px] mt-2 text-gray-400">No image</p>
                      </div>
                    </div>
                  )}
                  {/* Description */}
                  <div className="px-3 py-3">
                    <p className="text-[12px] text-gray-800 leading-relaxed line-clamp-4 min-h-[3.5rem]">
                      {postDescription || "Your post description will appear here."}
                    </p>
                    {buttonUrl && (
                      <button className="mt-3 text-[12px] text-orange-700 font-semibold hover:underline" tabIndex={-1}>
                        {ctaLabelMap[buttonType] || "Learn more"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Pre-flight checks */}
                <div className="border border-gray-200 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-2">
                    Pre-flight checks
                  </p>
                  <ul className="space-y-1.5">
                    {preflightChecks.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]" data-testid={`preflight-${i}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                          c.ok === "good" ? "bg-emerald-500"
                          : c.ok === "warn" ? "bg-amber-500"
                          : "bg-blue-400"
                        }`} />
                        <span className={c.ok === "good" ? "text-gray-700" : c.ok === "warn" ? "text-amber-800" : "text-gray-500"}>
                          {c.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* UTM Builder - Full Width */}
          <Card ref={utmSectionRef} className="border-gray-200 shadow-sm rounded-2xl scroll-mt-4">
            <CardHeader className="pb-3 pt-5 px-5">
              <h2 className="text-[15px] font-semibold text-gray-900 inline-flex items-center gap-2">
                <Link className="w-4 h-4 text-gray-500" />
                UTM Builder
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Create trackable campaign URLs for your post button
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                      Website URL *
                    </label>
                    <Input
                      placeholder="https://example.com"
                      value={utmBaseUrl}
                      onChange={(e) => setUtmBaseUrl(e.target.value)}
                      data-testid="input-utm-base-url"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Campaign Source *
                      </label>
                      <Input
                        placeholder="google"
                        value={utmSource}
                        onChange={(e) => setUtmSource(e.target.value)}
                        data-testid="input-utm-source"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        e.g., google, facebook, newsletter
                      </p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Campaign Medium *
                      </label>
                      <Input
                        placeholder="cpc"
                        value={utmMedium}
                        onChange={(e) => setUtmMedium(e.target.value)}
                        data-testid="input-utm-medium"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        e.g., cpc, email, social
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                      Campaign Name *
                    </label>
                    <Input
                      placeholder="spring_sale"
                      value={utmCampaign}
                      onChange={(e) => setUtmCampaign(e.target.value)}
                      data-testid="input-utm-campaign"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      e.g., spring_sale, product_launch
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Campaign Term
                        <span className="text-gray-400 ml-1">(optional)</span>
                      </label>
                      <Input
                        placeholder="running+shoes"
                        value={utmTerm}
                        onChange={(e) => setUtmTerm(e.target.value)}
                        data-testid="input-utm-term"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Campaign Content
                        <span className="text-gray-400 ml-1">(optional)</span>
                      </label>
                      <Input
                        placeholder="logolink"
                        value={utmContent}
                        onChange={(e) => setUtmContent(e.target.value)}
                        data-testid="input-utm-content"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column - Output */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                      Generated UTM URL
                    </label>
                    <div className="relative">
                      <Textarea
                        value={generateUtmUrl()}
                        readOnly
                        rows={6}
                        className="pr-12 bg-gray-50 dark:bg-gray-800 font-mono text-sm"
                        placeholder="Your UTM URL will appear here..."
                        data-testid="textarea-utm-output"
                      />
                      {generateUtmUrl() && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2"
                          onClick={handleCopyUtmUrl}
                          data-testid="button-copy-utm"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                      📊 Track Your Campaigns
                    </h4>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      Use these UTM parameters in your post button URLs to track campaign performance in Google Analytics.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scheduled Posts Section */}
          {scheduledPosts.length > 0 && (
            <Card className="border-amber-200 shadow-sm rounded-2xl bg-amber-50/40">
              <CardHeader className="pb-3 pt-5 px-5">
                <h2 className="text-[15px] font-semibold text-gray-900 inline-flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  Scheduled posts
                  <span className="bg-amber-100 text-amber-700 text-[11px] font-semibold px-1.5 min-w-[20px] h-5 inline-flex items-center justify-center rounded-full">
                    {scheduledPosts.length}
                  </span>
                </h2>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {scheduledPosts.map((scheduledPost) => {
                    const firstItem = scheduledPost.items?.[0];
                    const payload = firstItem?.payload as any;
                    const postData = payload?.postData;
                    const imageUrl = postData?.media?.[0]?.sourceUrl;
                    const localSchedule = scheduledPost.scheduledDate && scheduledPost.scheduledTime 
                      ? formatScheduledTimeLocal(scheduledPost.scheduledDate, scheduledPost.scheduledTime)
                      : null;
                    
                    return (
                      <div
                        key={scheduledPost.id}
                        className="border border-amber-300 dark:border-amber-700 rounded-lg p-4 bg-white dark:bg-gray-900 hover:border-amber-500 transition-colors cursor-pointer"
                        data-testid={`scheduled-post-${scheduledPost.id}`}
                        onClick={() => setSelectedScheduledPost(scheduledPost)}
                      >
                        <div className="flex items-start gap-4">
                          {imageUrl && (
                            <img
                              src={imageUrl}
                              alt="Scheduled post preview"
                              className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                <Clock className="w-3 h-3 mr-1" />
                                Scheduled
                              </Badge>
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {localSchedule ? `${localSchedule.date} at ${localSchedule.time}` : 'Unknown'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-2 mb-2">
                              {postData?.summary || 'No description'}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <span>{scheduledPost.items?.length || 0} location(s)</span>
                              {postData?.callToAction && (
                                <>
                                  <span>•</span>
                                  <span>{postData.callToAction.actionType?.replace('_', ' ')}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPostToCancel(scheduledPost);
                              setCancelDialogOpen(true);
                            }}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            data-testid={`button-cancel-scheduled-${scheduledPost.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bottom Row: Recent Posts - Full Width */}
          <Card className="border-gray-200 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 pt-5 px-5">
              <h2 className="text-[15px] font-semibold text-gray-900 inline-flex items-center gap-2">
                <History className="w-4 h-4 text-gray-500" />
                Recent posts
              </h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {posts.length > 0 ? (
                  <>
                    {posts.slice(0, showAllPosts ? posts.length : 4).map((post) => (
                      <div 
                        key={post.id} 
                        className={`border rounded-lg p-4 transition-colors cursor-pointer ${
                          post.status === 'deleted' 
                            ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 opacity-75' 
                            : 'border-gray-200 dark:border-gray-700 hover:border-orange-500'
                        }`}
                        data-testid={`recent-post-${post.id}`}
                        onClick={() => setSelectedPost(post)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            {post.locationName && (
                              <p className={`text-sm font-medium mb-2 ${post.status === 'deleted' ? 'text-gray-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                📍 {post.locationName}
                              </p>
                            )}
                            <p className={`text-sm ${post.status === 'deleted' ? 'text-gray-400' : 'text-gray-600 dark:text-gray-400'}`}>
                              {post.summary 
                                ? post.summary.length > 150 
                                  ? `${post.summary.slice(0, 150)}... ` 
                                  : post.summary
                                : 'No description'}
                              {post.summary && post.summary.length > 150 && (
                                <span className="text-orange-600 dark:text-orange-400 font-medium">Read more</span>
                              )}
                            </p>
                          </div>
                          {post.status !== 'deleted' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(post);
                              }}
                              disabled={deletePostMutation.isPending}
                              className="ml-2 h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              data-testid={`button-delete-post-${post.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-3">
                          {post.status === 'deleted' ? (
                            <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              Deleted
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              Published
                            </Badge>
                          )}
                          <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                    
                    {posts.length > 4 && (
                      <Button
                        variant="ghost"
                        className="w-full text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                        onClick={() => setShowAllPosts(!showAllPosts)}
                        data-testid="button-toggle-posts"
                      >
                        {showAllPosts ? (
                          <>
                            <ChevronUp className="w-4 h-4 mr-2" />
                            Show Less
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4 mr-2" />
                            Show {posts.length - 4} More
                          </>
                        )}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <p>No recent posts</p>
                    <p className="text-sm mt-1">Create your first post to get started</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Post Details Dialog */}
      <Dialog open={!!selectedPost} onOpenChange={() => { setSelectedPost(null); setShowFullDesc(false); }}>
        <DialogContent className="max-w-xl p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Post Details</DialogTitle>
            <DialogDescription>View the complete details of this post</DialogDescription>
          </DialogHeader>
          {selectedPost && (
            <div className="flex flex-col">
              {/* Image */}
              {selectedPost.media && selectedPost.media.length > 0 && (() => {
                const imageUrl = selectedPost.media[0]?.googleUrl || selectedPost.media[0]?.sourceUrl;
                return imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Post media"
                    className="w-full h-56 object-cover"
                  />
                ) : null;
              })()}

              {/* Location strip */}
              {selectedPost.locationName && (
                <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-orange-500 text-sm flex-shrink-0">📍</span>
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{selectedPost.locationName}</span>
                    {selectedPost.locationAddress && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">· {selectedPost.locationAddress}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="px-5 py-4 bg-white dark:bg-gray-900">
                <div className={showFullDesc ? "max-h-60 overflow-y-auto pr-1" : ""}>
                  <p
                    ref={descRef}
                    className={`text-sm text-gray-800 dark:text-gray-200 leading-relaxed ${showFullDesc ? "" : "line-clamp-5"}`}
                  >
                    {selectedPost.summary || 'No description'}
                  </p>
                </div>
                {isDescClamped && (
                  <button
                    onClick={() => setShowFullDesc(v => !v)}
                    className="mt-1.5 text-xs font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 transition-colors"
                  >
                    {showFullDesc ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>

              {/* Footer: date + button */}
              <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-3">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  {new Date(selectedPost.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>

                {selectedPost.callToAction && (
                  <a
                    href={selectedPost.callToAction.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center bg-gray-900 dark:bg-gray-100 rounded-lg py-3 text-sm font-bold tracking-wide text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
                  >
                    {selectedPost.callToAction.actionType?.replace(/_/g, ' ') || 'LEARN MORE'}
                  </a>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Confirmation Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {previewPostData?.isScheduled ? 'Schedule Your Post' : 'Preview Your Post'}
            </DialogTitle>
            <DialogDescription>
              {previewPostData?.isScheduled
                ? 'Review your post before scheduling it to Google Business Profile'
                : 'Review your post before publishing to Google Business Profile'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Preview Card */}
            <div className="border-2 border-gray-200 dark:border-gray-700 rounded-xl p-6 bg-gray-50 dark:bg-gray-800/50">
              {previewPostData?.imageUrl && (
                <div className="mb-4">
                  <img 
                    src={previewPostData.imageUrl} 
                    alt="Post preview" 
                    className="w-full h-64 object-cover rounded-lg"
                  />
                </div>
              )}
              
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 mb-2">Description</h3>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {previewPostData?.postData?.summary}
                  </p>
                </div>
                
                <div className="pt-3 border-t border-gray-300 dark:border-gray-600">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-2">Call to Action</h3>
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg font-medium">
                    {previewPostData?.postData?.callToAction?.actionType.replace('_', ' ')}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Links to: {previewPostData?.postData?.callToAction?.url}
                  </p>
                </div>
              </div>
            </div>

            {/* Scheduled Date/Time Banner */}
            {previewPostData?.isScheduled && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center gap-3">
                <div className="text-amber-600 dark:text-amber-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Scheduled for</p>
                  <p className="text-sm text-amber-800 dark:text-amber-400">
                    {(() => {
                      const [y, m, d] = previewPostData.scheduledDate.split('-');
                      const [h, min] = previewPostData.scheduledTime.split(':');
                      const dt = new Date(+y, +m - 1, +d, +h, +min);
                      return new Intl.DateTimeFormat('en-US', {
                        month: 'long', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
                      }).format(dt);
                    })()}
                  </p>
                </div>
              </div>
            )}

            {/* Locations Info */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
                {previewPostData?.isScheduled ? 'Scheduling to' : 'Publishing to'} {previewPostData?.locationIds?.length} location{previewPostData?.locationIds?.length !== 1 ? 's' : ''}:
              </p>
              <div className="flex flex-wrap gap-2">
                {(showAllPreviewLocations
                  ? previewPostData?.locationIds
                  : previewPostData?.locationIds?.slice(0, 3)
                )?.map((locId: string) => {
                  const location = locations.find(l => l.id === locId);
                  return location ? (
                    <Badge key={locId} variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                      {location.name}
                    </Badge>
                  ) : null;
                })}
              </div>
              {previewPostData?.locationIds?.length > 3 && (
                <button
                  onClick={() => setShowAllPreviewLocations(v => !v)}
                  className="mt-2 text-xs text-blue-700 dark:text-blue-400 hover:underline"
                  data-testid="button-toggle-preview-locations"
                >
                  {showAllPreviewLocations
                    ? "Show less"
                    : `See all ${previewPostData.locationIds.length} locations`}
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPreviewDialog(false);
                  setPreviewPostData(null);
                }}
                className="flex-1"
                data-testid="button-cancel-preview"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmPublish}
                disabled={createPostMutation.isPending}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                data-testid="button-confirm-publish"
              >
                {createPostMutation.isPending
                  ? (previewPostData?.isScheduled ? 'Scheduling...' : 'Publishing...')
                  : (previewPostData?.isScheduled ? 'Confirm & Schedule' : 'Confirm & Publish')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post? This will remove it from Google Business Profile and cannot be undone.
              {postToDelete && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-900">
                    "{postToDelete.summary?.substring(0, 100)}{postToDelete.summary && postToDelete.summary.length > 100 ? '...' : ''}"
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              {deletePostMutation.isPending ? 'Deleting...' : 'Delete Post'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Scheduled Post Details Dialog */}
      <Dialog open={!!selectedScheduledPost} onOpenChange={() => setSelectedScheduledPost(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              Scheduled Post Details
            </DialogTitle>
            <DialogDescription>
              This post is scheduled to go live at the time below
            </DialogDescription>
          </DialogHeader>
          {selectedScheduledPost && (() => {
            const firstItem = selectedScheduledPost.items?.[0];
            const payload = firstItem?.payload as any;
            const postData = payload?.postData;
            const imageUrl = postData?.media?.[0]?.sourceUrl;
            const localSchedule = selectedScheduledPost.scheduledDate && selectedScheduledPost.scheduledTime
              ? formatScheduledTimeLocal(selectedScheduledPost.scheduledDate, selectedScheduledPost.scheduledTime)
              : null;
            
            return (
              <div className="space-y-6 pb-4">
                {/* Scheduled Time */}
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-amber-900 dark:text-amber-300 mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Scheduled For
                  </h3>
                  <p className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                    {localSchedule ? `${localSchedule.date} at ${localSchedule.time}` : 'Unknown'}
                  </p>
                </div>

                {/* Image Preview */}
                {imageUrl && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Image</h3>
                    <img 
                      src={imageUrl} 
                      alt="Scheduled post" 
                      className="w-full max-h-64 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                    <p className="text-xs text-gray-500 mt-1 break-all">{imageUrl}</p>
                  </div>
                )}

                {/* Description */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</h3>
                  <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                    {postData?.summary || 'No description'}
                  </p>
                </div>

                {/* Call to Action */}
                {postData?.callToAction && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Button</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Type:</span>
                        <Badge variant="secondary">{postData.callToAction.actionType?.replace('_', ' ') || 'N/A'}</Badge>
                      </div>
                      {postData.callToAction.url && (
                        <div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">URL: </span>
                          <a 
                            href={postData.callToAction.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-orange-600 hover:text-orange-700 underline break-all text-sm"
                          >
                            {postData.callToAction.url}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Target Locations */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Target Locations ({selectedScheduledPost.items?.length || 0})
                  </h3>
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedScheduledPost.items?.map((item: any) => (
                        <Badge 
                          key={item.id} 
                          variant="secondary" 
                          className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
                        >
                          {item.locationName || (item.payload as any)?.locationTitle || 'Unknown'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedScheduledPost(null)}
                    className="flex-1"
                    data-testid="button-close-scheduled-details"
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setPostToCancel(selectedScheduledPost);
                      setCancelDialogOpen(true);
                    }}
                    className="flex-1"
                    data-testid="button-cancel-from-details"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Cancel Scheduled Post
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Cancel Scheduled Post Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Scheduled Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this scheduled post? This action cannot be undone and the post will not be published.
              {postToCancel && (() => {
                const localSchedule = postToCancel.scheduledDate && postToCancel.scheduledTime
                  ? formatScheduledTimeLocal(postToCancel.scheduledDate, postToCancel.scheduledTime)
                  : null;
                return (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                      Scheduled for: {localSchedule ? `${localSchedule.date} at ${localSchedule.time}` : 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {postToCancel.items?.length || 0} location(s)
                    </p>
                  </div>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog-close">Keep Scheduled</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => postToCancel && cancelScheduledPostMutation.mutate(postToCancel.id)}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-cancel-scheduled"
            >
              {cancelScheduledPostMutation.isPending ? 'Cancelling...' : 'Cancel Post'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
