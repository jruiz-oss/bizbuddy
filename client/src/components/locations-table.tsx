import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Star, Pencil, Loader2 } from "lucide-react";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ClientLocation } from "@shared/schema";

interface LocationsTableProps {
  locations: ClientLocation[];
  selectedLocations: Set<string>;
  onLocationSelect: (locationId: string, checked: boolean) => void;
}

interface EditFormData {
  phone: string;
  website: string;
  description: string;
}

export function LocationsTable({ locations, selectedLocations, onLocationSelect }: LocationsTableProps) {
  const { toast } = useToast();
  const [editingLocation, setEditingLocation] = useState<ClientLocation | null>(null);
  const [formData, setFormData] = useState<EditFormData>({
    phone: "",
    website: "",
    description: "",
  });

  const updateDetailsMutation = useMutation({
    mutationFn: async ({ locationId, data }: { locationId: string; data: Partial<EditFormData> }) => {
      const response = await apiRequest("PATCH", `/api/locations/${locationId}/details`, data);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update location details");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Location details updated and pushed to Google Business Profile",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setEditingLocation(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update location details",
        variant: "destructive",
      });
    },
  });

  const handleEditClick = (location: ClientLocation) => {
    setFormData({
      phone: location.phone || "",
      website: location.website || "",
      description: location.description || "",
    });
    setEditingLocation(location);
  };

  const handleSave = () => {
    if (!editingLocation) return;

    const updates: Partial<EditFormData> = {};
    if (formData.phone !== (editingLocation.phone || "")) {
      updates.phone = formData.phone;
    }
    if (formData.website !== (editingLocation.website || "")) {
      updates.website = formData.website;
    }
    if (formData.description !== (editingLocation.description || "")) {
      updates.description = formData.description;
    }

    if (Object.keys(updates).length === 0) {
      toast({
        title: "No changes",
        description: "No changes were made to the location details",
      });
      setEditingLocation(null);
      return;
    }

    updateDetailsMutation.mutate({
      locationId: editingLocation.id,
      data: updates,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "error":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const renderStars = (rating?: string | null) => {
    if (!rating) return null;
    
    const ratingNum = parseFloat(rating);
    const fullStars = Math.floor(ratingNum);
    const hasHalfStar = ratingNum % 1 >= 0.5;
    
    return (
      <div className="flex items-center gap-0.5">
        <div className="flex text-yellow-400">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={`w-3.5 h-3.5 ${
                i < fullStars
                  ? "fill-current"
                  : i === fullStars && hasHalfStar
                  ? "fill-current opacity-50"
                  : "stroke-current fill-transparent"
              }`}
            />
          ))}
        </div>
      </div>
    );
  };

  const formatLastAction = (timestamp?: string | null) => {
    if (!timestamp) return "Never";
    return formatPhoenixDateTime(timestamp);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="locations-table">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <input
                    type="checkbox"
                    className="rounded border-border focus:ring-ring"
                    checked={selectedLocations.size === locations.length && locations.length > 0}
                    onChange={(e) => {
                      locations.forEach(location => {
                        onLocationSelect(location.id, e.target.checked);
                      });
                    }}
                    data-testid="checkbox-select-all-table"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  City
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Rating
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Last Post
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Last Hours
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Last Photo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No locations found. Select a client to view locations.
                  </td>
                </tr>
              ) : (
                locations.map((location) => (
                  <tr
                    key={location.id}
                    className="hover:bg-muted/50"
                    data-testid={`location-row-${location.id}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="rounded border-border focus:ring-ring"
                        checked={selectedLocations.has(location.id)}
                        onChange={(e) => onLocationSelect(location.id, e.target.checked)}
                        data-testid={`checkbox-location-${location.id}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm" data-testid={`location-name-${location.id}`}>
                        {location.name}
                      </div>
                      {location.address && (
                        <div className="text-xs text-muted-foreground" data-testid={`location-address-${location.id}`}>
                          {location.address}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge 
                        className={`text-xs ${getStatusColor(location.status)}`}
                        data-testid={`location-status-${location.id}`}
                      >
                        {location.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm" data-testid={`location-city-${location.id}`}>
                      {location.city || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {location.averageRating ? (
                        <div className="flex items-center">
                          <span className="text-sm font-medium mr-1" data-testid={`location-rating-${location.id}`}>
                            {location.averageRating}
                          </span>
                          {renderStars(location.averageRating)}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No rating</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground" data-testid={`location-last-post-${location.id}`}>
                      {formatLastAction(location.lastPostAt?.toString())}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground" data-testid={`location-last-hours-${location.id}`}>
                      {formatLastAction(location.lastHoursUpdateAt?.toString())}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground" data-testid={`location-last-photo-${location.id}`}>
                      {formatLastAction(location.lastPhotoAt?.toString())}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(location)}
                        data-testid={`button-edit-location-${location.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!editingLocation} onOpenChange={(open) => !open && setEditingLocation(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Location Details</DialogTitle>
            <DialogDescription>
              Update location information. Changes will be pushed to Google Business Profile.
            </DialogDescription>
          </DialogHeader>
          
          {editingLocation && (
            <div className="space-y-4 py-4">
              <div className="mb-4 p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">{editingLocation.name}</p>
                <p className="text-xs text-muted-foreground">{editingLocation.address}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  data-testid="input-edit-phone"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  placeholder="https://example.com"
                  data-testid="input-edit-website"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter location description..."
                  rows={4}
                  data-testid="input-edit-description"
                />
                <p className="text-xs text-muted-foreground">
                  This description will appear on your Google Business Profile.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingLocation(null)}
              disabled={updateDetailsMutation.isPending}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateDetailsMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateDetailsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
