import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiUrl } from "@/lib/queryClient";
import { useJobProgressContext } from "@/contexts/job-progress-context";
import { Clock, Copy, Loader2, MapPin } from "lucide-react";
import type { ClientLocation, LocationFolder } from "@shared/schema";

interface HoursEditorModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  selectedLocationIds: string[];
}

interface DayHours {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TEMPLATES = {
  restaurant: {
    name: "Restaurant Hours",
    hours: {
      monday: { isOpen: true, openTime: "11:00", closeTime: "21:00" },
      tuesday: { isOpen: true, openTime: "11:00", closeTime: "21:00" },
      wednesday: { isOpen: true, openTime: "11:00", closeTime: "21:00" },
      thursday: { isOpen: true, openTime: "11:00", closeTime: "21:00" },
      friday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
      saturday: { isOpen: true, openTime: "11:00", closeTime: "22:00" },
      sunday: { isOpen: true, openTime: "12:00", closeTime: "20:00" },
    }
  },
  retail: {
    name: "Retail Store",
    hours: {
      monday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
      tuesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
      wednesday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
      thursday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
      friday: { isOpen: true, openTime: "09:00", closeTime: "20:00" },
      saturday: { isOpen: true, openTime: "09:00", closeTime: "18:00" },
      sunday: { isOpen: true, openTime: "11:00", closeTime: "17:00" },
    }
  },
  professional: {
    name: "Professional Services",
    hours: {
      monday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      tuesday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      wednesday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      thursday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      friday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
      saturday: { isOpen: false, openTime: "09:00", closeTime: "12:00" },
      sunday: { isOpen: false, openTime: "09:00", closeTime: "12:00" },
    }
  }
};

export function HoursEditorModal({ open, onClose, clientId, selectedLocationIds: initialSelectedIds }: HoursEditorModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { startJobProgress } = useJobProgressContext();

  const [hours, setHours] = useState<Record<string, DayHours>>({
    monday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    tuesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    wednesday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    thursday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    friday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    saturday: { isOpen: true, openTime: "09:00", closeTime: "17:00" },
    sunday: { isOpen: false, openTime: "09:00", closeTime: "17:00" },
  });

  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [folderFilter, setFolderFilter] = useState<string>("all");

  // Fetch all locations for this client
  const { data: allLocations = [], isLoading: isLoadingLocations } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", clientId, "locations"],
    enabled: !!clientId && open,
  });

  // Fetch folders
  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
    enabled: open,
  });

  // Fetch locations for selected folder
  const { data: folderLocations = [], isLoading: isFolderLocationsLoading } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", folderFilter, "locations"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/folders/${folderFilter}/locations`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch folder locations");
      return response.json();
    },
    enabled: folderFilter !== "all" && open,
  });

  // Filter locations based on folder selection
  const displayedLocations = folderFilter === "all" 
    ? allLocations 
    : allLocations.filter(location => folderLocations.some(fl => fl.id === location.id));

  // Reset selections when modal opens or initial selections change
  useEffect(() => {
    if (open) {
      setSelectedLocationIds(new Set(initialSelectedIds));
      setFolderFilter("all");
    }
  }, [open, initialSelectedIds]);

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(locationId)) {
        newSet.delete(locationId);
      } else {
        newSet.add(locationId);
      }
      return newSet;
    });
  };

  const selectAllDisplayed = () => {
    const newSet = new Set(selectedLocationIds);
    displayedLocations.forEach(loc => newSet.add(loc.id));
    setSelectedLocationIds(newSet);
  };

  const deselectAllDisplayed = () => {
    const displayedIds = new Set(displayedLocations.map(loc => loc.id));
    const newSet = new Set(Array.from(selectedLocationIds).filter(id => !displayedIds.has(id)));
    setSelectedLocationIds(newSet);
  };

  const createHoursJobMutation = useMutation({
    mutationFn: async (hoursData: any) => {
      return await apiRequest('POST', '/api/jobs/create-hours', {
        clientId,
        locationIds: Array.from(selectedLocationIds),
        scheduleData: hoursData,
      });
    },
    onSuccess: (response: any) => {
      // Trigger global progress toast
      startJobProgress(response.id, "hours");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update hours",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const updateDayHours = (day: string, field: keyof DayHours, value: string | boolean) => {
    setHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value }
    }));
  };

  const applyTemplate = (templateKey: keyof typeof TEMPLATES) => {
    setHours(TEMPLATES[templateKey].hours);
    toast({
      title: "Template Applied",
      description: `Applied ${TEMPLATES[templateKey].name} template`,
    });
  };

  const copyMondayToWeekdays = () => {
    const mondayHours = hours.monday;
    setHours(prev => ({
      ...prev,
      tuesday: { ...mondayHours },
      wednesday: { ...mondayHours },
      thursday: { ...mondayHours },
      friday: { ...mondayHours },
    }));
    toast({
      title: "Hours Copied",
      description: "Applied Monday hours to all weekdays",
    });
  };

  const handleSubmit = () => {
    if (selectedLocationIds.size === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location",
        variant: "destructive",
      });
      return;
    }

    // Wrap hours in regularHours to match expected data structure
    createHoursJobMutation.mutate({ regularHours: hours });
  };

  const handleClose = () => {
    setSelectedLocationIds(new Set(initialSelectedIds));
    setFolderFilter("all");
    onClose();
  };

  const generateTimeOptions = () => {
    const times = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute of ['00', '30']) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute}`;
        const displayTime = new Date(`2000-01-01T${timeStr}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        times.push({ value: timeStr, label: displayTime });
      }
    }
    return times;
  };

  const timeOptions = generateTimeOptions();

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Edit Business Hours
          </DialogTitle>
          <DialogDescription>
            Set business hours that will be applied to {selectedLocationIds.size} selected location{selectedLocationIds.size !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Target Locations Selector */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Target Locations *</Label>
            
            {/* Folder Filter */}
            <div className="flex items-center gap-2">
              <Select value={folderFilter} onValueChange={setFolderFilter}>
                <SelectTrigger className="w-full" data-testid="select-folder-filter-hours">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {displayedLocations.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllDisplayed}
                    data-testid="button-select-all-hours"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deselectAllDisplayed}
                    data-testid="button-deselect-all-hours"
                  >
                    Deselect All
                  </Button>
                </div>
              )}
            </div>

            {/* Location List */}
            {isLoadingLocations || (isFolderLocationsLoading && folderFilter !== "all") ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-4 space-y-2">
                  {displayedLocations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No locations found</p>
                    </div>
                  ) : (
                    displayedLocations.map((location) => (
                      <div
                        key={location.id}
                        className="flex items-center space-x-3 p-2 hover:bg-muted rounded-md"
                      >
                        <Checkbox
                          checked={selectedLocationIds.has(location.id)}
                          onCheckedChange={() => toggleLocation(location.id)}
                          data-testid={`checkbox-hours-location-${location.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{location.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {location.city || location.address || 'No address'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
            <p className="text-xs text-muted-foreground">
              {selectedLocationIds.size} location{selectedLocationIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>

          {/* Templates */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Quick Templates</Label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(TEMPLATES).map(([key, template]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => applyTemplate(key as keyof typeof TEMPLATES)}
                  data-testid={`button-template-${key}`}
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Quick Actions</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={copyMondayToWeekdays}
              className="flex items-center gap-2"
              data-testid="button-copy-monday"
            >
              <Copy className="w-4 h-4" />
              Copy Monday to Weekdays
            </Button>
          </div>

          {/* Hours Editor */}
          <div className="space-y-4">
            <Label className="text-sm font-medium">Weekly Schedule</Label>
            <div className="space-y-3">
              {DAYS.map((day, index) => (
                <div key={day} className="grid grid-cols-4 gap-4 items-center p-3 border rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={hours[day].isOpen}
                      onCheckedChange={(checked) => updateDayHours(day, 'isOpen', checked)}
                      data-testid={`switch-${day}-open`}
                    />
                    <Label className="text-sm font-medium min-w-[80px]">
                      {DAY_LABELS[index]}
                    </Label>
                  </div>
                  
                  {hours[day].isOpen ? (
                    <>
                      <Select
                        value={hours[day].openTime}
                        onValueChange={(value) => updateDayHours(day, 'openTime', value)}
                      >
                        <SelectTrigger data-testid={`select-${day}-open`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map(time => (
                            <SelectItem key={time.value} value={time.value}>
                              {time.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      <div className="text-center text-sm text-muted-foreground">to</div>
                      
                      <Select
                        value={hours[day].closeTime}
                        onValueChange={(value) => updateDayHours(day, 'closeTime', value)}
                      >
                        <SelectTrigger data-testid={`select-${day}-close`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map(time => (
                            <SelectItem key={time.value} value={time.value}>
                              {time.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <div className="col-span-3 text-sm text-muted-foreground pl-4">
                      Closed
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <Label className="text-sm font-medium mb-3 block">Preview</Label>
            <div className="space-y-1">
              {DAYS.map((day, index) => (
                <div key={day} className="flex justify-between text-sm">
                  <span className="font-medium">{DAY_LABELS[index]}</span>
                  <span className="text-muted-foreground">
                    {hours[day].isOpen 
                      ? `${timeOptions.find(t => t.value === hours[day].openTime)?.label} - ${timeOptions.find(t => t.value === hours[day].closeTime)?.label}`
                      : 'Closed'
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createHoursJobMutation.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createHoursJobMutation.isPending}
            data-testid="button-apply-hours"
          >
            {createHoursJobMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 mr-2" />
                Apply to {selectedLocationIds.size} Location{selectedLocationIds.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}