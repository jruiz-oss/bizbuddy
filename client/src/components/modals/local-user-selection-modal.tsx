import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getApiUrl } from "@/lib/queryClient";
import { parseApiError } from "@/lib/parseApiError";
import { useLocalUserContext } from "@/contexts/local-user-context";
import { User, Plus, Pencil, Trash2, Loader2, Upload, X, RefreshCw, ArrowLeft, Eye, EyeOff, Ticket, Copy, Check, Ban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocalUser } from "@shared/schema";
import logoPath from "@/assets/bizbuddy-logo.png";

// API returns passwordHash stripped, hasPassword added
type SafeLocalUser = Omit<LocalUser, 'passwordHash'> & { hasPassword: boolean };

type View = 'list' | 'signin' | 'signup' | 'setup' | 'create' | 'edit' | 'invites' | 'forgot';

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

  // sign-in form (email + password — there is no public list of team members)
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  // new-coworker signup form (name the admin added them under + invite code)
  const [signupName, setSignupName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // forgot-password form
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
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
  const [canPopped, setCanPopped] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setLoginEmail("");
    setSignupName("");
    setPassword("");
    setForgotEmail("");
    setForgotSubmitted(false);
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

  // The roster is only available to signed-in sessions (it is never shown on the
  // login screen), so only fetch it when managing the team.
  const { data: localUsers = [], isLoading } = useQuery<SafeLocalUser[]>({
    queryKey: ["/api/local-users"],
    enabled: open && (isManageMode || !!selectedLocalUser),
  });

  // First run only: nobody has been added yet, so the login screen becomes
  // "add your name". The server answers with a boolean, nothing more.
  const { data: bootstrap, isLoading: bootstrapLoading } = useQuery<{ needsBootstrap: boolean }>({
    queryKey: ["/api/auth/bootstrap-status"],
    enabled: open && !isManageMode && !selectedLocalUser,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, pwd }: { email: string; pwd: string }) => {
      const res = await apiRequest("POST", `/api/local-users/login`, { email, password: pwd });
      return res.json();
    },
    onSuccess: (user: SafeLocalUser) => {
      setSelectedLocalUser(user as any);
      setShowSelectionModal(false);
      resetForm();
    },
    onError: (err: Error) => {
      // Distinguish an actual wrong password from a 429 rate-limit lockout —
      // both used to show "Incorrect password", which reads as "my password
      // stopped working" when it's really just a temporary lockout.
      const message = parseApiError(err, "Please try again.");
      const isRateLimited = /too many login attempts/i.test(message);
      toast({
        title: isRateLimited ? "Too many attempts" : "Couldn't sign in",
        description: message,
        variant: "destructive",
      });
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/local-users/forgot-password", { email });
      return res.json();
    },
    onSuccess: () => {
      // Always show the same confirmation regardless of whether the email
      // matched an account — the server intentionally never reveals that.
      setForgotSubmitted(true);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: parseApiError(err, "Something went wrong. Please try again."), variant: "destructive" });
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; pwd: string; inviteCode: string }) => {
      const res = await apiRequest("POST", `/api/local-users/setup-account`, { name: data.name, email: data.email, password: data.pwd, inviteCode: data.inviteCode });
      return res.json();
    },
    onSuccess: (user: SafeLocalUser) => {
      setSelectedLocalUser(user as any);
      setShowSelectionModal(false);
      resetForm();
      toast({ title: "Account created!", description: "You're all set." });
    },
    onError: (err: Error) => {
      toast({ title: "Setup failed", description: parseApiError(err, "Please try again."), variant: "destructive" });
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
    mutationFn: async ({ id, data }: { id: string; data: { name: string; title: string; profilePictureUrl: string; role?: string } }) => {
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
    onError: (err: Error) => {
      // Surface the server's actual reason (e.g. "No local user selected" after
      // a Google reconnect drops the session's active profile) instead of a
      // generic message that hides what actually needs fixing.
      toast({ title: "Error", description: parseApiError(err, "Failed to generate code"), variant: "destructive" });
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
    onError: (err: Error) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to revoke code"), variant: "destructive" });
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

  const handleLogin = () => {
    if (!loginEmail.trim() || !password) return;
    loginMutation.mutate({ email: loginEmail.trim(), pwd: password });
  };

  const handleSignup = () => {
    if (!signupName.trim() || !setupEmail.trim() || !setupPassword || !setupInviteCode.trim()) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }
    if (setupPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    signupMutation.mutate({ name: signupName.trim(), email: setupEmail.trim(), pwd: setupPassword, inviteCode: setupInviteCode.trim() });
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
      data: {
        name: newName.trim(),
        title: newTitle.trim(),
        profilePictureUrl: newProfilePicture.trim(),
        // Only super admins can change roles; server enforces this too.
        ...(selectedLocalUser?.role === 'super_admin' ? { role: newRole } : {}),
      },
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
                className="flex items-center gap-3 p-3 rounded-lg border group"
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
        </div>
      )}
    </>
  );

  const renderSignin = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="you@commitagency.com"
          autoFocus
          data-testid="input-login-email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter your password"
            data-testid="input-login-password"
          />
          <Button
            type="button" variant="ghost" size="icon"
            className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => { setForgotEmail(loginEmail); setForgotSubmitted(false); setView('forgot'); }}
            data-testid="button-forgot-password"
          >
            Forgot password?
          </button>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => { setPassword(""); setView('signup'); }}
            data-testid="button-new-member"
          >
            New team member?
          </button>
        </div>
      </div>
      <Button className="w-full bg-[#001f3f] text-white hover:bg-[#002a57]" onClick={handleLogin} disabled={!loginEmail.trim() || !password || loginMutation.isPending} data-testid="button-sign-in">
        {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Sign In
      </Button>
      <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { window.location.href = getApiUrl("/auth/google?prompt=consent"); }} data-testid="button-force-relogin">
        <RefreshCw className="w-4 h-4 mr-2" />Re-authenticate Google Account
      </Button>
    </div>
  );

  const renderSignup = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-name">Your name</Label>
        <Input
          id="signup-name"
          value={signupName}
          onChange={(e) => setSignupName(e.target.value)}
          placeholder="Exactly as your admin added you"
          autoFocus
          data-testid="input-signup-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" type="email" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} placeholder="you@commitagency.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Create a password</Label>
        <div className="relative">
          <Input
            id="signup-password"
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
        <Label htmlFor="signup-invite-code">Invite code</Label>
        <Input
          id="signup-invite-code"
          value={setupInviteCode}
          onChange={(e) => setSetupInviteCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleSignup()}
          placeholder="Enter your invite code"
          className="uppercase tracking-widest"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={() => { setSetupPassword(""); setSetupInviteCode(""); setView('signin'); }}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button className="flex-1" onClick={handleSignup} disabled={signupMutation.isPending} data-testid="button-create-account">
          {signupMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create Account
        </Button>
      </div>
    </div>
  );

  const renderForgot = () => (
    <div className="space-y-4">
      {forgotSubmitted ? (
        <div className="text-center py-4 space-y-2">
          <p className="font-medium">Check your email</p>
          <p className="text-sm text-muted-foreground">
            If that email is on a team account, we've sent a link to reset the password. It expires in 1 hour.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && forgotEmail.trim() && forgotPasswordMutation.mutate(forgotEmail.trim())}
              placeholder="you@company.com"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Enter the email on your account and we'll send a reset link.</p>
          </div>
        </>
      )}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => { setView('signin'); setForgotSubmitted(false); }}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        {!forgotSubmitted && (
          <Button
            className="flex-1"
            onClick={() => forgotPasswordMutation.mutate(forgotEmail.trim())}
            disabled={!forgotEmail.trim() || forgotPasswordMutation.isPending}
          >
            {forgotPasswordMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Send Reset Link
          </Button>
        )}
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
      {selectedLocalUser?.role === 'super_admin' && localUsers.length > 0 && (
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
    list: "Manage Team",
    signin: "Sign In",
    signup: "New Team Member",
    setup: "Create Your Account",
    create: "Add Team Member",
    edit: "Edit Profile",
    invites: "Invite Codes",
    forgot: "Reset Password",
  };

  const descMap: Record<View, string> = {
    list: "Add, edit, or remove team members",
    signin: "Sign in with your email and password",
    signup: "Enter the invite code from your admin to create your account",
    setup: "First time? Create a password for your account",
    create: "Fill in the details for the new team member",
    edit: "Update profile info",
    invites: "Generate codes for new team members to set up their accounts",
    forgot: "We'll email you a link to set a new password",
  };

  // Outside manage mode the "list" view is never shown: the login screen has no
  // roster. On a true first run it becomes the add-your-name screen instead.
  const shownView: View = view === 'list' && !isManageMode ? 'signin' : view;
  const showBootstrap = shownView === 'signin' && !isManageMode && !selectedLocalUser && !!bootstrap?.needsBootstrap;

  const bodyContent = (isLoading || (shownView === 'signin' && bootstrapLoading)) ? (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  ) : (
    <>
      {shownView === 'list' && renderList()}
      {shownView === 'signin' && (showBootstrap ? renderList() : renderSignin())}
      {shownView === 'signup' && renderSignup()}
      {shownView === 'forgot' && renderForgot()}
      {shownView === 'setup' && renderSetup()}
      {shownView === 'create' && renderProfileForm(true)}
      {shownView === 'edit' && renderProfileForm(false)}
      {shownView === 'invites' && renderInvites()}
    </>
  );

  // Logged-out: a normal full-page sign-in screen (no popup card). The dialog
  // is only used for the in-app "Manage Team" flow.
  if (!isManageMode && !selectedLocalUser) {
    if (!open) return null;
    return (
      <div className="relative w-full min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12" data-testid="page-sign-in">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-6">
            <img
              src={logoPath}
              alt="BizBuddy"
              className="h-[132px] w-auto object-contain mix-blend-multiply select-none"
              draggable={false}
              data-testid="img-signin-logo"
            />
          </div>
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-modal-title">{titleMap[shownView]}</h1>
            <p className="text-sm text-muted-foreground mt-1.5">{descMap[shownView]}</p>
          </div>
          {bodyContent}
        </div>

        <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-muted-foreground/70">
          Commit Agency &middot; Internal use only
        </p>

        {/* Easter egg: hover for a note, click to pop the can */}
        <button
          type="button"
          onClick={() => { setCanPopped(true); setTimeout(() => setCanPopped(false), 900); }}
          className="fixed bottom-3 right-3 group cursor-pointer bg-transparent border-0 p-0"
          aria-label=""
          data-testid="easter-egg-redbull"
        >
          <div className="relative">
            <img
              src="/redbullicon.png"
              alt=""
              className={`w-11 h-11 object-contain opacity-50 group-hover:opacity-100 transition-all duration-200 ${canPopped ? "rotate-[360deg] scale-125 opacity-100" : ""}`}
              style={{ transitionDuration: canPopped ? "700ms" : undefined }}
            />
            <div className="absolute bottom-full right-0 mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
              <div className="bg-gray-900 text-white text-[10px] rounded py-1.5 px-2.5 shadow-lg border border-gray-700 text-center">
                {canPopped ? "psssht! gives you wings" : "Created By Jorgey Porgie"}
              </div>
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleCloseModal}>
      <DialogContent
        className="max-w-lg overflow-hidden [&>button]:hidden"
        data-testid="modal-local-user-selection"
        onPointerDownOutside={(e) => !isManageMode && e.preventDefault()}
        onEscapeKeyDown={(e) => !isManageMode && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">{titleMap[shownView]}</DialogTitle>
          <DialogDescription>{descMap[shownView]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {bodyContent}
        </div>
      </DialogContent>
    </Dialog>
  );
}
