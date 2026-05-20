// Manage Tags modal — fires in background, closes immediately, toasts on result
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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

  const { data: tags = [], isLoading: tagsLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  // tagId → Set of locationIds that currently / will have that tag
  const [originalMap, setOriginalMap] = useState<Map<string, Set<string>>>(new Map());
  const [currentMap, setCurrentMap] = useState<Map<string, Set<string>>>(new Map());
  const [loadingExisting, setLoadingExisting] = useState(false);

  useEffect(() => {
    if (!open || selectedLocationIds.length === 0) return;
    setLoadingExisting(true);
    Promise.all(
      selectedLocationIds.map((locId) =>
        fetch(`/api/locations/${locId}/tags`)
          .then((r) => (r.ok ? r.json() : []))
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
  }, [open, selectedLocationIds.join(",")]);

  useEffect(() => {
    if (!open) {
      setOriginalMap(new Map());
      setCurrentMap(new Map());
    }
  }, [open]);

  const isChecked = (tagId: string) => {
    const locs = currentMap.get(tagId);
    return !!locs && selectedLocationIds.every((id) => locs.has(id));
  };

  const isIndeterminate = (tagId: string) => {
    const locs = currentMap.get(tagId);
    if (!locs || locs.size === 0) return false;
    return selectedLocationIds.some((id) => locs.has(id)) && !selectedLocationIds.every((id) => locs.has(id));
  };

  const handleTagToggle = (tagId: string, checked: boolean) => {
    const newMap = new Map(Array.from(currentMap.entries()).map(([k, v]) => [k, new Set(v)]));
    if (checked) {
      if (!newMap.has(tagId)) newMap.set(tagId, new Set());
      for (const locId of selectedLocationIds) newMap.get(tagId)!.add(locId);
    } else {
      if (newMap.has(tagId)) {
        for (const locId of selectedLocationIds) newMap.get(tagId)!.delete(locId);
      }
    }
    setCurrentMap(newMap);
  };

  const handleSave = () => {
    // Build the full work list
    const toAdd: { tagId: string; locationId: string }[] = [];
    const toRemove: { tagId: string; locationId: string }[] = [];

    for (const tag of tags) {
      const origLocs = originalMap.get(tag.id) ?? new Set<string>();
      const currLocs = currentMap.get(tag.id) ?? new Set<string>();
      for (const locId of selectedLocationIds) {
        if (!origLocs.has(locId) && currLocs.has(locId)) toAdd.push({ tagId: tag.id, locationId: locId });
        if (origLocs.has(locId) && !currLocs.has(locId)) toRemove.push({ tagId: tag.id, locationId: locId });
      }
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      toast({ title: "No changes", description: "Nothing to update." });
      onClose();
      return;
    }

    // Close immediately — work continues in background
    onClose();
    toast({ description: `Updating tags for ${selectedLocationIds.length} location(s)…` });

    const allWork = [
      ...toAdd.map(({ tagId, locationId }) =>
        apiRequest("POST", `/api/tags/${tagId}/locations/${locationId}`, {})
      ),
      ...toRemove.map(({ tagId, locationId }) =>
        apiRequest("DELETE", `/api/tags/${tagId}/locations/${locationId}`, undefined)
      ),
    ];

    Promise.allSettled(allWork).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });
      for (const locId of selectedLocationIds) {
        queryClient.invalidateQueries({ queryKey: ["/api/locations", locId, "tags"] });
      }
      for (const tag of tags) {
        queryClient.invalidateQueries({ queryKey: ["/api/tags", tag.id, "locations"] });
      }

      if (failed === 0) {
        toast({
          title: "Tags updated",
          description: `${succeeded} change(s) saved successfully.`,
        });
      } else {
        toast({
          title: "Partial success",
          description: `${succeeded} saved, ${failed} failed.`,
          variant: "destructive",
        });
      }
    });
  };

  const isLoading = tagsLoading || loadingExisting;

  const hasChanges = tags.some((tag) => {
    const origLocs = originalMap.get(tag.id) ?? new Set<string>();
    const currLocs = currentMap.get(tag.id) ?? new Set<string>();
    return selectedLocationIds.some((locId) => origLocs.has(locId) !== currLocs.has(locId));
  });

  const total = selectedLocationIds.length;

  const countCurrent = (tagId: string) => {
    const locs = currentMap.get(tagId);
    if (!locs) return 0;
    return selectedLocationIds.filter((id) => locs.has(id)).length;
  };

  const countOriginal = (tagId: string) => {
    const locs = originalMap.get(tagId);
    if (!locs) return 0;
    return selectedLocationIds.filter((id) => locs.has(id)).length;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
          <DialogDescription>
            {total === 1
              ? "Check to add a tag, uncheck to remove it."
              : `Managing tags for ${total} locations. Changes apply to all selected.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[300px] overflow-y-auto py-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground text-sm">Loading tags…</p>
          ) : tags.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm">
              No tags available. Create tags first in the Tag Management panel.
            </p>
          ) : (
            tags.map((tag) => {
              const checked = isChecked(tag.id);
              const indeterminate = isIndeterminate(tag.id);
              const curr = countCurrent(tag.id);
              const orig = countOriginal(tag.id);
              const willAdd = curr > orig;
              const willRemove = curr < orig;

              return (
                <div
                  key={tag.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleTagToggle(tag.id, !checked && !indeterminate)}
                >
                  <Checkbox
                    checked={indeterminate ? "indeterminate" : checked}
                    onCheckedChange={(val) => handleTagToggle(tag.id, val === true)}
                    onClick={(e) => e.stopPropagation()}
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
                    {willAdd && <span className="text-xs text-green-600 font-medium">+adding</span>}
                    {willRemove && <span className="text-xs text-red-500 font-medium">−removing</span>}
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
            disabled={!hasChanges}
            data-testid="button-confirm-add-tags"
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
