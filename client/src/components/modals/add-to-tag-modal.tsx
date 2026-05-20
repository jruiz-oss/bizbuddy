import { useState } from "react";
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
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const { data: tags = [], isLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ tagId, locationId }: { tagId: string; locationId: string }) => {
      return await apiRequest("POST", `/api/tags/${tagId}/locations/${locationId}`, {});
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

  const handleAssign = async () => {
    if (selectedTags.size === 0) {
      toast({ title: "Error", description: "Please select at least one tag", variant: "destructive" });
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const tagId of Array.from(selectedTags)) {
      for (const locationId of selectedLocationIds) {
        try {
          await assignMutation.mutateAsync({ tagId, locationId });
          successCount++;
        } catch (error) {
          errorCount++;
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
    for (const tagId of Array.from(selectedTags)) {
      queryClient.invalidateQueries({ queryKey: ["/api/tags", tagId, "locations"] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });

    if (errorCount === 0) {
      toast({
        title: "Success",
        description: `Added ${selectedLocationIds.length} location(s) to ${selectedTags.size} tag(s)`,
      });
    } else {
      toast({
        title: "Partial Success",
        description: `Added ${successCount} assignments. ${errorCount} failed (may already exist).`,
        variant: "default",
      });
    }

    setSelectedTags(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Tags to Locations</DialogTitle>
          <DialogDescription>
            Select tags to add to {selectedLocationIds.length} selected location(s).
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
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-add-tags">
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={selectedTags.size === 0 || assignMutation.isPending}
            data-testid="button-confirm-add-tags"
          >
            {assignMutation.isPending ? "Adding..." : "Add Tags"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
