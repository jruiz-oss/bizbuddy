import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Clock, Camera, MessageSquare, CheckCircle2 } from "lucide-react";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import type { ClientLocation } from "@shared/schema";

interface LocationsGridProps {
  locations: ClientLocation[];
  selectedLocations: Set<string>;
  onLocationSelect: (locationId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}

export function LocationsGrid({ 
  locations, 
  selectedLocations, 
  onLocationSelect, 
  onSelectAll 
}: LocationsGridProps) {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "active":
        return { 
          color: "bg-green-100 text-green-800 border-green-200", 
          icon: CheckCircle2,
          text: "Active" 
        };
      case "pending":
        return { 
          color: "bg-yellow-100 text-yellow-800 border-yellow-200", 
          icon: Clock,
          text: "Pending" 
        };
      case "error":
        return { 
          color: "bg-red-100 text-red-800 border-red-200", 
          icon: Clock,
          text: "Error" 
        };
      default:
        return { 
          color: "bg-gray-100 text-gray-800 border-gray-200", 
          icon: Clock,
          text: status 
        };
    }
  };

  const renderStars = (rating?: string | null) => {
    if (!rating) return null;
    
    const ratingNum = parseFloat(rating);
    const fullStars = Math.floor(ratingNum);
    const hasHalfStar = ratingNum % 1 >= 0.5;
    
    return (
      <div className="flex items-center gap-1">
        <div className="flex text-yellow-400">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={`w-3 h-3 ${
                i < fullStars
                  ? "fill-current"
                  : i === fullStars && hasHalfStar
                  ? "fill-current opacity-50"
                  : "stroke-current fill-transparent"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-muted-foreground ml-1">
          {ratingNum.toFixed(1)}
        </span>
      </div>
    );
  };

  const formatLastAction = (timestamp?: string | null) => {
    if (!timestamp) return "Never";
    return formatPhoenixDateTime(timestamp);
  };

  const allSelected = selectedLocations.size === locations.length && locations.length > 0;
  const someSelected = selectedLocations.size > 0 && selectedLocations.size < locations.length;

  return (
    <div className="space-y-6">
      {/* Selection Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onSelectAll}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            data-testid="checkbox-select-all-grid"
          />
          <span className="text-sm font-medium">
            {someSelected ? "Some selected" : allSelected ? "All selected" : "Select all"}
          </span>
          {selectedLocations.size > 0 && (
            <Badge variant="secondary" className="ml-2" data-testid="selected-count">
              {selectedLocations.size} selected
            </Badge>
          )}
        </div>
        
        <div className="text-sm text-muted-foreground">
          {locations.length} {locations.length === 1 ? 'location' : 'locations'}
        </div>
      </div>

      {/* Locations Grid */}
      {locations.length === 0 ? (
        <div className="text-center py-12">
          <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No locations found</h3>
          <p className="text-muted-foreground">Select a client to view their business locations</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {locations.map((location) => {
            const isSelected = selectedLocations.has(location.id);
            const isHovered = hoveredCard === location.id;
            const statusConfig = getStatusConfig(location.status);
            const StatusIcon = statusConfig.icon;

            return (
              <Card
                key={location.id}
                className={`relative transition-all duration-200 cursor-pointer group hover:shadow-md ${
                  isSelected 
                    ? "ring-2 ring-primary ring-offset-2 shadow-md" 
                    : "hover:shadow-lg"
                } ${isHovered ? "scale-105" : ""}`}
                onMouseEnter={() => setHoveredCard(location.id)}
                onMouseLeave={() => setHoveredCard(null)}
                onClick={() => onLocationSelect(location.id, !isSelected)}
                data-testid={`location-card-${location.id}`}
              >
                {/* Selection Overlay */}
                <div className={`absolute top-3 right-3 z-10 transition-all duration-200 ${
                  isSelected || isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => onLocationSelect(location.id, !!checked)}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary bg-white shadow-sm"
                    data-testid={`checkbox-location-${location.id}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <CardContent className="p-4">
                  {/* Status Badge */}
                  <div className="flex justify-between items-start mb-3">
                    <Badge 
                      className={`${statusConfig.color} border text-xs font-medium`}
                      data-testid={`location-status-${location.id}`}
                    >
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {statusConfig.text}
                    </Badge>
                  </div>

                  {/* Location Info */}
                  <div className="space-y-2">
                    <h3 
                      className="font-semibold text-sm leading-tight line-clamp-2"
                      data-testid={`location-name-${location.id}`}
                    >
                      {location.name}
                    </h3>
                    
                    {location.city && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span data-testid={`location-city-${location.id}`}>{location.city}</span>
                      </div>
                    )}

                    {location.address && (
                      <p 
                        className="text-xs text-muted-foreground line-clamp-2"
                        data-testid={`location-address-${location.id}`}
                      >
                        {location.address}
                      </p>
                    )}
                  </div>

                  {/* Rating */}
                  {location.averageRating && (
                    <div className="mt-3" data-testid={`location-rating-${location.id}`}>
                      {renderStars(location.averageRating)}
                    </div>
                  )}

                  {/* Last Actions */}
                  <div className="mt-4 pt-3 border-t border-border space-y-2">
                    <div className="grid grid-cols-1 gap-1 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <MessageSquare className="w-3 h-3" />
                          <span>Posts</span>
                        </div>
                        <span 
                          className="text-muted-foreground"
                          data-testid={`location-last-post-${location.id}`}
                        >
                          {formatLastAction(location.lastPostAt?.toString())}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>Hours</span>
                        </div>
                        <span 
                          className="text-muted-foreground"
                          data-testid={`location-last-hours-${location.id}`}
                        >
                          {formatLastAction(location.lastHoursUpdateAt?.toString())}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Camera className="w-3 h-3" />
                          <span>Photos</span>
                        </div>
                        <span 
                          className="text-muted-foreground"
                          data-testid={`location-last-photo-${location.id}`}
                        >
                          {formatLastAction(location.lastPhotoAt?.toString())}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}