import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, MapPin, Clock, FileText, Copy, Check, ExternalLink, 
  Trash2, Edit2, ChevronDown, ChevronUp, Building2
} from "lucide-react";
import { PlatformSwitchButton } from "@/components/platform-switch-button";
import type { AppleLocation } from "@shared/schema";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface RegularHours {
  [key: string]: { open: string; close: string; closed?: boolean };
}

function formatHoursForExport(location: AppleLocation): string {
  const hours = location.regularHours as RegularHours | null;
  if (!hours) return "Hours not set";
  
  return DAYS.map(day => {
    const dayHours = hours[day.toLowerCase()];
    if (!dayHours || dayHours.closed) return `${day}: Closed`;
    return `${day}: ${dayHours.open} - ${dayHours.close}`;
  }).join("\n");
}

function HoursEditor({ 
  hours, 
  onChange 
}: { 
  hours: RegularHours; 
  onChange: (hours: RegularHours) => void;
}) {
  const updateDay = (day: string, field: "open" | "close" | "closed", value: string | boolean) => {
    const dayKey = day.toLowerCase();
    const current = hours[dayKey] || { open: "09:00", close: "17:00", closed: false };
    onChange({
      ...hours,
      [dayKey]: { ...current, [field]: value }
    });
  };

  return (
    <div className="space-y-2">
      {DAYS.map(day => {
        const dayKey = day.toLowerCase();
        const dayHours = hours[dayKey] || { open: "09:00", close: "17:00", closed: false };
        return (
          <div key={day} className="flex items-center gap-3">
            <span className="w-24 text-sm font-medium">{day}</span>
            <Checkbox
              checked={!dayHours.closed}
              onCheckedChange={(checked) => updateDay(day, "closed", !checked)}
              data-testid={`checkbox-${dayKey}-open`}
            />
            <span className="text-xs text-gray-500">Open</span>
            {!dayHours.closed && (
              <>
                <Input
                  type="time"
                  value={dayHours.open}
                  onChange={(e) => updateDay(day, "open", e.target.value)}
                  className="w-28"
                  data-testid={`input-${dayKey}-open`}
                />
                <span>to</span>
                <Input
                  type="time"
                  value={dayHours.close}
                  onChange={(e) => updateDay(day, "close", e.target.value)}
                  className="w-28"
                  data-testid={`input-${dayKey}-close`}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AppleMaps() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBulkHoursModal, setShowBulkHoursModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<AppleLocation | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    city: "",
    phone: "",
    website: "",
    description: "",
    regularHours: {} as RegularHours
  });

  const [bulkHours, setBulkHours] = useState<RegularHours>({
    monday: { open: "09:00", close: "17:00", closed: false },
    tuesday: { open: "09:00", close: "17:00", closed: false },
    wednesday: { open: "09:00", close: "17:00", closed: false },
    thursday: { open: "09:00", close: "17:00", closed: false },
    friday: { open: "09:00", close: "17:00", closed: false },
    saturday: { open: "10:00", close: "16:00", closed: false },
    sunday: { open: "10:00", close: "16:00", closed: true }
  });

  const { data: locations = [], isLoading } = useQuery<AppleLocation[]>({
    queryKey: ["/api/apple-locations"]
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/apple-locations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apple-locations"] });
      setShowAddModal(false);
      resetForm();
      toast({ title: "Location added" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof formData> }) => 
      apiRequest("PUT", `/api/apple-locations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apple-locations"] });
      setShowEditModal(false);
      setEditingLocation(null);
      toast({ title: "Location updated" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/apple-locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apple-locations"] });
      toast({ title: "Location deleted" });
    }
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: (data: { ids: string[]; updates: { regularHours: RegularHours } }) =>
      apiRequest("POST", "/api/apple-locations/bulk-update", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apple-locations"] });
      setShowBulkHoursModal(false);
      setSelectedIds(new Set());
      toast({ title: `Updated hours for ${selectedIds.size} locations` });
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      address: "",
      city: "",
      phone: "",
      website: "",
      description: "",
      regularHours: {}
    });
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === locations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(locations.map(l => l.id)));
    }
  };

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedCards);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedCards(newSet);
  };

  const openEditModal = (location: AppleLocation) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address: location.address || "",
      city: location.city || "",
      phone: location.phone || "",
      website: location.website || "",
      description: location.description || "",
      regularHours: (location.regularHours as RegularHours) || {}
    });
    setShowEditModal(true);
  };

  const copyToClipboard = async (text: string, locationId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(locationId);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const getExportData = () => {
    const selected = locations.filter(l => selectedIds.has(l.id));
    return selected.map(l => ({
      name: l.name,
      address: l.address,
      city: l.city,
      hours: formatHoursForExport(l),
      description: l.description
    }));
  };

  const copyAllExportData = async () => {
    const data = getExportData();
    const text = data.map(d => 
      `=== ${d.name} ===\nAddress: ${d.address || "N/A"}\nCity: ${d.city || "N/A"}\n\nHours:\n${d.hours}\n\nDescription:\n${d.description || "N/A"}`
    ).join("\n\n" + "=".repeat(50) + "\n\n");
    await navigator.clipboard.writeText(text);
    toast({ title: "All location data copied to clipboard" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="pl-64">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-black flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-white" />
                </div>
                Apple Maps Locations
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Manage your Apple Business Connect listings
              </p>
            </div>
            <div className="flex items-center gap-3">
              <PlatformSwitchButton />
              <Button onClick={() => setShowAddModal(true)} data-testid="button-add-location">
                <Plus className="w-4 h-4 mr-2" />
                Add Location
              </Button>
            </div>
          </div>

          {locations.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm p-4 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Checkbox
                  checked={selectedIds.size === locations.length && locations.length > 0}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {selectedIds.size} of {locations.length} selected
                </span>
              </div>
              {selectedIds.size > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowBulkHoursModal(true)}
                    data-testid="button-bulk-hours"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Bulk Edit Hours
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowExportModal(true)}
                    data-testid="button-export"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Export for Apple
                  </Button>
                </div>
              )}
            </div>
          )}

          {locations.length === 0 ? (
            <Card className="text-center py-16">
              <CardContent>
                <MapPin className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  No Apple Maps locations yet
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                  Add your business locations to manage their hours, titles, and descriptions for Apple Business Connect.
                </p>
                <Button onClick={() => setShowAddModal(true)} data-testid="button-add-first-location">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Location
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {locations.map(location => (
                <Card key={location.id} className="overflow-hidden">
                  <div className="flex items-start p-4">
                    <Checkbox
                      checked={selectedIds.has(location.id)}
                      onCheckedChange={() => toggleSelect(location.id)}
                      className="mt-1 mr-4"
                      data-testid={`checkbox-location-${location.id}`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {location.name}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {location.address}{location.city ? `, ${location.city}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpand(location.id)}
                            data-testid={`button-expand-${location.id}`}
                          >
                            {expandedCards.has(location.id) ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(location)}
                            data-testid={`button-edit-${location.id}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMutation.mutate(location.id)}
                            data-testid={`button-delete-${location.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </div>

                      {expandedCards.has(location.id) && (
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Business Hours
                              </h4>
                              <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded-lg whitespace-pre-wrap">
                                {formatHoursForExport(location)}
                              </pre>
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() => copyToClipboard(formatHoursForExport(location), `hours-${location.id}`)}
                                data-testid={`button-copy-hours-${location.id}`}
                              >
                                {copiedId === `hours-${location.id}` ? (
                                  <Check className="w-3 h-3 mr-1" />
                                ) : (
                                  <Copy className="w-3 h-3 mr-1" />
                                )}
                                Copy Hours
                              </Button>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Description
                              </h4>
                              <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                                {location.description || "No description set"}
                              </p>
                              {location.description && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-2"
                                  onClick={() => copyToClipboard(location.description || "", `desc-${location.id}`)}
                                  data-testid={`button-copy-desc-${location.id}`}
                                >
                                  {copiedId === `desc-${location.id}` ? (
                                    <Check className="w-3 h-3 mr-1" />
                                  ) : (
                                    <Copy className="w-3 h-3 mr-1" />
                                  )}
                                  Copy Description
                                </Button>
                              )}
                            </div>
                          </div>
                          {location.lastSyncedAt && (
                            <p className="text-xs text-gray-500">
                              Last synced: {new Date(location.lastSyncedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                  Sync with Apple Business Connect
                </h4>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Apple doesn't provide a public API. Use the export feature to copy your data, then paste it into your Apple Business Connect dashboard.
                </p>
                <a
                  href="https://businessconnect.apple.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline mt-2"
                >
                  Open Apple Business Connect
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Apple Maps Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Business Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Your Business Name"
                data-testid="input-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Address</label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main St"
                  data-testid="input-address"
                />
              </div>
              <div>
                <label className="text-sm font-medium">City</label>
                <Input
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="Phoenix"
                  data-testid="input-city"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  data-testid="input-phone"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Website</label>
                <Input
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  placeholder="https://example.com"
                  data-testid="input-website"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your business..."
                rows={3}
                data-testid="input-description"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">Business Hours</label>
              <HoursEditor
                hours={formData.regularHours}
                onChange={(hours) => setFormData({ ...formData, regularHours: hours })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(formData)}
              disabled={!formData.name || createMutation.isPending}
              data-testid="button-save-location"
            >
              {createMutation.isPending ? "Adding..." : "Add Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Business Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-edit-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Address</label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  data-testid="input-edit-address"
                />
              </div>
              <div>
                <label className="text-sm font-medium">City</label>
                <Input
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  data-testid="input-edit-city"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  data-testid="input-edit-phone"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Website</label>
                <Input
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  data-testid="input-edit-website"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                data-testid="input-edit-description"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">Business Hours</label>
              <HoursEditor
                hours={formData.regularHours}
                onChange={(hours) => setFormData({ ...formData, regularHours: hours })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => editingLocation && updateMutation.mutate({ id: editingLocation.id, data: formData })}
              disabled={!formData.name || updateMutation.isPending}
              data-testid="button-update-location"
            >
              {updateMutation.isPending ? "Updating..." : "Update Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkHoursModal} onOpenChange={setShowBulkHoursModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Edit Hours ({selectedIds.size} locations)</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Set the same hours for all {selectedIds.size} selected locations.
            </p>
            <HoursEditor hours={bulkHours} onChange={setBulkHours} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkHoursModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkUpdateMutation.mutate({ 
                ids: Array.from(selectedIds), 
                updates: { regularHours: bulkHours } 
              })}
              disabled={bulkUpdateMutation.isPending}
              data-testid="button-apply-bulk-hours"
            >
              {bulkUpdateMutation.isPending ? "Applying..." : "Apply to All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export for Apple Business Connect</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Copy this data and paste it into Apple Business Connect for each location.
            </p>
            <Button onClick={copyAllExportData} className="mb-4" data-testid="button-copy-all">
              <Copy className="w-4 h-4 mr-2" />
              Copy All Location Data
            </Button>
            <div className="space-y-4">
              {getExportData().map((data, idx) => (
                <Card key={idx}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{data.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <span className="text-xs font-medium text-gray-500">Address</span>
                      <p className="text-sm">{data.address || "N/A"}{data.city ? `, ${data.city}` : ""}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500">Hours</span>
                      <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded mt-1 whitespace-pre-wrap">
                        {data.hours}
                      </pre>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500">Description</span>
                      <p className="text-sm">{data.description || "N/A"}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <DialogFooter>
            <a
              href="https://businessconnect.apple.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto"
            >
              <Button variant="outline">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Apple Business Connect
              </Button>
            </a>
            <Button onClick={() => setShowExportModal(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
