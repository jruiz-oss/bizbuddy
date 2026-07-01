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
import { User, Plus, Pencil, Trash2, Loader2, Upload, X, RefreshCw, ArrowLeft, Eye, EyeOff, Ticket, Copy, Check, Ban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocalUser } from "@shared/schema";

// API returns passwordHash stripped, hasPassword added
type SafeLocalUser = Omit<LocalUser, 'passwordHash'> & { hasPassword: boolean };

type View = 'list' | 'login' | 'setup' | 'create' | 'edit' | 'invites';

type InviteCode = {
  id: string;
  code: string;
  isActive: boolean;
  usedAt: string | null;
  usedByLocalUserId: string | null;
  createdAt: string;
};

interface LocalUserSelectionModalProps {
  open: boolean;
}

export function LocalUserSelectionModal({ open }: LocalUserSelectionModalProps) {
  const { toast } = useToast();
  const { selectedLocalUser, setSelectedLocalUser, setShowSelectionModal, modalMode } = useLocalUserContext();
  const isManageMode = modalMode === 'manage';

  const [view, setView] = useState<View>('list');
  const [targetUser, setTargetUser] = useState<SafeLocalUser | null>(null);

  // login form
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // setup form
  const [setupEmail, setSetupEmail] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [setupInviteCode, setSetupInviteCode] = useState("");
  // profile form
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newProfilePicture, setNewProfilePicture] = useState("");
  const [newRole, setNewRole] = useState<string>("admin");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setPassword("");
    setSetupEmail("");
    setSetupPassword("");
    setSetupInviteCode("");
    setShowPassword(false);
    setShowSetupPassword(false);
    setNewName("");
    setNewTitle("");
    setNewProfilePicture("");
    setNewRole("admin");
    setTargetUser(null);
    setView('list');
  };

  const canManageUsers = (users: SafeLocalUser[]) => {
    if (users.length === 0) return true;
    return selectedLocalUser?.role === 'super_admin';
  };

  const { data: localUsers = [], isLoading } = useQuery<SafeLocalUser[]>({
    queryKey: ["/api/local-users"],
    enabled: open,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ id, pwd }: { id: string; pwd: string }) => {
      const res = await apiRequest("POST", `/api/local-users/${id}/login`, { password: pwd });
      return res.json();
    },
    onSuccess: (user: SafeLocalUser) => {
      setSelectedLocalUser(user as any);
      setShowSelectionModal(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Incorrect password", description: "Please try again.", variant: "destructive" });
    },
  });

  const setupMutation = useMutation({
    mutationFn: async ({ id, email, pwd, inviteCode }: { id: string; email: string; pwd: string; inviteCode: string }) => {
      const res = await apiRequest("POST", `/api/local-users/${id}/setup`, { email, password: pwd, inviteCode });
      return res.json();
    },
    onSuccess: (user: SafeLocalUser) => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      setSelectedLocalUser(user as any);
      setShowSelectionModal(false);
      resetForm();
      toast({ title: "Account created!", description: "You're all set." });
    },
    onError: (err: Error) => {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; title: string; profilePictureUrl: string; role?: string }) => {
      const res = await apiRequest("POST", "/api/local-users", data);
      return res.json();
    },
    onSuccess: (newUser: SafeLocalUser) => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Team member added", description: "They'll set a password on first sign-in." });
      // Drop into setup flow for the new user
      setTargetUser(newUser);
      setSetupEmail("");
      setSetupPassword("");
      setView('setup');
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create team member", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; title: string; profilePictureUrl: string } }) => {
      const res = await apiRequest("PATCH", `/api/local-users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Updated" });
      resetForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/local-users/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-users"] });
      toast({ title: "Removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove", variant: "destructive" });
    },
  });

  const { data: inviteCodes = [], refetch: refetchCodes } = useQuery<InviteCode[]>({
    queryKey: ["/api/invite-codes"],
    enabled: open && view === 'invites',
  });

  const generateCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invite-codes", {});
      return res.json();
    },
    onSuccess: () => {
      refetchCodes();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to generate code", variant: "destructive" });
    },
  });

  const revokeCodeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/invite-codes/${id}`, {});
    },
    onSuccess: () => {
      refetchCodes();
      toast({ title: "Code revoked" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to revoke code", variant: "destructive" });
    },
  });

  const handleCopyCode = (code: InviteCode) => {
    navigator.clipboard.writeText(code.code);
    setCopiedId(code.id);
    setTimeout(() => setCopiedId(null), 2000);
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
      const response = await fetch(getApiUrl('/api/upload/profile-picture'), { method: 'POST', body: formData, credentials: "include" });
      if (!response.ok) throw new Error('Upload failed');
      const { url } = await response.json();
      setNewProfilePicture(url);
      toast({ title: "Photo uploaded" });
    } catch {
      toast({ title: "Error", description: "Failed to upload photo", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getInitials = (name: string) =>
    name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const handleUserClick = (user: SafeLocalUser) => {
    if (isManageMode) return;
    setTargetUser(user);
    setView(user.hasPassword ? 'login' : 'setup');
  };

  const handleLogin = () => {
    if (!targetUser || !password) return;
    loginMutation.mutate({ id: targetUser.id, pwd: password });
  };

  const handleSetup = () => {
    if (!targetUser) return;
    if (!setupEmail.trim() || !setupPassword) {
      toast({ title: "Error", description: "Email and password are required", variant: "destructive" });
      return;
    }
    if (!setupInviteCode.trim()) {
      toast({ title: "Error", description: "Invite code is required", variant: "destructive" });
      return;
    }
    if (setupPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setupMutation.mutate({ id: targetUser.id, email: setupEmail.trim(), pwd: setupPassword, inviteCode: setupInviteCode.trim() });
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
    if (!targetUser || !newName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: targetUser.id,
      data: { name: newName.trim(), title: newTitle.trim(), profilePictureUrl: newProfilePicture.trim() },
    });
  };

  const startEdit = (user: SafeLocalUser) => {
    setTargetUser(user);
    setNewName(user.name);
    setNewTitle(user.title || "");
    setNewProfilePicture(user.profilePictureUrl || "");
    setNewRole(user.role || "admin");
    setView('edit');
  };

  const handleCloseModal = (nextOpen: boolean) => {
    if (!nextOpen && isManageMode) {
      setShowSelectionModal(false);
      resetForm();
    }
  };

  // ── Views ─────────────────────────────────────────────────────────

  const renderList = () => (
    <>
      {localUsers.length === 0 ? (
        <div className="text-center py-8">
          <User className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-4">No team members yet</p>
          <Button onClick={() => setView('create')} data-testid="button-add-first-user">
            <Plus className="w-4 h-4 mr-2" />Add Your Name
          </Button>
          <Button variant="ghost" className="w-full mt-4 text-muted-foreground" onClick={() => { window.location.href = getApiUrl("/auth/google?prompt=consent"); }}>
            <RefreshCw className="w-4 h-4 mr-2" />Re-authenticate Google Account
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {localUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer group"
                onClick={() => handleUserClick(user)}
                data-testid={`card-user-${user.id}`}
              >
                <Avatar className="h-10 w-10">
                  {user.profilePictureUrl ? <AvatarImage src={user.profilePictureUrl} alt={user.name} /> : null}
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" data-testid={`text-name-${user.id}`}>{user.name}</p>
                  {user.title && <p className="text-sm text-muted-foreground truncate">{user.title}</p>}
                  {!user.hasPassword && (
                    <p className="text-xs text-amber-600 font-medium">Account not set up yet</p>
                  )}
                </div>
                <div className={`flex gap-1 transition-opacity ${isManageMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {(canManageUsers(localUsers) || user.id === selectedLocalUser?.id) && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); startEdit(user); }}
                      data-testid={`button-edit-${user.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  {canManageUsers(localUsers) && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(user.id); }}
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
            <Button variant="outline" className="w-full mt-4" onClick={() => setView('create')} data-testid="button-add-user">
              <Plus className="w-4 h-4 mr-2" />Add Team Member
            </Button>
          )}
          {canManageUsers(localUsers) && (
            <Button variant="ghost" className="w-full mt-1 text-muted-foreground" onClick={() => setView('invites')} data-testid="button-invite-codes">
              <Ticket className="w-4 h-4 mr-2" />Invite Codes
            </Button>
          )}
          {isManageMode && (
            <Button className="w-full mt-2" onClick={() => handleCloseModal(false)} data-testid="button-done-managing">Done</Button>
          )}
          {!isManageMode && (
            <Button variant="ghost" className="w-full mt-2 text-muted-foreground" onClick={() => { window.location.href = getApiUrl("/auth/google?prompt=consent"); }} data-testid="button-force-relogin">
              <RefreshCw className="w-4 h-4 mr-2" />Re-authenticate Google Account
            </Button>
          )}
        </div>
      )}
    </>
  );

  const renderLogin = () => (
    <div className="space-y-4">
      {targetUser && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
          <Avatar className="h-10 w-10">
            {targetUser.profilePictureUrl ? <AvatarImage src={targetUser.profilePictureUrl} alt={targetUser.name} /> : null}
            <AvatarFallback>{getInitials(targetUser.name)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{targetUser.name}</p>
            {targetUser.title && <p className="text-sm text-muted-foreground">{targetUser.title}</p>}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter your password"
            autoFocus
          />
          <Button
            type="button" variant="ghost" size="icon"
            className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={() => { setView('list'); setPassword(""); }}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button className="flex-1" onClick={handleLogin} disabled={!password || loginMutation.isPending}>
          {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Sign In
        </Button>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="space-y-4">
      {targetUser && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
          <Avatar className="h-10 w-10">
            {targetUser.profilePictureUrl ? <AvatarImage src={targetUser.profilePictureUrl} alt={targetUser.name} /> : null}
            <AvatarFallback>{getInitials(targetUser.name)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{targetUser.name}</p>
            <p className="text-xs text-muted-foreground">Create your account to get started</p>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="setup-email">Email</Label>
        <Input
          id="setup-email"
          type="email"
          value={setupEmail}
          onChange={(e) => setSetupEmail(e.target.value)}
          placeholder="you@commitagency.com"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="setup-password">Create a password</Label>
        <div className="relative">
          <Input
            id="setup-password"
            type={showSetupPassword ? "text" : "password"}
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Button
            type="button" variant="ghost" size="icon"
            className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
            onClick={() => setShowSetupPassword(!showSetupPassword)}
          >
            {showSetupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="setup-invite-code">Invite code</Label>
        <Input
          id="setup-invite-code"
          type="text"
          value={setupInviteCode}
          onChange={(e) => setSetupInviteCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
          placeholder="Enter your invite code"
          className="uppercase tracking-widest"
        />

      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={() => setView('list')}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button className="flex-1" onClick={handleSetup} disabled={!setupEmail || !setupPassword || !setupInviteCode || setupMutation.isPending}>
          {setupMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create Account
        </Button>
      </div>
    </div>
  );

  const renderProfileForm = (isCreate: boolean) => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Enter name" autoFocus data-testid="input-name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Title (optional)</Label>
        <Input id="title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g., Account Manager" data-testid="input-title" />
      </div>
      <div className="space-y-2">
        <Label>Profile Picture (optional)</Label>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" data-testid="input-profile-picture-file" />
        <div className="flex items-center gap-3">
          <Avatar className="h-16 w-16">
            {newProfilePicture ? <AvatarImage src={newProfilePicture} alt="Preview" /> : null}
            <AvatarFallback className="text-lg">{newName ? getInitials(newName) : "?"}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading} data-testid="button-upload-photo">
              {isUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="w-4 h-4 mr-2" />{newProfilePicture ? "Change Photo" : "Upload Photo"}</>}
            </Button>
            {newProfilePicture && (
              <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setNewProfilePicture("")} data-testid="button-remove-photo">
                <X className="w-4 h-4 mr-2" />Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      {isCreate && selectedLocalUser?.role === 'super_admin' && localUsers.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger data-testid="select-role"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Super Admins can add and remove team members</p>
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={resetForm} data-testid="button-cancel">
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button
          className="flex-1"
          onClick={isCreate ? handleCreate : handleUpdate}
          disabled={createMutation.isPending || updateMutation.isPending}
          data-testid="button-save"
        >
          {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isCreate ? "Add Member" : "Save Changes"}
        </Button>
      </div>
    </div>
  );

  const renderInvites = () => {
    const active = inviteCodes.filter(c => c.isActive && !c.usedAt);
    const used = inviteCodes.filter(c => c.usedAt || !c.isActive);
    return (
      <div className="space-y-4">
        <Button
          className="w-full"
          onClick={() => generateCodeMutation.mutate()}
          disabled={generateCodeMutation.isPending}
        >
          {generateCodeMutation.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
            : <><Plus className="w-4 h-4 mr-2" />Generate Invite Code</>}
        </Button>

        {active.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</p>
            {active.map(code => (
              <div key={code.id} className="flex items-center gap-2 p-2 rounded-lg border bg-muted/40">
                <code className="flex-1 font-mono text-sm font-semibold tracking-widest">{code.code}</code>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => handleCopyCode(code)}
                  title="Copy"
                >
                  {copiedId === code.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => revokeCodeMutation.mutate(code.id)}
                  title="Revoke"
                >
                  <Ban className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {active.length === 0 && inviteCodes.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No codes yet. Generate one above.</p>
        )}

        {used.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Used / Revoked</p>
            {used.map(code => (
              <div key={code.id} className="flex items-center gap-2 p-2 rounded-lg border opacity-50">
                <code className="flex-1 font-mono text-sm tracking-widest line-through">{code.code}</code>
                <span className="text-xs text-muted-foreground shrink-0">
                  {code.usedAt ? 'Used' : 'Revoked'}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={() => setView('list')}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
      </div>
    );
  };

  const titleMap: Record<View, string> = {
    list: isManageMode ? "Manage Team" : "Who's using the app?",
    login: "Sign In",
    setup: "Create Your Account",
    create: "Add Team Member",
    edit: "Edit Profile",
    invites: "Invite Codes",
  };

  const descMap: Record<View, string> = {
    list: isManageMode ? "Add, edit, or remove team members" : "Select your name to continue",
    login: "Enter your password to continue",
    setup: "First time? Create a password for your account",
    create: "Fill in the details for the new team member",
    edit: "Update profile info",
    invites: "Generate codes for new team members to set up their accounts",
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
          <DialogTitle data-testid="text-modal-title">{titleMap[view]}</DialogTitle>
          <DialogDescription>{descMap[view]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {view === 'list' && renderList()}
              {view === 'login' && renderLogin()}
              {view === 'setup' && renderSetup()}
              {view === 'create' && renderProfileForm(true)}
              {view === 'edit' && renderProfileForm(false)}
              {view === 'invites' && renderInvites()}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
