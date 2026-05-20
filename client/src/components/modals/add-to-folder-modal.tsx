import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Folder } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationFolder } from "@shared/schema";

interface AddToFolderModalProps {
  open: boolean;
  onClose: () => void;
  selectedLocationIds: string[];
}

export function AddToFolderModal({ open, onClose, selectedLocationIds }: AddToFolderModalProps) {
  const { toast } = useToast();
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  const { data: folders = [], isLoading } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ folderId, locationId }: { folderId: string; locationId: string }) => {
      return await apiRequest("POST", `/api/folders/${folderId}/locations/${locationId}`, {});
    },
  });

  const handleFolderToggle = (folderId: string, checked: boolean) => {
    const newSelected = new Set(selectedFolders);
    if (checked) {
      newSelected.add(folderId);
    } else {
      newSelected.delete(folderId);
    }
    setSelectedFolders(newSelected);
  };

  const handleAssign = async () => {
    if (selectedFolders.size === 0) {
      toast({ title: "Error", description: "Please select at least one folder", variant: "destructive" });
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const folderId of Array.from(selectedFolders)) {
      for (const locationId of selectedLocationIds) {
        try {
          await assignMutation.mutateAsync({ folderId, locationId });
          successCount++;
        } catch (error) {
          errorCount++;
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
    for (const folderId of Array.from(selectedFolders)) {
      queryClient.invalidateQueries({ queryKey: ["/api/folders", folderId, "locations"] });
    }

    if (errorCount === 0) {
      toast({
        title: "Success",
        description: `Added ${selectedLocationIds.length} location(s) to ${selectedFolders.size} folder(s)`,
      });
    } else {
      toast({
        title: "Partial Success",
        description: `Added ${successCount} assignments. ${errorCount} failed (may already exist).`,
        variant: "default",
      });
    }

    setSelectedFolders(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Locations to Folders</DialogTitle>
          <DialogDescription>
            Select folders to add the {selectedLocationIds.length} selected location{selectedLocationIds.length !== 1 ? 's' : ''} to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-4">Loading folders...</p>
          ) : folders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Folder className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No folders available. Create a folder first to organize your locations.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {folders.map((folder) => {
                  const isSelected = selectedFolders.has(folder.id);
                  return (
                    <Card
                      key={folder.id}
                      className={`cursor-pointer transition-all ${
                        isSelected ? "ring-2 ring-primary ring-offset-2" : ""
                      }`}
                      onClick={() => handleFolderToggle(folder.id, !isSelected)}
                    >
                      <CardContent className="py-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleFolderToggle(folder.id, !!checked)}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-folder-${folder.id}`}
                          />
                          <div
                            className="w-6 h-6 rounded flex-shrink-0"
                            style={{ backgroundColor: folder.color || "#3b82f6" }}
                          />
                          <div className="flex-1">
                            <h4 className="font-medium">{folder.name}</h4>
                            {folder.description && (
                              <p className="text-sm text-muted-foreground">{folder.description}</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleAssign}
                  disabled={selectedFolders.size === 0 || assignMutation.isPending}
                  className="flex-1"
                  data-testid="button-assign-to-folders"
                >
                  {assignMutation.isPending
                    ? "Adding..."
                    : `Add to ${selectedFolders.size || "..."} Folder${selectedFolders.size !== 1 ? "s" : ""}`}
                </Button>
                <Button variant="outline" onClick={onClose} data-testid="button-cancel-assign">
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
