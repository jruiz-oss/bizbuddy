// Manage Tags modal — supports adding and removing tags for single or multiple locations
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

  // All available tags
  const { data: tags = [], isLoading: tagsLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  // tagId → Set of locationIds that currently have that tag
  const [originalMap, setOriginalMap] = useState<Map<string, Set<string>>>(new Map());
  // tagId → Set of locationIds that WILL have that tag after save
  const [currentMap, setCurrentMap] = useState<Map<string, Set<string>>>(new Map());
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Fetch existing tags for all selected locations when modal opens
  useEffect(() => {
    if (!open || selectedLocationIds.length === 0) return;

    setLoadingExisting(true);
    Promise.all(
      selectedLocationIds.map((locId) =>
        fetch(`/api/locations/${locId}/tags`)
          .then((r) => r.ok ? r.json() : [])
          .then((locTags: LocationTag[]) => ({ locId, tagIds: locTags.map((t) => t.id) }))
          .catch(() => ({ locId, tagIds: [] }))
      )
    ).then((results) => {
      const map = new Map<string, Set<string>>();
      for (const { locId, tagIds } of results) {
        for (const tagId of tagIds) {
          if (!map.has(tagId)) map.set(tagId, new Set());
          map.get(tagId)!.add(locId);
        }
      }
      setOriginalMap(map);
      setCurrentMap(new Map(Array.from(map.entries()).map(([k, v]) => [k, new Set(v)])));
      setLoadingExisting(false);
    });
  }, [open, selectedLocationIds.join(',')]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setOriginalMap(new Map());
      setCurrentMap(new Map());
    }
  }, [open]);

  const assignMutation = useMutation({
    mutationFn: async ({ tagId, locationId }: { tagId: string; locationId: string }) =>
      apiRequest("POST", `/api/tags/${tagId}/locations/${locationId}`, {}),
  });

  const removeMutation = useMutation({
    mutationFn: async ({ tagId, locationId }: { tagId: string; locationId: string }) =>
      apiRequest("DELETE", `/api/tags/${tagId}/locations/${locationId}`, undefined),
  });

  // A tag is "checked" if ALL selected locations currently have it in currentMap
  const isChecked = (tagId: string) => {
    const locs = currentMap.get(tagId);
    return !!locs && selectedLocationIds.every((id) => locs.has(id));
  };

  // A tag is "indeterminate" if SOME (but not all) selected locations have it
  const isIndeterminate = (tagId: string) => {
    const locs = currentMap.get(tagId);
    if (!locs || locs.size === 0) return false;
    return selectedLocationIds.some((id) => locs.has(id)) && !selectedLocationIds.every((id) => locs.has(id));
  };

  const handleTagToggle = (tagId: string, checked: boolean) => {
    const newMap = new Map(Array.from(currentMap.entries()).map(([k, v]) => [k, new Set(v)]));
    if (checked) {
      // Add all selected locations to this tag
      if (!newMap.has(tagId)) newMap.set(tagId, new Set());
      for (const locId of selectedLocationIds) newMap.get(tagId)!.add(locId);
    } else {
      // Remove all selected locations from this tag
      if (newMap.has(tagId)) {
        for (const locId of selectedLocationIds) newMap.get(tagId)!.delete(locId);
      }
    }
    setCurrentMap(newMap);
  };

  const handleSave = async () => {
    let successCount = 0;
    let errorCount = 0;

    for (const tag of tags) {
      const tagId = tag.id;
      const origLocs = originalMap.get(tagId) ?? new Set<string>();
      const currLocs = currentMap.get(tagId) ?? new Set<string>();

      for (const locId of selectedLocationIds) {
        const hadIt = origLocs.has(locId);
        const hasIt = currLocs.has(locId);

        if (!hadIt && hasIt) {
          try { await assignMutation.mutateAsync({ tagId, locationId: locId }); successCount++; }
          catch { errorCount++; }
        } else if (hadIt && !hasIt) {
          try { await removeMutation.mutateAsync({ tagId, locationId: locId }); successCount++; }
          catch { errorCount++; }
        }
      }
    }

    if (successCount === 0 && errorCount === 0) {
      toast({ title: "No changes", description: "No tags were added or removed." });
      onClose();
      return;
    }

    // Invalidate caches
    queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
    queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });
    for (const locId of selectedLocationIds) {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locId, "tags"] });
    }
    for (const tag of tags) {
      queryClient.invalidateQueries({ queryKey: ["/api/tags", tag.id, "locations"] });
    }

    if (errorCount === 0) {
      toast({ title: "Saved", description: `Tag assignments updated for ${selectedLocationIds.length} location(s).` });
    } else {
      toast({ title: "Partial Success", description: `${successCount} change(s) applied. ${errorCount} failed.`, variant: "default" });
    }

    onClose();
  };

  const isLoading = tagsLoading || loadingExisting;
  const isPending = assignMutation.isPending || removeMutation.isPending;

  // Count how many selected locations currently have a given tag (for the hint label)
  const countWithTag = (tagId: string) => {
    const locs = currentMap.get(tagId);
    if (!locs) return 0;
    return selectedLocationIds.filter((id) => locs.has(id)).length;
  };

  const origCountWithTag = (tagId: string) => {
    const locs = originalMap.get(tagId);
    if (!locs) return 0;
    return selectedLocationIds.filter((id) => locs.has(id)).length;
  };

  const hasChanges = tags.some((tag) => {
    const origLocs = originalMap.get(tag.id) ?? new Set<string>();
    const currLocs = currentMap.get(tag.id) ?? new Set<string>();
    return selectedLocationIds.some((locId) => origLocs.has(locId) !== currLocs.has(locId));
  });

  const total = selectedLocationIds.length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
          <DialogDescription>
            {total === 1
              ? "Check tags to add them, uncheck to remove them from this location."
              : `Managing tags for ${total} locations. Check to add to all, uncheck to remove from all.`}
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
            tags.map((tag) => {
              const checked = isChecked(tag.id);
              const indeterminate = isIndeterminate(tag.id);
              const curr = countWithTag(tag.id);
              const orig = origCountWithTag(tag.id);
              const willAdd = curr > orig;
              const willRemove = curr < orig;

              return (
                <div
                  key={tag.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50"
                >
                  <Checkbox
                    checked={indeterminate ? "indeterminate" : checked}
                    onCheckedChange={(val) => handleTagToggle(tag.id, val === true || val === "indeterminate" ? true : false)}
                    data-testid={`checkbox-tag-${tag.id}`}
                  />
                  <div
                    className="px-2 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1 shrink-0"
                    style={{ backgroundColor: tag.color || "#6366f1" }}
                  >
                    <Tag className="w-3 h-3" />
                    {tag.name}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {total > 1 && (
                      <span className="text-xs text-muted-foreground">{curr}/{total}</span>
                    )}
                    {willAdd && <span className="text-xs text-green-600 font-medium">will add</span>}
                    {willRemove && <span className="text-xs text-red-500 font-medium">will remove</span>}
                  </div>
                </div>
              );
            })
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
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
