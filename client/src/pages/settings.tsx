import { SideNav } from "@/components/SideNav";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Save, Key, Bell, Shield, User, Palette, Settings as SettingsIcon, LogOut, BarChart3, Clock, History, MapPin, MessageSquare, Lightbulb, Star, Mail, Plus, Trash2, Edit2, Users, Share2, Send, Loader2, RefreshCw, CalendarClock, Terminal, AlertTriangle, Unlink, Sheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { useLocation, Link as WouterLink } from "wouter";
import { queryClient, apiRequest, getApiUrl } from "@/lib/queryClient";
import type { Client, ClientSettings, ReviewEmailGroup, ClientLocation } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

interface ReviewEmailGroupWithLocations extends ReviewEmailGroup {
  locationIds: string[];
}

interface UserSettings {
  name: string;
  email: string;
  timezone: string;
  notificationEmail: string;
  notifyOnJobCompletion: boolean;
  notifyOnErrors: boolean;
  notifyWeeklyReport: boolean;
  lastLocationSyncAt: string | null;
  nextLocationSyncAt: string | null;
}

interface SettingsProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

export default function Settings({ selectedClientId, setSelectedClientId }: SettingsProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();

  const [activeTab, setActiveTab] = useState<"general" | "developer">("general");
  const [devMode, setDevMode] = useState(() => localStorage.getItem("bizbuddy_devmode") === "true");

  useEffect(() => {
    const val = devMode ? "true" : "false";
    localStorage.setItem("bizbuddy_devmode", val);
    window.dispatchEvent(new CustomEvent("bizbuddy-devmode-change", { detail: devMode }));
  }, [devMode]);
  
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/locations/all"],
  });

  const { data: locationFolders = [] } = useQuery<{ id: string; name: string; color: string }[]>({
    queryKey: ["/api/folders"],
  });

  const [newGroupFolderFilter, setNewGroupFolderFilter] = useState<string[]>([]);
  const [editGroupFolderFilter, setEditGroupFolderFilter] = useState<string[]>([]);

  const newFolderQueries = useQueries({
    queries: newGroupFolderFilter.map(folderId => ({
      queryKey: [`/api/folders/${folderId}/locations`],
      queryFn: () => fetch(`/api/folders/${folderId}/locations`).then(r => r.json()) as Promise<ClientLocation[]>,
    })),
  });

  const editFolderQueries = useQueries({
    queries: editGroupFolderFilter.map(folderId => ({
      queryKey: [`/api/folders/${folderId}/locations`],
      queryFn: () => fetch(`/api/folders/${folderId}/locations`).then(r => r.json()) as Promise<ClientLocation[]>,
    })),
  });

  const newGroupFolderLocations: ClientLocation[] = newGroupFolderFilter.length === 0
    ? allLocations
    : Array.from(new Map(
        newFolderQueries.flatMap(q => (q.data ?? []) as ClientLocation[]).map(l => [l.id, l])
      ).values());

  const editGroupFolderLocations: ClientLocation[] = editGroupFolderFilter.length === 0
    ? allLocations
    : Array.from(new Map(
        editFolderQueries.flatMap(q => (q.data ?? []) as ClientLocation[]).map(l => [l.id, l])
      ).values());

  const toggleNewFolder = (folderId: string) =>
    setNewGroupFolderFilter(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);

  const toggleEditFolder = (folderId: string) =>
    setEditGroupFolderFilter(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);

  const { data: settings, isLoading } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
  });

  const [formData, setFormData] = useState<UserSettings>({
    name: settings?.name || "",
    email: settings?.email || "",
    timezone: settings?.timezone || "America/Phoenix",
    notificationEmail: settings?.notificationEmail || "",
    notifyOnJobCompletion: settings?.notifyOnJobCompletion !== false,
    notifyOnErrors: settings?.notifyOnErrors !== false,
    notifyWeeklyReport: settings?.notifyWeeklyReport === true,
  });

  // Update form data when settings are loaded
  if (settings && formData.name === "" && formData.email === "") {
    setFormData({
      name: settings.name,
      email: settings.email,
      timezone: settings.timezone,
      notificationEmail: settings.notificationEmail,
      notifyOnJobCompletion: settings.notifyOnJobCompletion,
      notifyOnErrors: settings.notifyOnErrors,
      notifyWeeklyReport: settings.notifyWeeklyReport,
    });
  }

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: UserSettings) => {
      return await apiRequest("PUT", "/api/user/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      toast({
        title: "Settings saved",
        description: "Your settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      return response;
    },
    onSuccess: () => {
      // Clear all cached queries
      queryClient.clear();
      
      toast({
        title: "Logged out",
        description: "Redirecting to login page...",
      });
      // Redirect to Google OAuth login after a short delay
      setTimeout(() => {
        window.location.href = getApiUrl('/auth/google');
      }, 500);
    },
    onError: (error: Error) => {
      console.error("Logout error:", error);
      toast({
        title: "Error logging out",
        description: error.message || "Failed to logout",
        variant: "destructive",
      });
    },
  });

  const revokeGoogleMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auth/revoke-google", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      toast({
        title: "Google auth revoked",
        description: "Google tokens cleared. You're still logged in — API calls will now fail as expected.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to revoke Google auth",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveSettingsMutation.mutate(formData);
  };

  const handleForceRelogin = () => {
    logoutMutation.mutate();
  };

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const [pathname] = useLocation();

  // Email Groups
  const { data: emailGroups = [] } = useQuery<ReviewEmailGroupWithLocations[]>({
    queryKey: ["/api/review-email-groups"],
  });

  const [editingGroup, setEditingGroup] = useState<ReviewEmailGroupWithLocations | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const todayPhoenix = new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });

  const [newGroup, setNewGroup] = useState({
    name: "",
    recipientEmail: "",
    ccEmail: "",
    emailDay: "1",
    emailTime: "09:00",
    frequency: "weekly" as "weekly" | "biweekly" | "monthly",
    minStars: 1,
    maxStars: 3,
    lookbackDays: 7,
    customMessage: "",
    customSubject: "",
    isEnabled: true,
    startDate: todayPhoenix,
    outputFormat: "email" as "email" | "sheet",
    sheetBreakout: "region" as "region" | "location" | "none",
    locationIds: [] as string[],
  });

  // Group locations by client for the UI, optionally filtered by local folders
  const locationsByClient = clients.map(client => ({
    client,
    locations: allLocations.filter(loc => loc.clientId === client.id)
  })).filter(group => group.locations.length > 0);

  const locationsByClientForNew = clients.map(client => ({
    client,
    locations: newGroupFolderLocations.filter(loc => loc.clientId === client.id)
  })).filter(group => group.locations.length > 0);

  const locationsByClientForEdit = clients.map(client => ({
    client,
    locations: editGroupFolderLocations.filter(loc => loc.clientId === client.id)
  })).filter(group => group.locations.length > 0);

  const createGroupMutation = useMutation({
    mutationFn: async (data: typeof newGroup) => {
      return await apiRequest("POST", "/api/review-email-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-email-groups"] });
      setIsCreatingGroup(false);
      setNewGroup({
        name: "",
        recipientEmail: "",
        ccEmail: "",
        emailDay: "1",
        emailTime: "09:00",
        frequency: "weekly",
        minStars: 1,
        maxStars: 3,
        lookbackDays: 7,
        customMessage: "",
        customSubject: "",
        isEnabled: true,
        startDate: new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" }),
        outputFormat: "email",
        sheetBreakout: "region",
        locationIds: [],
      });
      toast({
        title: "Email group created",
        description: "Your new email group has been created.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<typeof newGroup> }) => {
      return await apiRequest("PUT", `/api/review-email-groups/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-email-groups"] });
      setEditingGroup(null);
      toast({
        title: "Email group updated",
        description: "Your email group has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/review-email-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-email-groups"] });
      toast({
        title: "Email group deleted",
        description: "The email group has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [testingGroupId, setTestingGroupId] = useState<string | null>(null);
  const [testEmailOverride, setTestEmailOverride] = useState("");
  const [sendingTestGroupId, setSendingTestGroupId] = useState<string | null>(null);

  const sendTestEmailMutation = useMutation({
    mutationFn: async ({ id, email }: { id: string; email: string }) => {
      setSendingTestGroupId(id);
      return await apiRequest("POST", `/api/review-email-groups/${id}/test`, { testEmail: email });
    },
    onSuccess: () => {
      setSendingTestGroupId(null);
      setTestingGroupId(null);
      toast({
        title: "Test email sent",
        description: "Check your inbox — it may take a moment to arrive.",
      });
    },
    onError: (error: Error) => {
      setSendingTestGroupId(null);
      toast({
        title: "Failed to send test email",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleLocationInGroup = (locationId: string, currentIds: string[], setter: (ids: string[]) => void) => {
    if (currentIds.includes(locationId)) {
      setter(currentIds.filter(id => id !== locationId));
    } else {
      setter([...currentIds, locationId]);
    }
  };

  const toggleAllLocationsForClient = (clientId: string, currentIds: string[], setter: (ids: string[]) => void) => {
    const clientLocations = allLocations.filter(loc => loc.clientId === clientId);
    const clientLocationIds = clientLocations.map(loc => loc.id);
    const allSelected = clientLocationIds.every(id => currentIds.includes(id));
    
    if (allSelected) {
      setter(currentIds.filter(id => !clientLocationIds.includes(id)));
    } else {
      setter([...new Set([...currentIds, ...clientLocationIds])]);
    }
  };

  const getDayName = (day: string) => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[parseInt(day)] || "Monday";
  };

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />

      {/* Main Content */}
      <main className="flex-1 ml-56 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-4xl font-bold text-black">Settings</h1>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
            <button
              onClick={() => setActiveTab("general")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "general" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="tab-general"
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("developer")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === "developer" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="tab-developer"
            >
              <Terminal className="w-3.5 h-3.5" />
              Developer
              {devMode && <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
            </button>
          </div>

          <div className="space-y-6">
            {/* Profile Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Profile Settings
                </CardTitle>
                <CardDescription>
                  Manage your personal information and preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input 
                      id="name" 
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      data-testid="input-email"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select 
                    value={formData.timezone}
                    onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                  >
                    <SelectTrigger data-testid="select-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Phoenix">America/Phoenix (MST)</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                      <SelectItem value="America/Chicago">America/Chicago (CST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los_Angeles (PST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {activeTab === "developer" && <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  API Settings
                </CardTitle>
                <CardDescription>
                  Google Business Profile API connection &amp; rate limiting
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <div>
                      <p className="font-medium">Google Business Profile API</p>
                      <p className="text-sm text-muted-foreground">
                        Connected to {clients[0]?.userId || 'your Google account'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Connected</Badge>
                </div>

                <div className="space-y-2">
                  <Label>Rate Limiting</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="requests-per-second" className="text-sm">Requests per second</Label>
                      <Input id="requests-per-second" type="number" defaultValue="3" min="1" max="10" />
                    </div>
                    <div>
                      <Label htmlFor="batch-size" className="text-sm">Batch size</Label>
                      <Input id="batch-size" type="number" defaultValue="15" min="5" max="50" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>}

            {activeTab === "general" && <>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  Configure when and how you want to be notified
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Job Completion Notifications</Label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Get notified when bulk operations complete
                    </p>
                  </div>
                  <Switch 
                    checked={formData.notifyOnJobCompletion}
                    onCheckedChange={(checked) => setFormData({ ...formData, notifyOnJobCompletion: checked })}
                    data-testid="switch-notify-completion"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Error Notifications</Label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Get notified when operations fail
                    </p>
                  </div>
                  <Switch 
                    checked={formData.notifyOnErrors}
                    onCheckedChange={(checked) => setFormData({ ...formData, notifyOnErrors: checked })}
                    data-testid="switch-notify-errors"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Weekly Reports</Label>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Receive weekly performance summaries
                    </p>
                  </div>
                  <Switch 
                    checked={formData.notifyWeeklyReport}
                    onCheckedChange={(checked) => setFormData({ ...formData, notifyWeeklyReport: checked })}
                    data-testid="switch-notify-weekly"
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="notification-email">Notification Email</Label>
                  <Input 
                    id="notification-email" 
                    type="email" 
                    value={formData.notificationEmail}
                    onChange={(e) => setFormData({ ...formData, notificationEmail: e.target.value })}
                    data-testid="input-notification-email"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Review Email Groups */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Weekly Review Email Groups
                </CardTitle>
                <CardDescription>
                  Create groups of clients to receive weekly review email summaries. Each group gets its own email.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing Groups */}
                {emailGroups.length > 0 && (
                  <div className="space-y-3">
                    {emailGroups.map((group) => (
                      <div key={group.id} className="border rounded-lg p-4 space-y-3">
                        {editingGroup?.id === group.id ? (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Group Name</Label>
                              <Input
                                value={editingGroup.name}
                                onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                                placeholder="e.g., Low-Star Alerts"
                                data-testid={`input-edit-group-name-${group.id}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Recipient Emails (comma separated)</Label>
                              <Input
                                value={editingGroup.recipientEmail}
                                onChange={(e) => setEditingGroup({ ...editingGroup, recipientEmail: e.target.value })}
                                placeholder="email1@example.com, email2@example.com"
                                data-testid={`input-edit-group-email-${group.id}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>CC Emails (comma separated, optional)</Label>
                              <Input
                                value={editingGroup.ccEmail || ""}
                                onChange={(e) => setEditingGroup({ ...editingGroup, ccEmail: e.target.value })}
                                placeholder="cc1@example.com, cc2@example.com"
                                data-testid={`input-edit-group-cc-${group.id}`}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Day</Label>
                                <Select value={editingGroup.emailDay} onValueChange={(v) => setEditingGroup({ ...editingGroup, emailDay: v })}>
                                  <SelectTrigger data-testid={`select-edit-group-day-${group.id}`}><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                                      <SelectItem key={i} value={i.toString()}>{d}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>Time</Label>
                                <Input type="time" value={editingGroup.emailTime} onChange={(e) => setEditingGroup({ ...editingGroup, emailTime: e.target.value })} data-testid={`input-edit-group-time-${group.id}`} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Frequency</Label>
                              <Select
                                value={editingGroup.frequency || "weekly"}
                                onValueChange={(v: "weekly" | "biweekly" | "monthly") => {
                                  const lookback = v === "monthly" ? 30 : v === "biweekly" ? 14 : 7;
                                  setEditingGroup({ ...editingGroup, frequency: v, lookbackDays: lookback });
                                }}
                              >
                                <SelectTrigger data-testid={`select-edit-group-frequency-${group.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="weekly">Every week</SelectItem>
                                  <SelectItem value="biweekly">Every other week</SelectItem>
                                  <SelectItem value="monthly">Once a month (first occurrence)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Start Date</Label>
                              <Input
                                type="date"
                                value={(editingGroup as any).startDate || ""}
                                onChange={(e) => setEditingGroup({ ...editingGroup, startDate: e.target.value } as any)}
                                data-testid={`input-edit-group-start-date-${group.id}`}
                              />
                              <p className="text-xs text-muted-foreground">Emails won't send before this date (Phoenix time)</p>
                            </div>
                            <div className="space-y-2">
                              <Label>Star Filter: {editingGroup.minStars}-{editingGroup.maxStars} stars</Label>
                              <div className="flex gap-2">
                                <Select value={editingGroup.minStars.toString()} onValueChange={(v) => setEditingGroup({ ...editingGroup, minStars: parseInt(v) })}>
                                  <SelectTrigger className="w-24" data-testid={`select-edit-group-min-stars-${group.id}`}><SelectValue /></SelectTrigger>
                                  <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                                </Select>
                                <span className="self-center text-muted-foreground">to</span>
                                <Select value={editingGroup.maxStars.toString()} onValueChange={(v) => setEditingGroup({ ...editingGroup, maxStars: parseInt(v) })}>
                                  <SelectTrigger className="w-24" data-testid={`select-edit-group-max-stars-${group.id}`}><SelectValue /></SelectTrigger>
                                  <SelectContent>{[1,2,3,4,5].filter(n => n >= editingGroup.minStars).map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Review Period (days back, excluding today)</Label>
                              <Select value={(editingGroup.lookbackDays || 7).toString()} onValueChange={(v) => setEditingGroup({ ...editingGroup, lookbackDays: parseInt(v) })}>
                                <SelectTrigger className="w-32" data-testid={`select-edit-group-lookback-${group.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {[3, 7, 14, 30].map(n => <SelectItem key={n} value={n.toString()}>Last {n} days</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Delivery Format</Label>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingGroup({ ...editingGroup, outputFormat: "email" } as any)}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors ${(editingGroup as any).outputFormat !== "sheet" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted"}`}
                                  data-testid={`button-edit-group-format-email-${group.id}`}
                                >
                                  <Mail className="w-4 h-4" /> Email
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingGroup({ ...editingGroup, outputFormat: "sheet" } as any)}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors ${(editingGroup as any).outputFormat === "sheet" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted"}`}
                                  data-testid={`button-edit-group-format-sheet-${group.id}`}
                                >
                                  <Sheet className="w-4 h-4" /> Spreadsheet
                                </button>
                              </div>
                              {(editingGroup as any).outputFormat === "sheet" && (
                                <div className="space-y-2 pt-1">
                                  <Label className="text-sm text-muted-foreground">Break out tabs by</Label>
                                  <Select
                                    value={(editingGroup as any).sheetBreakout || "region"}
                                    onValueChange={(v: "region" | "location" | "none") => setEditingGroup({ ...editingGroup, sheetBreakout: v } as any)}
                                  >
                                    <SelectTrigger className="w-48" data-testid={`select-edit-group-sheet-breakout-${group.id}`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="region">Region (AZ / MD / SF)</SelectItem>
                                      <SelectItem value="location">Location (one tab each)</SelectItem>
                                      <SelectItem value="none">No breakout (all in one tab)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label>Custom Subject Line (optional — overrides the auto-generated subject)</Label>
                              <Input
                                value={editingGroup.customSubject || ""}
                                onChange={(e) => setEditingGroup({ ...editingGroup, customSubject: e.target.value })}
                                placeholder="e.g. Weekly Review Roundup — Acme Locations"
                                data-testid={`input-edit-group-subject-${group.id}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Custom Message (shown at the top of each email)</Label>
                              <Textarea
                                value={editingGroup.customMessage || ""}
                                onChange={(e) => setEditingGroup({ ...editingGroup, customMessage: e.target.value })}
                                placeholder="e.g. Hi team, here is your weekly review summary. Please action any low-star reviews within 24 hours."
                                rows={3}
                                data-testid={`textarea-edit-group-message-${group.id}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Locations in Group</Label>
                              {locationFolders.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {locationFolders.map(folder => {
                                    const active = editGroupFolderFilter.includes(folder.id);
                                    return (
                                      <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => toggleEditFolder(folder.id)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? "border-transparent text-white" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}
                                        style={active ? { backgroundColor: folder.color, borderColor: folder.color } : {}}
                                      >
                                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? "rgba(255,255,255,0.7)" : folder.color }} />
                                        {folder.name}
                                      </button>
                                    );
                                  })}
                                  {editGroupFolderFilter.length > 0 && (
                                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline ml-1" onClick={() => setEditGroupFolderFilter([])}>Clear</button>
                                  )}
                                </div>
                              )}
                              <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-3 bg-white dark:bg-gray-950">
                                {locationsByClientForEdit.length > 0 ? (
                                  locationsByClientForEdit.map(({ client, locations }) => {
                                    const groupLocationIds = editingGroup.locationIds || [];
                                    const isAllSelected = locations.every(loc => groupLocationIds.includes(loc.id));
                                    return (
                                      <div key={client.id} className="space-y-1">
                                        <div className="flex items-center gap-2 font-medium text-sm">
                                          <Checkbox
                                            id={`edit-client-all-${client.id}`}
                                            checked={isAllSelected}
                                            onCheckedChange={() => toggleAllLocationsForClient(client.id, groupLocationIds, (ids) => setEditingGroup({ ...editingGroup, locationIds: ids }))}
                                            data-testid={`checkbox-edit-client-all-${client.id}`}
                                          />
                                          <Label htmlFor={`edit-client-all-${client.id}`} className="cursor-pointer">{client.name}</Label>
                                          <span className="text-xs text-muted-foreground">({locations.filter(loc => groupLocationIds.includes(loc.id)).length}/{locations.length})</span>
                                        </div>
                                        <div className="ml-6 space-y-1">
                                          {locations.map((location) => (
                                            <div key={location.id} className="flex items-center gap-2">
                                              <Checkbox
                                                id={`edit-location-${location.id}`}
                                                checked={groupLocationIds.includes(location.id)}
                                                onCheckedChange={() => toggleLocationInGroup(location.id, groupLocationIds, (ids) => setEditingGroup({ ...editingGroup, locationIds: ids }))}
                                                data-testid={`checkbox-edit-location-${location.id}`}
                                              />
                                              <Label htmlFor={`edit-location-${location.id}`} className="text-sm text-muted-foreground cursor-pointer font-normal">{location.name}</Label>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-sm text-muted-foreground text-center py-4 italic">
                                    {editGroupFolderFilter.length > 0 ? "No locations in the selected folders." : "No locations available. Please ensure your business profiles are synced."}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => updateGroupMutation.mutate({ id: group.id, updates: editingGroup })} disabled={updateGroupMutation.isPending} data-testid={`button-save-edit-group-${group.id}`}>
                                <Save className="w-4 h-4 mr-1" /> Save
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingGroup(null)} data-testid={`button-cancel-edit-group-${group.id}`}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{group.name}</h4>
                                  <Badge variant={group.isEnabled ? "default" : "secondary"}>{group.isEnabled ? "Active" : "Paused"}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{group.recipientEmail}</p>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setTestingGroupId(group.id);
                                    setTestEmailOverride(group.recipientEmail);
                                  }}
                                  title="Send a test email now"
                                  data-testid={`button-test-email-${group.id}`}
                                >
                                  <Send className="w-4 h-4" />
                                  <span className="ml-1 text-xs">Test</span>
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingGroup({ ...group }); setEditGroupFolderFilter([]); }} data-testid={`button-edit-group-${group.id}`}>
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteGroupMutation.mutate(group.id)} data-testid={`button-delete-group-${group.id}`}>
                                  <Trash2 className="w-4 h-4 text-red-500" />
                                </Button>
                              </div>
                            </div>
                            {testingGroupId === group.id && (
                              <div className="flex items-center gap-2 mt-2 p-3 bg-muted/50 border border-border rounded-lg">
                                <Label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">Send to:</Label>
                                <Input
                                  type="email"
                                  value={testEmailOverride}
                                  onChange={(e) => setTestEmailOverride(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && sendTestEmailMutation.mutate({ id: group.id, email: testEmailOverride })}
                                  className="h-7 text-sm flex-1"
                                  placeholder="override@example.com"
                                  data-testid={`input-test-email-override-${group.id}`}
                                  autoFocus
                                />
                                <Button
                                  size="sm"
                                  className="h-7 px-3 text-xs"
                                  onClick={() => sendTestEmailMutation.mutate({ id: group.id, email: testEmailOverride })}
                                  disabled={sendingTestGroupId === group.id || !testEmailOverride.trim()}
                                  data-testid={`button-confirm-test-email-${group.id}`}
                                >
                                  {sendingTestGroupId === group.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Send"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setTestingGroupId(null)}>Cancel</Button>
                              </div>
                            )}
                            <div className="text-sm text-muted-foreground">
                              <span>
                                {group.frequency === "monthly"
                                  ? `Monthly (first ${getDayName(group.emailDay)}) at ${group.emailTime}`
                                  : group.frequency === "biweekly"
                                  ? `Every other ${getDayName(group.emailDay)} at ${group.emailTime}`
                                  : `Every ${getDayName(group.emailDay)} at ${group.emailTime}`}
                              </span>
                              <span className="mx-2">•</span>
                              <span>{group.minStars}-{group.maxStars} stars</span>
                              <span className="mx-2">•</span>
                              <span>Last {group.lookbackDays || 7} days</span>
                              <span className="mx-2">•</span>
                              <span>{group.locationIds.length} location{group.locationIds.length !== 1 ? 's' : ''}</span>
                              {(group as any).startDate && (
                                <>
                                  <span className="mx-2">•</span>
                                  <span>Starts {new Date((group as any).startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {group.locationIds.slice(0, 5).map(id => {
                                const location = allLocations.find(l => l.id === id);
                                return location ? <Badge key={id} variant="outline" className="text-xs">{location.name}</Badge> : null;
                              })}
                              {group.locationIds.length > 5 && <Badge variant="outline" className="text-xs">+{group.locationIds.length - 5} more</Badge>}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Create New Group */}
                {isCreatingGroup ? (
                  <div className="border-2 border-dashed border-primary/50 rounded-lg p-4 space-y-4">
                    <h4 className="font-medium flex items-center gap-2"><Plus className="w-4 h-4" /> New Email Group</h4>
                    <div className="space-y-2">
                      <Label>Group Name</Label>
                      <Input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="e.g., Low-Star Alerts" data-testid="input-new-group-name" />
                    </div>
                    <div className="space-y-2">
                      <Label>Recipient Emails (comma separated)</Label>
                      <Input value={newGroup.recipientEmail} onChange={(e) => setNewGroup({ ...newGroup, recipientEmail: e.target.value })} placeholder="email1@example.com, email2@example.com" data-testid="input-new-group-email" />
                    </div>
                    <div className="space-y-2">
                      <Label>CC Emails (comma separated, optional)</Label>
                      <Input value={newGroup.ccEmail || ""} onChange={(e) => setNewGroup({ ...newGroup, ccEmail: e.target.value })} placeholder="cc1@example.com, cc2@example.com" data-testid="input-new-group-cc" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Day</Label>
                        <Select value={newGroup.emailDay} onValueChange={(v) => setNewGroup({ ...newGroup, emailDay: v })}>
                          <SelectTrigger data-testid="select-new-group-day"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                              <SelectItem key={i} value={i.toString()}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Time</Label>
                        <Input type="time" value={newGroup.emailTime} onChange={(e) => setNewGroup({ ...newGroup, emailTime: e.target.value })} data-testid="input-new-group-time" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Select
                        value={newGroup.frequency}
                        onValueChange={(v: "weekly" | "biweekly" | "monthly") => {
                          const lookback = v === "monthly" ? 30 : v === "biweekly" ? 14 : 7;
                          setNewGroup({ ...newGroup, frequency: v, lookbackDays: lookback });
                        }}
                      >
                        <SelectTrigger data-testid="select-new-group-frequency"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Every week</SelectItem>
                          <SelectItem value="biweekly">Every other week</SelectItem>
                          <SelectItem value="monthly">Once a month (first occurrence)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input
                        type="date"
                        value={newGroup.startDate}
                        onChange={(e) => setNewGroup({ ...newGroup, startDate: e.target.value })}
                        data-testid="input-new-group-start-date"
                      />
                      <p className="text-xs text-muted-foreground">First email won't send before this date (Phoenix time). Defaults to today.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Star Filter</Label>
                      <div className="flex gap-2">
                        <Select value={newGroup.minStars.toString()} onValueChange={(v) => setNewGroup({ ...newGroup, minStars: parseInt(v) })}>
                          <SelectTrigger className="w-24" data-testid="select-new-group-min-stars"><SelectValue /></SelectTrigger>
                          <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                        </Select>
                        <span className="self-center text-muted-foreground">to</span>
                        <Select value={newGroup.maxStars.toString()} onValueChange={(v) => setNewGroup({ ...newGroup, maxStars: parseInt(v) })}>
                          <SelectTrigger className="w-24" data-testid="select-new-group-max-stars"><SelectValue /></SelectTrigger>
                          <SelectContent>{[1,2,3,4,5].filter(n => n >= newGroup.minStars).map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Review Period (days back, excluding today)</Label>
                      <Select value={newGroup.lookbackDays.toString()} onValueChange={(v) => setNewGroup({ ...newGroup, lookbackDays: parseInt(v) })}>
                        <SelectTrigger className="w-32" data-testid="select-new-group-lookback"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[3, 7, 14, 30].map(n => <SelectItem key={n} value={n.toString()}>Last {n} days</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Delivery Format</Label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setNewGroup({ ...newGroup, outputFormat: "email" })}
                          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors ${newGroup.outputFormat === "email" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted"}`}
                          data-testid="button-new-group-format-email"
                        >
                          <Mail className="w-4 h-4" /> Email
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewGroup({ ...newGroup, outputFormat: "sheet" })}
                          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors ${newGroup.outputFormat === "sheet" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted"}`}
                          data-testid="button-new-group-format-sheet"
                        >
                          <Sheet className="w-4 h-4" /> Spreadsheet
                        </button>
                      </div>
                      {newGroup.outputFormat === "sheet" && (
                        <div className="space-y-2 pt-1">
                          <Label className="text-sm text-muted-foreground">Break out tabs by</Label>
                          <Select value={newGroup.sheetBreakout} onValueChange={(v: "region" | "location" | "none") => setNewGroup({ ...newGroup, sheetBreakout: v })}>
                            <SelectTrigger className="w-48" data-testid="select-new-group-sheet-breakout"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="region">Region (AZ / MD / SF)</SelectItem>
                              <SelectItem value="location">Location (one tab each)</SelectItem>
                              <SelectItem value="none">No breakout (all in one tab)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Custom Subject Line (optional — overrides the auto-generated subject)</Label>
                      <Input
                        value={newGroup.customSubject}
                        onChange={(e) => setNewGroup({ ...newGroup, customSubject: e.target.value })}
                        placeholder="e.g. Weekly Review Roundup — Acme Locations"
                        data-testid="input-new-group-subject"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Custom Message (shown at the top of each {newGroup.outputFormat === "sheet" ? "spreadsheet email" : "email"})</Label>
                      <Textarea
                        value={newGroup.customMessage}
                        onChange={(e) => setNewGroup({ ...newGroup, customMessage: e.target.value })}
                        placeholder="e.g. Hi team, here is your weekly review summary. Please action any low-star reviews within 24 hours."
                        rows={3}
                        data-testid="textarea-new-group-message"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Select Locations</Label>
                      {locationFolders.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {locationFolders.map(folder => {
                            const active = newGroupFolderFilter.includes(folder.id);
                            return (
                              <button
                                key={folder.id}
                                type="button"
                                onClick={() => toggleNewFolder(folder.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? "border-transparent text-white" : "border-border text-muted-foreground hover:text-foreground bg-transparent"}`}
                                style={active ? { backgroundColor: folder.color, borderColor: folder.color } : {}}
                              >
                                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? "rgba(255,255,255,0.7)" : folder.color }} />
                                {folder.name}
                              </button>
                            );
                          })}
                          {newGroupFolderFilter.length > 0 && (
                            <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline ml-1" onClick={() => setNewGroupFolderFilter([])}>Clear</button>
                          )}
                        </div>
                      )}
                      <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-3 bg-white dark:bg-gray-950">
                        {locationsByClientForNew.length > 0 ? (
                          locationsByClientForNew.map(({ client, locations }) => (
                            <div key={client.id} className="space-y-1">
                              <div className="flex items-center gap-2 font-medium text-sm">
                                <Checkbox
                                  id={`new-client-all-${client.id}`}
                                  checked={locations.every(loc => newGroup.locationIds.includes(loc.id))}
                                  onCheckedChange={() => toggleAllLocationsForClient(client.id, newGroup.locationIds, (ids) => setNewGroup({ ...newGroup, locationIds: ids }))}
                                  data-testid={`checkbox-new-client-all-${client.id}`}
                                />
                                <Label htmlFor={`new-client-all-${client.id}`} className="cursor-pointer">{client.name}</Label>
                                <span className="text-xs text-muted-foreground">({locations.filter(loc => newGroup.locationIds.includes(loc.id)).length}/{locations.length})</span>
                              </div>
                              <div className="ml-6 space-y-1">
                                {locations.map((location) => (
                                  <div key={location.id} className="flex items-center gap-2">
                                    <Checkbox
                                      id={`new-location-${location.id}`}
                                      checked={newGroup.locationIds.includes(location.id)}
                                      onCheckedChange={() => toggleLocationInGroup(location.id, newGroup.locationIds, (ids) => setNewGroup({ ...newGroup, locationIds: ids }))}
                                      data-testid={`checkbox-new-location-${location.id}`}
                                    />
                                    <Label htmlFor={`new-location-${location.id}`} className="text-sm text-muted-foreground cursor-pointer font-normal">{location.name}</Label>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground text-center py-4 italic">
                            {newGroupFolderFilter.length > 0 ? "No locations in the selected folders." : "No locations available. Please ensure your business profiles are synced."}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{newGroup.locationIds.length} location{newGroup.locationIds.length !== 1 ? 's' : ''} selected</p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => createGroupMutation.mutate(newGroup)} disabled={createGroupMutation.isPending || !newGroup.name || !newGroup.recipientEmail || newGroup.locationIds.length === 0} data-testid="button-create-group">
                        <Save className="w-4 h-4 mr-1" /> Create Group
                      </Button>
                      <Button variant="outline" onClick={() => setIsCreatingGroup(false)} data-testid="button-cancel-new-group">Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setIsCreatingGroup(true)} data-testid="button-add-email-group">
                    <Plus className="w-4 h-4 mr-2" /> Add Email Group
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Security */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Security
                </CardTitle>
                <CardDescription>
                  Manage your security settings and preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Two-Factor Authentication</Label>
                    <p className="text-sm text-muted-foreground">
                      Add an extra layer of security to your account
                    </p>
                  </div>
                  <Button variant="outline" size="sm">Enable</Button>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Session Timeout</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sign out after inactivity
                    </p>
                  </div>
                  <Select defaultValue="24">
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 hour</SelectItem>
                      <SelectItem value="8">8 hours</SelectItem>
                      <SelectItem value="24">24 hours</SelectItem>
                      <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

              </CardContent>
            </Card>

            {/* Appearance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  Appearance
                </CardTitle>
                <CardDescription>
                  Customize the look and feel of your dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Theme</Label>
                  <Select defaultValue="light">
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Compact Mode</Label>
                  <div className="flex items-center space-x-2">
                    <Switch id="compact-mode" />
                    <Label htmlFor="compact-mode" className="text-sm text-muted-foreground">
                      Use compact layout to fit more content
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Location Sync Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Location Auto-Sync
                </CardTitle>
                <CardDescription>
                  All location names, addresses, phone numbers, and hours are automatically pulled from Google Business Profile every 2 weeks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground font-medium uppercase mb-1">Last Synced</p>
                    <p className="text-sm font-semibold" data-testid="text-last-location-sync">
                      {settings?.lastLocationSyncAt
                        ? new Date(settings.lastLocationSyncAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Not yet run'}
                    </p>
                    {settings?.lastLocationSyncAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(settings.lastLocationSyncAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                      </p>
                    )}
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground font-medium uppercase mb-1">Next Sync</p>
                    <p className="text-sm font-semibold" data-testid="text-next-location-sync">
                      {settings?.nextLocationSyncAt
                        ? new Date(settings.nextLocationSyncAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </p>
                    {settings?.nextLocationSyncAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(settings.nextLocationSyncAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5 flex-shrink-0" />
                  You can also trigger an immediate sync anytime from the Dashboard using the Sync Locations button.
                </p>
              </CardContent>
            </Card>

            {/* Save Button — General tab only */}
            <div className="flex justify-end">
              <Button 
                onClick={handleSave}
                disabled={saveSettingsMutation.isPending || isLoading}
                data-testid="button-save-settings"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveSettingsMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>

            </>}

            {/* ── Developer Tab ── */}
            {activeTab === "developer" && <>

            {/* Developer Mode */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="w-5 h-5" />
                  Developer Mode
                </CardTitle>
                <CardDescription>
                  Shows a banner across the top of the app while active. Disabled by logging out and re-authenticating.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Enable Developer Mode</Label>
                    <p className="text-sm text-muted-foreground">Activates the amber banner and unlocks dev tools below.</p>
                  </div>
                  <Switch
                    checked={devMode}
                    onCheckedChange={setDevMode}
                    data-testid="switch-developer-mode"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Google Auth Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Unlink className="w-5 h-5" />
                  Google Authentication
                </CardTitle>
                <CardDescription>
                  Control the Google OAuth connection without affecting your app session. Useful for testing auth-failure states.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <div>
                      <p className="font-medium text-sm">Google Business Profile API</p>
                      <p className="text-xs text-muted-foreground">
                        {clients[0]?.userId || 'your Google account'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Connected</Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Revoke Google Auth</Label>
                    <p className="text-sm text-muted-foreground">
                      Clears OAuth tokens from memory. Your app session stays active — API calls will fail until you re-authenticate.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      // Force-enable dev mode SYNCHRONOUSLY before the mutation fires
                      // so App.tsx's auth guard sees the flag before re-rendering
                      localStorage.setItem("bizbuddy_devmode", "true");
                      setDevMode(true);
                      revokeGoogleMutation.mutate();
                    }}
                    disabled={revokeGoogleMutation.isPending}
                    data-testid="button-revoke-google-auth"
                  >
                    <Unlink className="w-4 h-4 mr-2" />
                    {revokeGoogleMutation.isPending ? "Revoking..." : "Revoke Auth"}
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Force Full Re-login</Label>
                    <p className="text-sm text-muted-foreground">
                      Clears session and sends you through Google OAuth from scratch. Use this to fully reset.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleForceRelogin}
                    disabled={logoutMutation.isPending}
                    data-testid="button-force-relogin"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    {logoutMutation.isPending ? "Logging out..." : "Re-login"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Error Modal Test */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Error Simulation
                </CardTitle>
                <CardDescription>
                  Trigger UI error states to verify they display correctly before a real failure occurs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Auth Failure Modal</Label>
                    <p className="text-sm text-muted-foreground">Simulates a 401 Unauthorized error from the API.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showApiError(
                      "Failed to Update Hours",
                      "Request failed with status 401: Unauthorized. The OAuth token has expired or been revoked."
                    )}
                    data-testid="button-test-error-modal"
                  >
                    Test Error Modal
                  </Button>
                </div>
              </CardContent>
            </Card>

            </>}
          </div>
        </div>
      </main>
    </div>
  );
}