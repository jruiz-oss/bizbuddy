// Manage Tags modal — supports adding and removing tags per location
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationTag } from "@shared/schema";

interface AddToTagModalProps {
  open: boolean;
  onClose: () => void;
  selectedLocationIds: string[];
}

export function AddToTagModal({ open, onClose, selectedLocationIds }: AddToTagModalProps) {
  const { toast } = useToast();
  const isSingleLocation = selectedLocationIds.length === 1;
  const singleLocationId = isSingleLocation ? selectedLocationIds[0] : null;

  // All tags
  const { data: tags = [], isLoading: tagsLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  // Existing tags for this location (only when single location selected)
  const { data: existingTags = [], isLoading: existingLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/locations", singleLocationId, "tags"],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${singleLocationId}/tags`);
      if (!res.ok) throw new Error("Failed to load location tags");
      return res.json();
    },
    enabled: open && isSingleLocation && !!singleLocationId,
  });

  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [originalTags, setOriginalTags] = useState<Set<string>>(new Set());

  // When existing tags load, pre-check them
  useEffect(() => {
    if (open && isSingleLocation && !existingLoading) {
      const existingIds = new Set(existingTags.map((t) => t.id));
      setSelectedTags(new Set(existingIds));
      setOriginalTags(new Set(existingIds));
    } else if (open && !isSingleLocation) {
      setSelectedTags(new Set());
      setOriginalTags(new Set());
    }
  }, [open, existingTags, existingLoading, isSingleLocation]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setSelectedTags(new Set());
      setOriginalTags(new Set());
    }
  }, [open]);

  const assignMutation = useMutation({
    mutationFn: async ({ tagId, locationId }: { tagId: string; locationId: string }) => {
      return await apiRequest("POST", `/api/tags/${tagId}/locations/${locationId}`, {});
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ tagId, locationId }: { tagId: string; locationId: string }) => {
      return await apiRequest("DELETE", `/api/tags/${tagId}/locations/${locationId}`, undefined);
    },
  });

  const handleTagToggle = (tagId: string, checked: boolean) => {
    const newSelected = new Set(selectedTags);
    if (checked) {
      newSelected.add(tagId);
    } else {
      newSelected.delete(tagId);
    }
    setSelectedTags(newSelected);
  };

  const handleSave = async () => {
    let successCount = 0;
    let errorCount = 0;

    if (isSingleLocation && singleLocationId) {
      // Diff: add newly checked, remove newly unchecked
      const toAdd = [...selectedTags].filter((id) => !originalTags.has(id));
      const toRemove = [...originalTags].filter((id) => !selectedTags.has(id));

      if (toAdd.length === 0 && toRemove.length === 0) {
        toast({ title: "No changes", description: "No tags were added or removed." });
        onClose();
        return;
      }

      for (const tagId of toAdd) {
        try {
          await assignMutation.mutateAsync({ tagId, locationId: singleLocationId });
          successCount++;
        } catch {
          errorCount++;
        }
      }
      for (const tagId of toRemove) {
        try {
          await removeMutation.mutateAsync({ tagId, locationId: singleLocationId });
          successCount++;
        } catch {
          errorCount++;
        }
      }
    } else {
      // Multi-location: add only (original behaviour)
      if (selectedTags.size === 0) {
        toast({ title: "Error", description: "Please select at least one tag", variant: "destructive" });
        return;
      }
      for (const tagId of Array.from(selectedTags)) {
        for (const locationId of selectedLocationIds) {
          try {
            await assignMutation.mutateAsync({ tagId, locationId });
            successCount++;
          } catch {
            errorCount++;
          }
        }
      }
    }

    // Invalidate relevant caches
    queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
    queryClient.invalidateQueries({ queryKey: ["/api/locations", singleLocationId, "tags"] });
    for (const tagId of Array.from(selectedTags)) {
      queryClient.invalidateQueries({ queryKey: ["/api/tags", tagId, "locations"] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });

    if (errorCount === 0) {
      toast({
        title: "Saved",
        description: isSingleLocation
          ? "Tag assignments updated successfully."
          : `Added ${selectedLocationIds.length} location(s) to ${selectedTags.size} tag(s).`,
      });
    } else {
      toast({
        title: "Partial Success",
        description: `${successCount} change(s) applied. ${errorCount} failed.`,
        variant: "default",
      });
    }

    setSelectedTags(new Set());
    setOriginalTags(new Set());
    onClose();
  };

  const isLoading = tagsLoading || (isSingleLocation && existingLoading);
  const isPending = assignMutation.isPending || removeMutation.isPending;

  // Compute whether there are actual changes (single-location mode)
  const hasChanges = isSingleLocation
    ? [...selectedTags].some((id) => !originalTags.has(id)) ||
      [...originalTags].some((id) => !selectedTags.has(id))
    : selectedTags.size > 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isSingleLocation ? "Manage Tags" : "Add Tags to Locations"}</DialogTitle>
          <DialogDescription>
            {isSingleLocation
              ? "Check tags to add them, uncheck to remove them from this location."
              : `Select tags to add to ${selectedLocationIds.length} selected location(s).`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[300px] overflow-y-auto py-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground">Loading tags...</p>
          ) : tags.length === 0 ? (
            <p className="text-center text-muted-foreground">
              No tags available. Create tags first in the Tag Management panel.
            </p>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedTags.has(tag.id)}
                  onCheckedChange={(checked) => handleTagToggle(tag.id, !!checked)}
                  data-testid={`checkbox-tag-${tag.id}`}
                />
                <div
                  className="px-2 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1"
                  style={{ backgroundColor: tag.color || "#6366f1" }}
                >
                  <Tag className="w-3 h-3" />
                  {tag.name}
                </div>
                {isSingleLocation && originalTags.has(tag.id) && !selectedTags.has(tag.id) && (
                  <span className="ml-auto text-xs text-red-500 font-medium">will remove</span>
                )}
                {isSingleLocation && !originalTags.has(tag.id) && selectedTags.has(tag.id) && (
                  <span className="ml-auto text-xs text-green-600 font-medium">will add</span>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-add-tags">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isPending}
            data-testid="button-confirm-add-tags"
          >
            {isPending ? "Saving..." : isSingleLocation ? "Save Changes" : "Add Tags"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
