import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useJobProgressContext } from "@/contexts/job-progress-context";
import { Upload, MessageSquare, Eye, Loader2, MapPin } from "lucide-react";
import type { ClientLocation, LocationFolder, LocationTag } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

interface PostCreationModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  selectedLocationIds: string[];
}

export function PostCreationModal({ open, onClose, clientId, selectedLocationIds: initialSelectedIds }: PostCreationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { startJobProgress } = useJobProgressContext();

  const [description, setDescription] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [buttonType, setButtonType] = useState("LEARN_MORE");
  const [imageUrl, setImageUrl] = useState("");
  const [imageValidation, setImageValidation] = useState<{ isValid: boolean; width?: number; height?: number; error?: string } | null>(null);
  const [isCheckingImage, setIsCheckingImage] = useState(false);
  
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  // Fetch all locations for this client
  const { data: allLocations = [], isLoading: isLoadingLocations } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", clientId, "locations"],
    enabled: !!clientId && open,
  });

  // Fetch folders
  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
    enabled: open,
  });

  // Fetch locations for selected folder
  const { data: folderLocations = [], isLoading: isFolderLocationsLoading } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(`/api/folders/${folderFilter}/locations`);
      if (!response.ok) throw new Error("Failed to fetch folder locations");
      return response.json();
    },
    enabled: folderFilter !== "all" && open,
  });

  // Fetch user's custom tags
  const { data: tags = [] } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  // Fetch locations for selected tag
  const { data: tagLocations = [], isLoading: isTagLocationsLoading } = useQuery<ClientLocation[]>({
    queryKey: ["/api/tags", tagFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(`/api/tags/${tagFilter}/locations`);
      if (!response.ok) throw new Error("Failed to fetch tag locations");
      return response.json();
    },
    enabled: tagFilter !== "all" && open,
  });

  // Filter locations based on folder and tag selection
  const folderFilteredLocations = folderFilter === "all" 
    ? allLocations 
    : allLocations.filter(location => folderLocations.some(fl => fl.id === location.id));
  
  const displayedLocations = tagFilter === "all"
    ? folderFilteredLocations
    : folderFilteredLocations.filter(location => tagLocations.some(tl => tl.id === location.id));

  // Reset selections when modal opens or initial selections change
  useEffect(() => {
    if (open) {
      setSelectedLocationIds(new Set(initialSelectedIds));
      setFolderFilter("all");
      setTagFilter("all");
    }
  }, [open, initialSelectedIds]);

  // Reconcile selections when filters change - remove selections not in displayedLocations
  // Guard: only run after data is loaded
  useEffect(() => {
    if (!open || isLoadingLocations || allLocations.length === 0) return;
    // Wait for tag locations to finish loading if a tag filter is selected
    if (tagFilter !== "all" && isTagLocationsLoading) return;
    // Wait for folder locations to finish loading if a folder filter is selected
    if (folderFilter !== "all" && isFolderLocationsLoading) return;
    
    const displayedIds = new Set(displayedLocations.map(l => l.id));
    const validSelections = Array.from(selectedLocationIds).filter(id => displayedIds.has(id));
    if (validSelections.length !== selectedLocationIds.size) {
      setSelectedLocationIds(new Set(validSelections));
    }
  }, [displayedLocations, open, isLoadingLocations, allLocations.length, tagFilter, isTagLocationsLoading, folderFilter, isFolderLocationsLoading]);

  // Validate image dimensions when URL changes
  useEffect(() => {
    if (!imageUrl.trim()) {
      setImageValidation(null);
      return;
    }

    // Check for HEIC/HEIF format
    const url = imageUrl.trim().toLowerCase();
    if (url.endsWith('.heic') || url.endsWith('.heif')) {
      setImageValidation({
        isValid: false,
        error: "HEIC/HEIF format not supported. Use JPG, PNG, or GIF."
      });
      return;
    }

    setIsCheckingImage(true);
    const img = new Image();
    
    img.onload = () => {
      const minSize = 250;
      const isValid = img.width >= minSize && img.height >= minSize;
      
      setImageValidation({
        isValid,
        width: img.width,
        height: img.height,
        error: isValid ? undefined : `Image too small (${img.width}×${img.height}px). Minimum required: 250×250px`
      });
      setIsCheckingImage(false);
    };

    img.onerror = () => {
      setImageValidation({
        isValid: false,
        error: "Could not load image. Check the URL."
      });
      setIsCheckingImage(false);
    };

    img.src = imageUrl.trim();
  }, [imageUrl]);

  const createPostJobMutation = useMutation({
    mutationFn: async (postData: any) => {
      const response = await apiRequest('POST', '/api/jobs/create-post', {
        clientId,
        locationIds: Array.from(selectedLocationIds),
        postData,
        imageUrl: imageUrl || undefined,
      });
      return await response.json();
    },
    onSuccess: (response: any) => {
      // Trigger global progress toast
      startJobProgress(response.id, "posts");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create post",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });


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

  const handleSubmit = () => {
    if (!description.trim()) {
      toast({
        title: "Missing required field",
        description: "Please provide a description for your post",
        variant: "destructive",
      });
      return;
    }

    if (!buttonUrl.trim()) {
      toast({
        title: "Missing button URL",
        description: "Please provide a URL for the button",
        variant: "destructive",
      });
      return;
    }

    if (selectedLocationIds.size === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    // Check if image validation failed
    if (imageUrl.trim() && imageValidation && !imageValidation.isValid) {
      toast({
        title: "Image validation failed",
        description: imageValidation.error || "Please fix the image issue before publishing",
        variant: "destructive",
      });
      return;
    }

    createPostJobMutation.mutate({
      summary: description.trim(),
      callToAction: {
        actionType: buttonType,
        url: buttonUrl.trim(),
      },
      topicType: "STANDARD",
    });
  };

  const handleClose = () => {
    setDescription("");
    setButtonUrl("");
    setButtonType("LEARN_MORE");
    setImageUrl("");
    setImageValidation(null);
    setIsCheckingImage(false);
    setSelectedLocationIds(new Set(initialSelectedIds));
    setFolderFilter("all");
    setTagFilter("all");
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Create Post
          </DialogTitle>
          <DialogDescription>
            Create a post that will be published to {selectedLocationIds.size} selected location{selectedLocationIds.size !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Target Locations Selector */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Target Locations *</Label>
            
            {/* Folder Filter */}
            <div className="flex items-center gap-2">
              <Select value={folderFilter} onValueChange={setFolderFilter}>
                <SelectTrigger className="w-full" data-testid="select-folder-filter">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
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
                    data-testid="button-select-all-locations"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deselectAllDisplayed}
                    data-testid="button-deselect-all-locations"
                  >
                    Deselect All
                  </Button>
                </div>
              )}
            </div>

            {/* Tag Filter */}
            {tags.length > 0 && (
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-sm font-medium text-gray-600">Tags:</span>
                <Badge
                  variant={tagFilter === 'all' ? 'default' : 'secondary'}
                  className={`cursor-pointer ${tagFilter === 'all' ? 'bg-gray-900 text-white' : ''}`}
                  onClick={() => setTagFilter('all')}
                  data-testid="badge-tag-filter-all"
                >
                  All
                </Badge>
                {tags.map(tag => (
                  <Badge
                    key={tag.id}
                    variant={tagFilter === tag.id ? 'default' : 'secondary'}
                    className="cursor-pointer"
                    style={tagFilter === tag.id ? { backgroundColor: tag.color || '#6366f1', color: 'white' } : {}}
                    onClick={() => setTagFilter(tag.id)}
                    data-testid={`badge-tag-filter-${tag.id}`}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* Location List */}
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
                          data-testid={`checkbox-location-${location.id}`}
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
            <p className="text-xs text-muted-foreground">
              {selectedLocationIds.size} location{selectedLocationIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="post-description" className="text-sm font-medium">
              Description *
            </Label>
            <Textarea
              id="post-description"
              placeholder="Share news, updates, or information about your business..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={1500}
              data-testid="textarea-post-description"
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/1500 characters
            </p>
          </div>

          {/* Photo URL */}
          <div className="space-y-2">
            <Label htmlFor="photo-url" className="text-sm font-medium">
              Photo URL (Optional)
            </Label>
            <Input
              id="photo-url"
              placeholder="https://storage.googleapis.com/your-image.jpg"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              data-testid="input-image-url"
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: JPG, PNG, GIF (HEIC/HEIF not supported). Minimum size: 250×250px
            </p>
            
            {/* Image Validation Status */}
            {isCheckingImage && imageUrl && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Checking image...</span>
              </div>
            )}
            
            {imageValidation && !imageValidation.isValid && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded-md" data-testid="image-validation-error">
                <span className="font-medium">⚠️</span>
                <span>{imageValidation.error}</span>
              </div>
            )}
            
            {imageValidation && imageValidation.isValid && (
              <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-500">
                <span>✓</span>
                <span>Image size OK ({imageValidation.width}×{imageValidation.height}px)</span>
              </div>
            )}
            
            {imageUrl && (
              <div className="border rounded-lg p-3">
                <img 
                  src={imageUrl} 
                  alt="Preview" 
                  className="mx-auto max-h-32 rounded-md"
                  onError={(e) => {
                    e.currentTarget.src = '';
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>

          {/* Button (Call to Action) */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">Button *</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="button-type" className="text-xs text-muted-foreground">
                  Button Type
                </Label>
                <Select value={buttonType} onValueChange={setButtonType}>
                  <SelectTrigger data-testid="select-button-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEARN_MORE">Learn More</SelectItem>
                    <SelectItem value="ORDER">Order</SelectItem>
                    <SelectItem value="CALL">Call</SelectItem>
                    <SelectItem value="BOOK">Book</SelectItem>
                    <SelectItem value="SIGN_UP">Sign Up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="button-url" className="text-xs text-muted-foreground">
                  Button Link
                </Label>
                <Input
                  id="button-url"
                  placeholder="https://example.com"
                  value={buttonUrl}
                  onChange={(e) => setButtonUrl(e.target.value)}
                  type="url"
                  data-testid="input-button-url"
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Preview</span>
            </div>
            <div className="space-y-2">
              {description && (
                <p className="text-sm whitespace-pre-wrap">
                  {description}
                </p>
              )}
              {imageUrl && (
                <img 
                  src={imageUrl} 
                  alt="Post preview" 
                  className="w-full max-w-xs rounded-md mt-2"
                />
              )}
              {buttonType && (
                <Button size="sm" className="mt-2" data-testid="preview-button">
                  {buttonType.replace('_', ' ').split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                  ).join(' ')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createPostJobMutation.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createPostJobMutation.isPending}
            data-testid="button-publish-post"
          >
            {createPostJobMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <MessageSquare className="w-4 h-4 mr-2" />
                Publish to {selectedLocationIds.size} Location{selectedLocationIds.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}