import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, Globe, Star, Clock, Pencil, MessageSquare, BarChart3 } from "lucide-react";
import { LocationPerformancePanel } from "@/components/performance-metrics";
import type { ClientLocation } from "@shared/schema";

interface LocationDetailSheetProps {
  location: ClientLocation | null;
  open: boolean;
  onClose: () => void;
  onEditClick: (location: ClientLocation) => void;
  onCreatePost: (location: ClientLocation) => void;
  onUpdateHours: (location: ClientLocation) => void;
}

function formatTime12(hours: number, minutes: number) {
  const h = hours || 0;
  const m = minutes || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};

export function LocationDetailSheet({
  location,
  open,
  onClose,
  onEditClick,
  onCreatePost,
  onUpdateHours,
}: LocationDetailSheetProps) {
  if (!location) return null;

  const loc = location as any;
  const hours: any[] = loc.regularHours?.periods ?? [];

  const statusColor =
    location.status === "active"
      ? "bg-green-100 text-green-700"
      : location.status === "temporarily_closed"
      ? "bg-yellow-100 text-yellow-700"
      : location.status === "permanently_closed"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  const statusLabel =
    location.status === "temporarily_closed"
      ? "Temp Closed"
      : location.status === "permanently_closed"
      ? "Perm Closed"
      : location.status ?? "Unknown";

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        {/* Header */}
        <div className="bg-primary px-6 pt-8 pb-6">
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <SheetTitle className="text-primary-foreground text-xl font-bold leading-tight" data-testid="sheet-location-name">
                {location.name}
              </SheetTitle>
              <Badge className={`shrink-0 mt-0.5 ${statusColor}`} data-testid="sheet-location-status">
                {statusLabel}
              </Badge>
            </div>
          </SheetHeader>
          {location.address && (
            <div className="flex items-start gap-2 mt-3">
              <MapPin className="w-4 h-4 text-primary-foreground/70 mt-0.5 shrink-0" />
              <p className="text-sm text-primary-foreground/80" data-testid="sheet-location-address">
                {location.address}{location.city ? `, ${location.city}` : ""}
              </p>
            </div>
          )}

          {/* Rating */}
          {location.averageRating && (
            <div className="flex items-center gap-2 mt-2">
              <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
              <span className="text-sm text-primary-foreground/90 font-medium" data-testid="sheet-location-rating">
                {location.averageRating} ({loc.totalReviews ?? 0} reviews)
              </span>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreatePost(location)}
              data-testid="sheet-button-create-post"
            >
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              Create Post
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdateHours(location)}
              data-testid="sheet-button-update-hours"
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              Update Hours
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEditClick(location)}
              data-testid="sheet-button-edit-details"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit Details
            </Button>
          </div>

          {/* GBP Performance */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">GBP Performance</span>
            </div>
            <LocationPerformancePanel locationId={location.id} />
          </div>

          {/* Location Details */}
          <div className="rounded-xl border border-border p-4 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location Details</p>

            {/* Phone */}
            <div className="flex items-start gap-3">
              <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                <p className="text-sm font-medium" data-testid="sheet-location-phone">
                  {loc.phone || "Not set"}
                </p>
              </div>
            </div>

            {/* Website */}
            <div className="flex items-start gap-3">
              <Globe className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Website</p>
                {loc.website ? (
                  <a
                    href={loc.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                    data-testid="sheet-location-website"
                  >
                    {loc.website}
                  </a>
                ) : (
                  <p className="text-sm">Not set</p>
                )}
              </div>
            </div>

            {/* Hours */}
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Business Hours</p>
                {hours.length > 0 ? (
                  <div className="space-y-1" data-testid="sheet-location-hours">
                    {hours.map((period: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="text-muted-foreground w-10">{DAY_LABELS[period.openDay] ?? period.openDay}</span>
                        <span>
                          {formatTime12(period.openTime?.hours, period.openTime?.minutes)} –{" "}
                          {formatTime12(period.closeTime?.hours, period.closeTime?.minutes)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm">Not set</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
