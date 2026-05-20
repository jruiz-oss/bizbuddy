import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getNextCronRun, validateCronExpression } from "@/lib/cron-utils";
import { AlertTriangle } from "lucide-react";
import type { ClientSettings } from "@shared/schema";

interface ClientSettingsModalProps {
  clientId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ClientSettingsModal({ clientId, isOpen, onClose }: ClientSettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<ClientSettings>({
    queryKey: ["/api/clients", clientId, "settings"],
    enabled: isOpen && !!clientId,
  });

  const [formData, setFormData] = useState<Partial<ClientSettings>>({});

  // Update form data when settings load
  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ClientSettings>) => {
      const response = await apiRequest("PUT", `/api/clients/${clientId}/settings`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "settings"] });
      toast({
        title: "Settings saved",
        description: "Client settings have been updated successfully.",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    // Validate cron expressions
    if (formData.enableScheduledPosts && formData.postsCron) {
      if (!validateCronExpression(formData.postsCron)) {
        toast({
          title: "Invalid cron expression",
          description: "Posts cron expression is not valid.",
          variant: "destructive",
        });
        return;
      }
    }

    if (formData.enableScheduledHours && formData.hoursCron) {
      if (!validateCronExpression(formData.hoursCron)) {
        toast({
          title: "Invalid cron expression", 
          description: "Hours cron expression is not valid.",
          variant: "destructive",
        });
        return;
      }
    }

    saveSettingsMutation.mutate(formData);
  };

  const timezones = [
    "America/Phoenix",
    "America/New_York", 
    "America/Los_Angeles",
    "America/Chicago",
    "America/Denver",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo",
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="modal-client-settings">
        <DialogHeader>
          <DialogTitle>Client Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Timezone */}
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select 
              value={formData.timezone} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, timezone: value }))}
            >
              <SelectTrigger data-testid="select-timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map(tz => (
                  <SelectItem key={tz} value={tz} data-testid={`timezone-${tz}`}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Scheduled Posts */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="scheduled-posts">Scheduled Posts</Label>
              <Switch
                id="scheduled-posts"
                checked={formData.enableScheduledPosts || false}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, enableScheduledPosts: checked }))}
                data-testid="switch-scheduled-posts"
              />
            </div>

            {formData.enableScheduledPosts && (
              <div className="ml-4 space-y-3">
                <div>
                  <Label htmlFor="posts-cron" className="text-xs text-muted-foreground">
                    Cron Expression
                  </Label>
                  <Input
                    id="posts-cron"
                    value={formData.postsCron || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, postsCron: e.target.value }))}
                    placeholder="0 9 1,15 * *"
                    className="text-sm"
                    data-testid="input-posts-cron"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    09:00 on 1st & 15th of each month
                  </p>
                </div>
                {formData.postsCron && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Next run: </span>
                    <span className="font-medium text-primary" data-testid="text-posts-next-run">
                      {getNextCronRun(formData.postsCron, formData.timezone)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scheduled Hours */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="scheduled-hours">Scheduled Hours</Label>
              <Switch
                id="scheduled-hours"
                checked={formData.enableScheduledHours || false}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, enableScheduledHours: checked }))}
                data-testid="switch-scheduled-hours"
              />
            </div>

            {formData.enableScheduledHours && (
              <div className="ml-4 space-y-3">
                <div>
                  <Label htmlFor="hours-cron" className="text-xs text-muted-foreground">
                    Cron Expression
                  </Label>
                  <Input
                    id="hours-cron"
                    value={formData.hoursCron || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, hoursCron: e.target.value }))}
                    placeholder="0 9 1 */2 *"
                    className="text-sm"
                    data-testid="input-hours-cron"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    09:00 on 1st of every 2 months
                  </p>
                </div>
                {formData.hoursCron && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Next run: </span>
                    <span className="font-medium text-primary" data-testid="text-hours-next-run">
                      {getNextCronRun(formData.hoursCron, formData.timezone)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Safety Notice */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="text-xs font-medium">First scheduled run will trigger a dry-run</p>
              <p className="text-xs">You must manually confirm to enable execution</p>
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={saveSettingsMutation.isPending}
            data-testid="button-save-settings"
          >
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
