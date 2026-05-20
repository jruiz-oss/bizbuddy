import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tag, Trash2, Edit, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationTag } from "@shared/schema";

interface TagManagementModalProps {
  open: boolean;
  onClose: () => void;
}

export function TagManagementModal({ open, onClose }: TagManagementModalProps) {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [editingTag, setEditingTag] = useState<LocationTag | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");

  const { data: tags = [], isLoading } = useQuery<LocationTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      return await apiRequest("POST", "/api/tags", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Success", description: "Tag created successfully" });
      setIsCreating(false);
      setNewTagName("");
      setNewTagColor("#6366f1");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create tag", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; color: string } }) => {
      return await apiRequest("PUT", `/api/tags/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Success", description: "Tag updated successfully" });
      setEditingTag(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update tag", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/tags/${id}`, {});
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags", id, "locations"] });
      toast({ title: "Success", description: "Tag deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete tag", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newTagName.trim()) {
      toast({ title: "Error", description: "Tag name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      name: newTagName,
      color: newTagColor,
    });
  };

  const handleUpdate = () => {
    if (!editingTag) return;
    updateMutation.mutate({
      id: editingTag.id,
      data: {
        name: editingTag.name,
        color: editingTag.color || "#6366f1",
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this tag? It will be removed from all locations.")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isCreating ? (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="new-tag-name">Tag Name *</Label>
                    <Input
                      id="new-tag-name"
                      placeholder="e.g., High Priority"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      data-testid="input-new-tag-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-tag-color">Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="new-tag-color"
                        type="color"
                        value={newTagColor}
                        onChange={(e) => setNewTagColor(e.target.value)}
                        className="w-20 h-10"
                        data-testid="input-new-tag-color"
                      />
                      <Input
                        type="text"
                        value={newTagColor}
                        onChange={(e) => setNewTagColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCreate}
                      disabled={createMutation.isPending}
                      data-testid="button-save-new-tag"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Tag"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsCreating(false);
                        setNewTagName("");
                        setNewTagColor("#6366f1");
                      }}
                      data-testid="button-cancel-new-tag"
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
              data-testid="button-create-tag"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Tag
            </Button>
          )}

          <div className="space-y-2">
            {isLoading ? (
              <p className="text-center text-muted-foreground py-4">Loading tags...</p>
            ) : tags.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No tags yet. Create your first tag to categorize your locations.
              </p>
            ) : (
              tags.map((tag) => (
                <Card key={tag.id}>
                  <CardContent className="py-4">
                    {editingTag?.id === tag.id ? (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor={`edit-tag-name-${tag.id}`}>Tag Name *</Label>
                          <Input
                            id={`edit-tag-name-${tag.id}`}
                            value={editingTag.name}
                            onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                            data-testid={`input-edit-tag-name-${tag.id}`}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`edit-tag-color-${tag.id}`}>Color</Label>
                          <div className="flex gap-2">
                            <Input
                              id={`edit-tag-color-${tag.id}`}
                              type="color"
                              value={editingTag.color || "#6366f1"}
                              onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                              className="w-20 h-10"
                              data-testid={`input-edit-tag-color-${tag.id}`}
                            />
                            <Input
                              type="text"
                              value={editingTag.color || "#6366f1"}
                              onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleUpdate}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-tag-${tag.id}`}
                          >
                            {updateMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setEditingTag(null)}
                            data-testid={`button-cancel-edit-${tag.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="px-2 py-1 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: tag.color || "#6366f1" }}
                          >
                            <Tag className="w-3 h-3 inline mr-1" />
                            {tag.name}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingTag(tag)}
                            data-testid={`button-edit-tag-${tag.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(tag.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-tag-${tag.id}`}
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
