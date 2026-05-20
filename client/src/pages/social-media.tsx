import { SideNav } from "@/components/SideNav";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Share2, Search, Folder, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SiX, SiFacebook, SiInstagram, SiYoutube, SiLinkedin, SiTiktok, SiPinterest } from "react-icons/si";
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
import type { Client, ClientLocation, LocationFolder, LocationTag } from "@shared/schema";

interface SocialMediaProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

interface SocialMediaUrls {
  twitter?: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
  linkedin?: string;
  tiktok?: string;
  pinterest?: string;
}

const SOCIAL_PLATFORMS = [
  { key: 'twitter', label: 'X (Twitter)', icon: SiX, placeholder: 'https://twitter.com/yourhandle' },
  { key: 'facebook', label: 'Facebook', icon: SiFacebook, placeholder: 'https://facebook.com/yourpage' },
  { key: 'instagram', label: 'Instagram', icon: SiInstagram, placeholder: 'https://instagram.com/yourhandle' },
  { key: 'youtube', label: 'YouTube', icon: SiYoutube, placeholder: 'https://youtube.com/@yourchannel' },
  { key: 'linkedin', label: 'LinkedIn', icon: SiLinkedin, placeholder: 'https://linkedin.com/company/yourcompany' },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok, placeholder: 'https://tiktok.com/@yourhandle' },
  { key: 'pinterest', label: 'Pinterest', icon: SiPinterest, placeholder: 'https://pinterest.com/yourprofile' },
] as const;

const SOCIAL_ICONS: Record<string, any> = {
  twitter: SiX,
  facebook: SiFacebook,
  instagram: SiInstagram,
  youtube: SiYoutube,
  linkedin: SiLinkedin,
  tiktok: SiTiktok,
  pinterest: SiPinterest,
};

export default function SocialMedia({ selectedClientId, setSelectedClientId }: SocialMediaProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [socialMedia, setSocialMedia] = useState<SocialMediaUrls>({
    twitter: '',
    facebook: '',
    instagram: '',
    youtube: '',
    linkedin: '',
    tiktok: '',
    pinterest: '',
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
  });

  const { data: folderLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    enabled: folderFilter !== "all",
  });

  const { data: tags = [] } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
  });

  const { data: tagLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/tags", tagFilter, "locations"],
    enabled: tagFilter !== "all",
  });

  const selectedClient = clients.find(c => c.id === selectedClientId);

  const displayLocations = (() => {
    let result = locations;
    if (folderFilter !== "all") {
      const folderLocationIds = new Set(folderLocations.map(l => l.id));
      result = result.filter(l => folderLocationIds.has(l.id));
    }
    if (tagFilter !== "all") {
      const tagLocationIds = new Set(tagLocations.map(l => l.id));
      result = result.filter(l => tagLocationIds.has(l.id));
    }
    return result;
  })();

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

  const handleLocationToggle = (locationId: string) => {
    setSelectedLocations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(locationId)) {
        newSet.delete(locationId);
      } else {
        newSet.add(locationId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allIds = new Set(filteredLocations.map(l => l.id));
    setSelectedLocations(allIds);
  };

  const handleDeselectAll = () => {
    setSelectedLocations(new Set());
  };

  const handleSelectAllInFolder = () => {
    if (folderFilter !== "all") {
      const allFolderLocationIds = displayLocations.map(loc => loc.id);
      setSelectedLocations(new Set(allFolderLocationIds));
    }
  };

  const updateSocialMedia = (platform: string, value: string) => {
    setSocialMedia(prev => ({
      ...prev,
      [platform]: value
    }));
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async (data: { locationIds: string[]; socialMedia: Partial<SocialMediaUrls> }) => {
      console.log('📱 [social-media page] Sending bulk update:', data);
      const res = await apiRequest('POST', '/api/locations/bulk/social-media', data);
      const jsonResponse = await res.json();
      console.log('📱 [social-media page] Response:', jsonResponse);
      return jsonResponse;
    },
    onSuccess: (response: { success: boolean; count: number; googleUpdatedCount?: number; results?: { googleUpdated: boolean }[] }, variables) => {
      console.log('📱 [social-media page] onSuccess - response:', response, 'variables:', variables);
      const count = variables.locationIds.length;
      const googleCount = response?.googleUpdatedCount ?? 0;

      // Always invalidate and reset form regardless of outcome
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedLocations(new Set());
      setSocialMedia({ twitter: '', facebook: '', instagram: '', youtube: '', linkedin: '', tiktok: '', pinterest: '' });

      // Partial failure — some locations didn't sync to Google
      if (googleCount < count) {
        const failed = count - googleCount;
        showApiError(
          "Partial Sync to Google",
          `${failed} of ${count} location${count !== 1 ? 's' : ''} failed to sync to Google — some social media platforms may not be supported for that location type, or the request timed out. Please try again or contact support.`
        );
        return;
      }

      // Full success
      toast({
        title: "Social media updated",
        description: `${googleCount} location${googleCount !== 1 ? 's' : ''} synced to Google.`,
      });
    },
    onError: (error: any) => {
      showApiError("Failed to Update Social Media", parseApiError(error, "Something went wrong. Please check your connection and try again."));
    },
  });

  const handleUpdateClick = () => {
    if (selectedLocations.size === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    const filledFields = Object.entries(socialMedia).filter(([_, value]) => value && value.trim() !== '');
    if (filledFields.length === 0) {
      toast({
        title: "No social media URLs provided",
        description: "Please enter at least one social media URL",
        variant: "destructive",
      });
      return;
    }

    setShowConfirmDialog(true);
  };

  const handleConfirmUpdate = () => {
    const filledSocialMedia: Partial<SocialMediaUrls> = {};
    Object.entries(socialMedia).forEach(([key, value]) => {
      if (value && value.trim() !== '') {
        filledSocialMedia[key as keyof SocialMediaUrls] = value.trim();
      }
    });

    bulkUpdateMutation.mutate({
      locationIds: Array.from(selectedLocations),
      socialMedia: filledSocialMedia,
    });
    setShowConfirmDialog(false);
  };

  const getSocialMediaCount = (location: ClientLocation): number => {
    const sm = location.socialMedia as SocialMediaUrls | null;
    if (!sm) return 0;
    return Object.values(sm).filter(Boolean).length;
  };

  const getSocialMediaIcons = (location: ClientLocation) => {
    const sm = location.socialMedia as SocialMediaUrls | null;
    if (!sm) return null;
    
    const platforms = Object.entries(sm).filter(([_, url]) => url);
    if (platforms.length === 0) return null;

    return (
      <div className="flex items-center gap-1">
        {platforms.map(([platform, url]) => {
          const Icon = SOCIAL_ICONS[platform];
          if (!Icon) return null;
          return (
            <a
              key={platform}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 hover:bg-gray-100 rounded"
              onClick={(e) => e.stopPropagation()}
              title={platform}
              data-testid={`link-social-${platform}-${location.id}`}
            >
              <Icon className="w-4 h-4 text-gray-500 hover:text-gray-700" />
            </a>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />

      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">
          {/* Header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">SOCIAL</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">Social Media</h1>
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
                    const socialCount = getSocialMediaCount(location);
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
                          <p className={`text-[13px] truncate ${checked ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`} data-testid={`text-location-name-${location.id}`}>{location.name}</p>
                          {location.address && <p className="text-[11px] text-gray-500 truncate" data-testid={`text-location-address-${location.id}`}>{location.address}</p>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {getSocialMediaIcons(location)}
                          {socialCount > 0 && (
                            <span className="text-[10px] text-cyan-600 font-medium" data-testid={`badge-social-count-${location.id}`}>{socialCount}</span>
                          )}
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

            {/* Social Media Editor */}
            <Card className="col-span-12 lg:col-span-8 border-gray-200 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 font-medium text-[15px]">2.</span>
                  <h2 className="text-[15px] font-semibold text-gray-900">Social Media URLs</h2>
                </div>
                <p className="text-[12px] text-gray-500 mt-1 ml-5">Enter the URLs to apply to selected locations. Only filled fields will be updated.</p>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <div className="space-y-4">
                  {SOCIAL_PLATFORMS.map((platform) => {
                    const Icon = platform.icon;
                    return (
                      <div key={platform.key} className="flex items-center gap-4">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <Label className="text-sm font-medium mb-1 block">{platform.label}</Label>
                          <Input
                            placeholder={platform.placeholder}
                            value={socialMedia[platform.key as keyof SocialMediaUrls] || ''}
                            onChange={(e) => updateSocialMedia(platform.key, e.target.value)}
                            data-testid={`input-social-${platform.key}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={handleUpdateClick}
                    disabled={selectedLocations.size === 0 || bulkUpdateMutation.isPending}
                    data-testid="button-update-social"
                  >
                    {bulkUpdateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4 mr-2" />
                        Update {selectedLocations.size} Location{selectedLocations.size !== 1 ? 's' : ''}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Update</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to update social media URLs for {selectedLocations.size} location{selectedLocations.size !== 1 ? 's' : ''}. 
              This will add or update the following links:
              <ul className="mt-2 space-y-1">
                {Object.entries(socialMedia)
                  .filter(([_, value]) => value && value.trim() !== '')
                  .map(([key, value]) => {
                    const platform = SOCIAL_PLATFORMS.find(p => p.key === key);
                    return (
                      <li key={key} className="text-sm">
                        <strong>{platform?.label || key}:</strong> {value}
                      </li>
                    );
                  })}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUpdate} data-testid="button-confirm-update">
              Confirm Update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
