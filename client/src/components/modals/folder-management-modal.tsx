import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Folder, Trash2, Edit, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationFolder } from "@shared/schema";

interface FolderManagementModalProps {
  open: boolean;
  onClose: () => void;
}

export function FolderManagementModal({ open, onClose }: FolderManagementModalProps) {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<LocationFolder | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDescription, setNewFolderDescription] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#3b82f6");

  const { data: folders = [], isLoading } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; color: string }) => {
      return await apiRequest("POST", "/api/folders", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      toast({ title: "Success", description: "Folder created successfully" });
      setIsCreating(false);
      setNewFolderName("");
      setNewFolderDescription("");
      setNewFolderColor("#3b82f6");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create folder", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; description: string; color: string } }) => {
      return await apiRequest("PUT", `/api/folders/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      toast({ title: "Success", description: "Folder updated successfully" });
      setEditingFolder(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update folder", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/folders/${id}`, {});
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/folders", id, "locations"] });
      toast({ title: "Success", description: "Folder deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete folder", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newFolderName.trim()) {
      toast({ title: "Error", description: "Folder name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      name: newFolderName,
      description: newFolderDescription,
      color: newFolderColor,
    });
  };

  const handleUpdate = () => {
    if (!editingFolder) return;
    updateMutation.mutate({
      id: editingFolder.id,
      data: {
        name: editingFolder.name,
        description: editingFolder.description || "",
        color: editingFolder.color || "#3b82f6",
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this folder? Locations will not be deleted, only the folder.")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Folders</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create New Folder */}
          {isCreating ? (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="new-folder-name">Folder Name *</Label>
                    <Input
                      id="new-folder-name"
                      placeholder="e.g., California Locations"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      data-testid="input-new-folder-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-folder-description">Description</Label>
                    <Input
                      id="new-folder-description"
                      placeholder="Optional description"
                      value={newFolderDescription}
                      onChange={(e) => setNewFolderDescription(e.target.value)}
                      data-testid="input-new-folder-description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-folder-color">Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="new-folder-color"
                        type="color"
                        value={newFolderColor}
                        onChange={(e) => setNewFolderColor(e.target.value)}
                        className="w-20 h-10"
                        data-testid="input-new-folder-color"
                      />
                      <Input
                        type="text"
                        value={newFolderColor}
                        onChange={(e) => setNewFolderColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCreate}
                      disabled={createMutation.isPending}
                      data-testid="button-save-new-folder"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Folder"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsCreating(false);
                        setNewFolderName("");
                        setNewFolderDescription("");
                        setNewFolderColor("#3b82f6");
                      }}
                      data-testid="button-cancel-new-folder"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button
              onClick={() => setIsCreating(true)}
              className="w-full"
              variant="outline"
              data-testid="button-create-folder"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Folder
            </Button>
          )}

          {/* Existing Folders List */}
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-center text-muted-foreground py-4">Loading folders...</p>
            ) : folders.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No folders yet. Create your first folder to organize your locations.
              </p>
            ) : (
              folders.map((folder) => (
                <Card key={folder.id}>
                  <CardContent className="py-4">
                    {editingFolder?.id === folder.id ? (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor={`edit-folder-name-${folder.id}`}>Folder Name *</Label>
                          <Input
                            id={`edit-folder-name-${folder.id}`}
                            value={editingFolder.name}
                            onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
                            data-testid={`input-edit-folder-name-${folder.id}`}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`edit-folder-description-${folder.id}`}>Description</Label>
                          <Input
                            id={`edit-folder-description-${folder.id}`}
                            value={editingFolder.description || ""}
                            onChange={(e) => setEditingFolder({ ...editingFolder, description: e.target.value })}
                            data-testid={`input-edit-folder-description-${folder.id}`}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`edit-folder-color-${folder.id}`}>Color</Label>
                          <div className="flex gap-2">
                            <Input
                              id={`edit-folder-color-${folder.id}`}
                              type="color"
                              value={editingFolder.color || "#3b82f6"}
                              onChange={(e) => setEditingFolder({ ...editingFolder, color: e.target.value })}
                              className="w-20 h-10"
                              data-testid={`input-edit-folder-color-${folder.id}`}
                            />
                            <Input
                              type="text"
                              value={editingFolder.color || "#3b82f6"}
                              onChange={(e) => setEditingFolder({ ...editingFolder, color: e.target.value })}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleUpdate}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-folder-${folder.id}`}
                          >
                            {updateMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setEditingFolder(null)}
                            data-testid={`button-cancel-edit-${folder.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: folder.color || "#3b82f6" }}
                          />
                          <div>
                            <h4 className="font-medium">{folder.name}</h4>
                            {folder.description && (
                              <p className="text-sm text-muted-foreground">{folder.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingFolder(folder)}
                            data-testid={`button-edit-folder-${folder.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(folder.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-folder-${folder.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
