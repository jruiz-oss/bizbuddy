import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getApiUrl } from "@/lib/queryClient";
import { useLocalUserContext } from "@/contexts/local-user-context";
import { User, Plus, Pencil, Trash2, Loader2, Upload, X, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocalUser } from "@shared/schema";

interface LocalUserSelectionModalProps {
  open: boolean;
}

export function LocalUserSelectionModal({ open }: LocalUserSelectionModalProps) {
  const { toast } = useToast();
  const { selectedLocalUser, setSelectedLocalUser, setShowSelectionModal, modalMode } = useLocalUserContext();
  const isManageMode = modalMode === 'manage';
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState<LocalUser | null>(null);
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newProfilePicture, setNewProfilePicture] = useState("");
  const [newRole, setNewRole] = useState<string>("admin");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Check if current user can manage team members (super_admin or no users exist yet)
  const canManageUsers = (users: LocalUser[]) => {
    if (users.length === 0) return true;
    return selectedLocalUser?.role === 'super_admin';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Error", description: "Please select an image file", variant: "destructive" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Error", description: "Image must be less than 5MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/upload/profile-picture', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const { url } = await response.json();
      setNewProfilePicture(url);
      toast({ title: "Success", description: "Photo uploaded" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to upload photo", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const { data: localUsers = [], isLoading } = useQuery<LocalUser[]>({
    queryKey: ["/api/local-users"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; title: string; profilePictureUrl: string; role?: string }) => {
      return await apiRequest("POST", "/api/local-users", data);
    },
    onSuccess: async (response) => {
      const newUser = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Success", description: "Team member created" });
      setIsCreating(false);
      setNewName("");
      setNewTitle("");
      setNewProfilePicture("");
      setNewRole("admin");
      setSelectedLocalUser(newUser);
      setShowSelectionModal(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create team member", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; title: string; profilePictureUrl: string } }) => {
      return await apiRequest("PATCH", `/api/local-users/${id}`, data);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Success", description: "Team member updated" });
      setIsEditing(null);
      setNewName("");
      setNewTitle("");
      setNewProfilePicture("");
      setNewRole("admin");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update team member", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/local-users/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Success", description: "Team member removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove team member", variant: "destructive" });
    },
  });

  const handleSelectUser = (user: LocalUser) => {
    setSelectedLocalUser(user);
    setShowSelectionModal(false);
  };

  const handleCreate = () => {
    if (!newName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    const isFirstUser = localUsers.length === 0;
    createMutation.mutate({
      name: newName.trim(),
      title: newTitle.trim(),
      profilePictureUrl: newProfilePicture.trim(),
      ...(isFirstUser ? {} : { role: newRole }),
    });
  };

  const handleUpdate = () => {
    if (!isEditing || !newName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: isEditing.id,
      data: {
        name: newName.trim(),
        title: newTitle.trim(),
        profilePictureUrl: newProfilePicture.trim(),
      },
    });
  };

  const startEdit = (user: LocalUser) => {
    setIsEditing(user);
    setNewName(user.name);
    setNewTitle(user.title || "");
    setNewProfilePicture(user.profilePictureUrl || "");
    setNewRole(user.role || "admin");
    setIsCreating(false);
  };

  const startCreate = () => {
    setIsCreating(true);
    setIsEditing(null);
    setNewName("");
    setNewTitle("");
    setNewProfilePicture("");
    setNewRole("admin");
  };

  const cancelForm = () => {
    setIsCreating(false);
    setIsEditing(null);
    setNewName("");
    setNewTitle("");
    setNewProfilePicture("");
    setNewRole("admin");
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleCloseModal = (nextOpen: boolean) => {
    if (!nextOpen && isManageMode) {
      setShowSelectionModal(false);
      cancelForm();
    }
  };

  const handleForceRelogin = () => {
    window.location.href = getApiUrl("/auth/google?prompt=consent");
  };

  return (
    <Dialog open={open} onOpenChange={handleCloseModal}>
      <DialogContent 
        className="max-w-lg overflow-hidden [&>button]:hidden" 
        data-testid="modal-local-user-selection"
        onPointerDownOutside={(e) => !isManageMode && e.preventDefault()}
        onEscapeKeyDown={(e) => !isManageMode && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">
            {isManageMode ? "Manage Team" : "Who's using the app?"}
          </DialogTitle>
          <DialogDescription>
            {isManageMode 
              ? "Add, edit, or remove team members" 
              : "Select your name to track who makes changes"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {!isCreating && !isEditing && (
                <>
                  {localUsers.length === 0 ? (
                    <div className="text-center py-8">
                      <User className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-4">No team members yet</p>
                      <Button onClick={startCreate} data-testid="button-add-first-user">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Your Name
                      </Button>
                      <Button 
                        variant="ghost"
                        className="w-full mt-4 text-muted-foreground"
                        onClick={handleForceRelogin}
                        data-testid="button-force-relogin-empty"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Re-authenticate Google Account
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                        {localUsers.map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer group"
                            onClick={() => handleSelectUser(user)}
                            data-testid={`card-user-${user.id}`}
                          >
                            <Avatar className="h-10 w-10">
                              {user.profilePictureUrl ? (
                                <AvatarImage src={user.profilePictureUrl} alt={user.name} />
                              ) : null}
                              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate" data-testid={`text-name-${user.id}`}>{user.name}</p>
                              {user.title && (
                                <p className="text-sm text-muted-foreground truncate" data-testid={`text-title-${user.id}`}>
                                  {user.title}
                                </p>
                              )}
                            </div>
                            <div className={`flex gap-1 transition-opacity ${isManageMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              {(canManageUsers(localUsers) || user.id === selectedLocalUser?.id) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(user);
                                  }}
                                  data-testid={`button-edit-${user.id}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                              {canManageUsers(localUsers) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteMutation.mutate(user.id);
                                  }}
                                  data-testid={`button-delete-${user.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {canManageUsers(localUsers) && (
                        <Button 
                          variant="outline" 
                          className="w-full mt-4" 
                          onClick={startCreate}
                          data-testid="button-add-user"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add Team Member
                        </Button>
                      )}
                      {isManageMode && (
                        <Button 
                          className="w-full mt-2" 
                          onClick={() => handleCloseModal(false)}
                          data-testid="button-done-managing"
                        >
                          Done
                        </Button>
                      )}
                      {!isManageMode && (
                        <Button 
                          variant="ghost"
                          className="w-full mt-2 text-muted-foreground"
                          onClick={handleForceRelogin}
                          data-testid="button-force-relogin"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Re-authenticate Google Account
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}

              {(isCreating || isEditing) && (
                <div className="space-y-4">
                  {(canManageUsers(localUsers) || isCreating) && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Enter your name"
                          data-testid="input-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="title">Title (optional)</Label>
                        <Input
                          id="title"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="e.g., Account Manager"
                          data-testid="input-title"
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-2">
                    <Label>Profile Picture (optional)</Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      data-testid="input-profile-picture-file"
                    />
                    <div className="flex items-center gap-3">
                      <Avatar className="h-16 w-16">
                        {newProfilePicture ? (
                          <AvatarImage src={newProfilePicture} alt="Preview" />
                        ) : null}
                        <AvatarFallback className="text-lg">
                          {newName ? getInitials(newName) : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          data-testid="button-upload-photo"
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              {newProfilePicture ? "Change Photo" : "Upload Photo"}
                            </>
                          )}
                        </Button>
                        {newProfilePicture && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setNewProfilePicture("")}
                            data-testid="button-remove-photo"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {isCreating && selectedLocalUser?.role === 'super_admin' && (
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={newRole} onValueChange={setNewRole}>
                        <SelectTrigger data-testid="select-role">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Super Admins can add and remove team members
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={cancelForm} data-testid="button-cancel">
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={isEditing ? handleUpdate : handleCreate}
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save"
                    >
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      {isEditing ? "Save Changes" : "Add & Select"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
