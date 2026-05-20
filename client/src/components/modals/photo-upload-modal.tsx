import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { JobProgressToast } from "@/components/job-progress-toast";
import { Camera, Upload, X, Loader2, Image as ImageIcon } from "lucide-react";

interface PhotoUploadModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  selectedLocationIds: string[];
}

interface PhotoFile {
  file: File;
  preview: string;
  category: string;
}

const PHOTO_CATEGORIES = [
  { value: "exterior", label: "Exterior" },
  { value: "interior", label: "Interior" },
  { value: "products", label: "Products/Services" },
  { value: "team", label: "Team" },
  { value: "food", label: "Food & Drinks" },
  { value: "menu", label: "Menu" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

export function PhotoUploadModal({ open, onClose, clientId, selectedLocationIds }: PhotoUploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  const createPhotosJobMutation = useMutation({
    mutationFn: async (photosData: PhotoFile[]) => {
      const formData = new FormData();
      formData.append('type', 'photos');
      formData.append('clientId', clientId);
      formData.append('locationIds', JSON.stringify(selectedLocationIds));
      
      photosData.forEach((photo, index) => {
        formData.append(`photo_${index}`, photo.file);
        formData.append(`category_${index}`, photo.category);
      });

      return await apiRequest('POST', '/api/jobs/create-photos', formData);
    },
    onSuccess: (response: any) => {
      // Show progress toast instead of simple notification
      setCurrentJobId(response.id);
      setShowProgress(true);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to upload photos",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const handleFiles = useCallback((files: FileList) => {
    const validFiles: PhotoFile[] = [];
    
    Array.from(files).forEach(file => {
      // Check file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: `${file.name} is not an image file`,
          variant: "destructive",
        });
        return;
      }

      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `${file.name} is over 10MB`,
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const photoFile: PhotoFile = {
          file,
          preview: e.target?.result as string,
          category: "other"
        };
        
        setPhotos(prev => {
          // Check if file already exists
          if (prev.some(p => p.file.name === file.name && p.file.size === file.size)) {
            return prev;
          }
          return [...prev, photoFile];
        });
      };
      reader.readAsDataURL(file);
    });
  }, [toast]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const updatePhotoCategory = (index: number, category: string) => {
    setPhotos(prev => prev.map((photo, i) => 
      i === index ? { ...photo, category } : photo
    ));
  };

  const handleSubmit = () => {
    if (photos.length === 0) {
      toast({
        title: "No photos selected",
        description: "Please select at least one photo",
        variant: "destructive",
      });
      return;
    }

    if (selectedLocationIds.length === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    createPhotosJobMutation.mutate(photos);
  };

  const handleClose = () => {
    setPhotos([]);
    setDragActive(false);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Upload Photos
          </DialogTitle>
          <DialogDescription>
            Upload photos that will be added to {selectedLocationIds.length} selected location{selectedLocationIds.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive 
                ? "border-primary bg-primary/10" 
                : "border-border hover:border-primary/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {dragActive ? "Drop photos here" : "Upload Photos"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Drag and drop photos here, or click to select files
            </p>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
              id="photo-upload"
              data-testid="input-photo-upload"
            />
            <Label htmlFor="photo-upload">
              <Button variant="outline" asChild>
                <span>Choose Photos</span>
              </Button>
            </Label>
            <p className="text-xs text-muted-foreground mt-2">
              PNG, JPG, GIF up to 10MB each
            </p>
          </div>

          {/* Photos Grid */}
          {photos.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Selected Photos ({photos.length})
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPhotos([])}
                  disabled={createPhotosJobMutation.isPending}
                >
                  Clear All
                </Button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative group">
                    <div className="aspect-square rounded-lg border overflow-hidden">
                      <img
                        src={photo.preview}
                        alt={`Photo ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    
                    <Button
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removePhoto(index)}
                      disabled={createPhotosJobMutation.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>

                    <div className="mt-2">
                      <Select
                        value={photo.category}
                        onValueChange={(value) => updatePhotoCategory(index, value)}
                        disabled={createPhotosJobMutation.isPending}
                      >
                        <SelectTrigger className="h-8" data-testid={`select-photo-category-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PHOTO_CATEGORIES.map(category => (
                            <SelectItem key={category.value} value={category.value}>
                              {category.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {photo.file.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createPhotosJobMutation.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createPhotosJobMutation.isPending || photos.length === 0}
            data-testid="button-upload-photos"
          >
            {createPhotosJobMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4 mr-2" />
                Upload {photos.length} Photo{photos.length !== 1 ? 's' : ''} to {selectedLocationIds.length} Location{selectedLocationIds.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Progress Tracking Toast */}
    {showProgress && currentJobId && (
      <JobProgressToast
        jobId={currentJobId}
        jobType="photos"
        onComplete={() => {
          setShowProgress(false);
          setCurrentJobId(null);
        }}
      />
    )}
    </>
  );
}