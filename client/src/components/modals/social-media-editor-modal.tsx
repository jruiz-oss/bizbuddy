import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getApiUrl } from "@/lib/queryClient";
import { Loader2, MapPin, Share2 } from "lucide-react";
import { SiX, SiFacebook, SiInstagram, SiYoutube, SiLinkedin, SiTiktok, SiPinterest } from "react-icons/si";
import type { ClientLocation, LocationFolder } from "@shared/schema";

interface SocialMediaEditorModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  selectedLocationIds: string[];
}

interface SocialMediaUrls {
  twitter: string;
  facebook: string;
  instagram: string;
  youtube: string;
  linkedin: string;
  tiktok: string;
  pinterest: string;
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

export function SocialMediaEditorModal({ open, onClose, clientId, selectedLocationIds: initialSelectedIds }: SocialMediaEditorModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [socialMedia, setSocialMedia] = useState<SocialMediaUrls>({
    twitter: '',
    facebook: '',
    instagram: '',
    youtube: '',
    linkedin: '',
    tiktok: '',
    pinterest: '',
  });

  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [folderFilter, setFolderFilter] = useState<string>("all");

  const { data: allLocations = [], isLoading: isLoadingLocations } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", clientId, "locations"],
    enabled: !!clientId && open,
  });

  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
    enabled: open,
  });

  const { data: folderLocations = [], isLoading: isFolderLocationsLoading } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/folders/${folderFilter}/locations`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch folder locations");
      return response.json();
    },
    enabled: folderFilter !== "all" && open,
  });

  const displayedLocations = folderFilter === "all" 
    ? allLocations 
    : allLocations.filter(location => folderLocations.some(fl => fl.id === location.id));

  useEffect(() => {
    if (open) {
      setSelectedLocationIds(new Set(initialSelectedIds));
      setFolderFilter("all");
      setSocialMedia({
        twitter: '',
        facebook: '',
        instagram: '',
        youtube: '',
        linkedin: '',
        tiktok: '',
        pinterest: '',
      });
    }
  }, [open, initialSelectedIds]);

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(locationId)) {
        newSet.delete(locationId);
      } else {
        newSet.add(locationId);
      }
      return newSet;
    });
  };

  const selectAllDisplayed = () => {
    const newSet = new Set(selectedLocationIds);
    displayedLocations.forEach(loc => newSet.add(loc.id));
    setSelectedLocationIds(newSet);
  };

  const deselectAllDisplayed = () => {
    const displayedIds = new Set(displayedLocations.map(loc => loc.id));
    const newSet = new Set(Array.from(selectedLocationIds).filter(id => !displayedIds.has(id)));
    setSelectedLocationIds(newSet);
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async (data: { locationIds: string[]; socialMedia: Partial<SocialMediaUrls> }) => {
      console.log('📱 [v2] Sending social media update request:', data);
      const res = await apiRequest('POST', '/api/locations/bulk/social-media', data);
      const jsonResponse = await res.json();
      console.log('📱 [v2] Received social media response:', jsonResponse);
      return jsonResponse;
    },
    onSuccess: (response: { success: boolean; count: number; googleUpdatedCount?: number }, variables) => {
      console.log('📱 [v2] onSuccess - response:', response, 'variables:', variables);
      const count = variables.locationIds.length;
      const googleCount = response?.googleUpdatedCount ?? 0;
      
      let description = `Updated ${count} location${count !== 1 ? 's' : ''}`;
      if (googleCount > 0) {
        description += ` (${googleCount} synced to Google)`;
      }
      
      toast({
        title: "Social media updated",
        description,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "locations"] });
      handleClose();
    },
    onError: (error: any) => {
      console.log('📱 [v2] onError:', error);
      toast({
        title: "Failed to update social media",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const updateSocialMedia = (platform: keyof SocialMediaUrls, value: string) => {
    setSocialMedia(prev => ({
      ...prev,
      [platform]: value
    }));
  };

  const handleSubmit = () => {
    if (selectedLocationIds.size === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    const filledSocialMedia: Partial<SocialMediaUrls> = {};
    Object.entries(socialMedia).forEach(([key, value]) => {
      if (value.trim() !== '') {
        filledSocialMedia[key as keyof SocialMediaUrls] = value.trim();
      }
    });

    if (Object.keys(filledSocialMedia).length === 0) {
      toast({
        title: "No social media URLs provided",
        description: "Please enter at least one social media URL",
        variant: "destructive",
      });
      return;
    }

    bulkUpdateMutation.mutate({
      locationIds: Array.from(selectedLocationIds),
      socialMedia: filledSocialMedia,
    });
  };

  const handleClose = () => {
    setSelectedLocationIds(new Set(initialSelectedIds));
    setFolderFilter("all");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Edit Social Media
          </DialogTitle>
          <DialogDescription>
            Set social media URLs that will be applied to {selectedLocationIds.size} selected location{selectedLocationIds.size !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Target Locations *</Label>
            
            <div className="flex items-center gap-2">
              <Select value={folderFilter} onValueChange={setFolderFilter}>
                <SelectTrigger className="w-full" data-testid="select-folder-filter-social">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="select-item-folder-all">All Locations</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id} data-testid={`select-item-folder-${folder.id}`}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {displayedLocations.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllDisplayed}
                    data-testid="button-select-all-social"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deselectAllDisplayed}
                    data-testid="button-deselect-all-social"
                  >
                    Deselect All
                  </Button>
                </div>
              )}
            </div>

            {isLoadingLocations || (isFolderLocationsLoading && folderFilter !== "all") ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-4 space-y-2">
                  {displayedLocations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No locations found</p>
                    </div>
                  ) : (
                    displayedLocations.map((location) => (
                      <div
                        key={location.id}
                        className="flex items-center space-x-3 p-2 hover:bg-muted rounded-md"
                      >
                        <Checkbox
                          checked={selectedLocationIds.has(location.id)}
                          onCheckedChange={() => toggleLocation(location.id)}
                          data-testid={`checkbox-social-location-${location.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{location.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {location.city || location.address || 'No address'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
            <p className="text-xs text-muted-foreground" data-testid="text-selected-count-social">
              {selectedLocationIds.size} location{selectedLocationIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>

          <div className="space-y-4">
            <Label className="text-sm font-medium">Social Media URLs</Label>
            <p className="text-xs text-muted-foreground" data-testid="text-social-instructions">
              Enter the URLs you want to apply. Only filled fields will be updated. Leave a field empty to skip it.
            </p>
            <div className="space-y-3">
              {SOCIAL_PLATFORMS.map((platform) => {
                const Icon = platform.icon;
                return (
                  <div key={platform.key} className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-muted">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder={platform.placeholder}
                        value={socialMedia[platform.key as keyof SocialMediaUrls]}
                        onChange={(e) => updateSocialMedia(platform.key as keyof SocialMediaUrls, e.target.value)}
                        data-testid={`input-social-${platform.key}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-muted/30">
            <Label className="text-sm font-medium mb-3 block">Preview</Label>
            <div className="space-y-1">
              {SOCIAL_PLATFORMS.map((platform) => {
                const value = socialMedia[platform.key as keyof SocialMediaUrls];
                if (!value) return null;
                const Icon = platform.icon;
                return (
                  <div key={platform.key} className="flex items-center gap-2 text-sm">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{platform.label}:</span>
                    <span className="text-muted-foreground truncate">{value}</span>
                  </div>
                );
              })}
              {Object.values(socialMedia).every(v => !v) && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-social-preview">No social media URLs entered yet</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={bulkUpdateMutation.isPending} data-testid="button-cancel-social">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={bulkUpdateMutation.isPending}
            data-testid="button-apply-social"
          >
            {bulkUpdateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 mr-2" />
                Apply to {selectedLocationIds.size} Location{selectedLocationIds.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
