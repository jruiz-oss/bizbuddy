import { SideNav } from "@/components/SideNav";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Star, AlertTriangle, FolderOpen, X, Mail, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiUrl } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";
import { useApiError } from "@/contexts/api-error-context";
import { parseApiError } from "@/lib/parseApiError";
import type { Client, ClientLocation, LocationFolder } from "@shared/schema";

interface ReviewsProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

interface Review {
  reviewId: string;
  reviewer: string;
  starRating: number;
  comment: string;
  createTime: string;
  updateTime?: string;
  locationName?: string;
  locationAddress?: string;
  gbpLocationId?: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-4 h-4 ${
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-gray-200 text-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function Reviews({ selectedClientId, setSelectedClientId }: ReviewsProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [minStars, setMinStars] = useState<number>(1);
  const [maxStars, setMaxStars] = useState<number>(3);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  const { data: folders = [] } = useQuery<LocationFolder[]>({
    queryKey: ["/api/folders"],
  });

  const { data: folderLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/folders", selectedFolderId, "locations"],
    queryFn: async () => {
      if (!selectedFolderId) return [];
      const response = await fetch(`/api/folders/${selectedFolderId}/locations`);
      if (!response.ok) throw new Error("Failed to fetch folder locations");
      return response.json();
    },
    enabled: !!selectedFolderId,
  });

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedLocations = locations.filter(l => selectedLocationIds.includes(l.id));

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      // Build the full list of selected locations with their matching review counts so
      // the email shows "No new reviews this period." blocks for locations with zero
      // matches — matching the automated (scheduler) email exactly.
      const reviewCountByLocation = reviews.reduce<Record<string, number>>((acc, r) => {
        const key = r.locationName || "";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const allCheckedLocations = selectedLocations.map(l => ({
        name: l.name,
        address: l.address || undefined,
        reviewCount: reviewCountByLocation[l.name] || 0,
      }));

      const response = await apiRequest("POST", "/api/reviews/send-email", {
        to: recipientEmail,
        cc: ccEmail || undefined,
        reviews,
        allCheckedLocations,
        minStars,
        maxStars,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        customMessage: customMessage || undefined,
        clientName: selectedClient?.name,
      });
      return response.json();
    },
    onSuccess: () => {
      const emailCount = recipientEmail.split(',').filter(e => e.trim()).length;
      toast({
        title: "Email sent",
        description: `Reviews report sent to ${emailCount} recipient${emailCount !== 1 ? 's' : ''}`,
      });
      setEmailModalOpen(false);
      setRecipientEmail("");
      setCcEmail("");
      setCustomMessage("");
    },
    onError: (error: any) => {
      showApiError("Failed to Send Email", parseApiError(error, "Could not send the email. Please try again."));
    },
  });

  const handleSendEmail = () => {
    if (!recipientEmail) {
      toast({
        title: "Email required",
        description: "Please enter a recipient email address.",
        variant: "destructive",
      });
      return;
    }
    sendEmailMutation.mutate();
  };

  const filteredLocations = useMemo(() => {
    let result = locations;
    
    if (selectedFolderId && folderLocations.length > 0) {
      const folderLocationIds = new Set(folderLocations.map(fl => fl.id));
      result = result.filter(loc => folderLocationIds.has(loc.id));
    }
    
    if (locationSearch.trim()) {
      const search = locationSearch.toLowerCase();
      result = result.filter(loc => 
        loc.name.toLowerCase().includes(search) ||
        (loc.address && loc.address.toLowerCase().includes(search))
      );
    }
    
    return result;
  }, [locations, selectedFolderId, folderLocations, locationSearch]);

  const fetchReviews = async () => {
    if (selectedLocationIds.length === 0) {
      toast({
        title: "No locations selected",
        description: "Please select at least one location.",
        variant: "destructive",
      });
      return;
    }

    setIsFetching(true);
    setHasFetched(false);
    
    try {
      const allBadReviews: Review[] = [];
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < selectedLocationIds.length; i++) {
        const locationId = selectedLocationIds[i];
        const location = locations.find(l => l.id === locationId);
        if (!location) continue;
        
        try {
          const params = new URLSearchParams();
          if (startDate) params.set('startDate', startDate);
          const qs = params.toString() ? `?${params.toString()}` : '';
          const response = await fetch(getApiUrl(`/api/locations/${locationId}/reviews${qs}`), {
            credentials: 'include',
          });
          if (response.ok) {
            const locationReviews = await response.json();
            const enrichedReviews = locationReviews.map((review: Review) => ({
              ...review,
              locationName: location.name,
              locationAddress: location.address || "",
            }));
            let filteredReviews = enrichedReviews.filter((r: Review) =>
              r.starRating >= minStars && r.starRating <= maxStars
            );

            if (endDate) {
              const end = new Date(endDate);
              end.setHours(23, 59, 59, 999);
              filteredReviews = filteredReviews.filter((r: Review) => new Date(r.createTime) <= end);
            }

            allBadReviews.push(...filteredReviews);
            successCount++;
          } else {
            errorCount++;
            let errorDetail = `HTTP ${response.status}`;
            try {
              const errBody = await response.json();
              errorDetail = errBody.error || errBody.message || errorDetail;
            } catch {}
            console.error(`Failed to fetch reviews for ${location.name}: ${errorDetail}`);
            // Surface the first error prominently so the user knows what's wrong
            if (errorCount === 1) {
              toast({
                title: `Reviews API error for ${location.name}`,
                description: errorDetail,
                variant: "destructive",
              });
            }
          }
        } catch (err) {
          errorCount++;
          console.error(`Error fetching reviews for ${location.name}:`, err);
        }
        
        if (i < selectedLocationIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      allBadReviews.sort((a: Review, b: Review) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
      
      setReviews(allBadReviews);
      setHasFetched(true);
      
      const dateRangeText = startDate || endDate 
        ? ` from ${startDate || 'beginning'} to ${endDate || 'today'}`
        : '';
      
      const starText = minStars === maxStars 
        ? `${minStars} star${minStars !== 1 ? 's' : ''}`
        : `${minStars}-${maxStars} stars`;
      
      if (errorCount > 0) {
        toast({
          title: "Reviews fetched with some errors",
          description: `Found ${allBadReviews.length} reviews from ${successCount} locations. ${errorCount} location(s) failed.`,
          variant: "default",
        });
      } else {
        toast({
          title: "Reviews fetched",
          description: `Found ${allBadReviews.length} reviews with ${starText}${dateRangeText} across ${selectedLocationIds.length} location(s).`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch reviews. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  };

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedLocationIds([]);
    setSelectedFolderId("");
    setLocationSearch("");
    setReviews([]);
    setHasFetched(false);
  };

  const handleLocationToggle = (locationId: string) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId)
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
    setReviews([]);
    setHasFetched(false);
  };

  const handleSelectAll = () => {
    const allFilteredIds = filteredLocations.map(l => l.id);
    setSelectedLocationIds(allFilteredIds);
    setReviews([]);
    setHasFetched(false);
  };

  const handleClearSelection = () => {
    setSelectedLocationIds([]);
    setReviews([]);
    setHasFetched(false);
  };

  const handleFolderChange = (folderId: string) => {
    setSelectedFolderId(folderId === "all" ? "" : folderId);
    setSelectedLocationIds([]);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <SideNav />
      {/* Main Content */}
      <main className="flex-1 ml-56 px-8 py-6 overflow-auto">
        <div className="max-w-[1280px] mx-auto space-y-4">
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium mb-1">QUALITY</p>
              <h1 className="text-3xl font-semibold text-gray-900 tracking-tight" data-testid="text-page-title">Reviews</h1>
            </div>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-[26px]">Select Location</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-4 items-end flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-sm font-medium mb-2 block">Client Account</label>
                    <Select value={selectedClientId} onValueChange={handleClientChange}>
                      <SelectTrigger data-testid="select-client">
                        <SelectValue placeholder="Select a client..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id} data-testid={`select-client-option-${client.id}`}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedClientId && folders.length > 0 && (
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-sm font-medium mb-2 block">Folder</label>
                      <Select value={selectedFolderId || "all"} onValueChange={handleFolderChange}>
                        <SelectTrigger data-testid="select-folder">
                          <FolderOpen className="w-4 h-4 mr-2" />
                          <SelectValue placeholder="All folders" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Folders</SelectItem>
                          {folders.map((folder) => (
                            <SelectItem key={folder.id} value={folder.id} data-testid={`select-folder-option-${folder.id}`}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                
                {selectedClientId && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search locations by name or address..."
                        value={locationSearch}
                        onChange={(e) => setLocationSearch(e.target.value)}
                        className="pl-9"
                        data-testid="input-location-search"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {selectedLocationIds.length} of {filteredLocations.length} selected
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAll}
                          disabled={filteredLocations.length === 0}
                          data-testid="button-select-all"
                        >
                          Select All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearSelection}
                          disabled={selectedLocationIds.length === 0}
                          data-testid="button-clear-selection"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Clear
                        </Button>
                      </div>
                    </div>
                    
                    <ScrollArea className="h-[200px] border rounded-md p-2">
                      {filteredLocations.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No locations found
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {filteredLocations.map((location) => (
                            <div
                              key={location.id}
                              className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer"
                              onClick={() => handleLocationToggle(location.id)}
                              data-testid={`location-item-${location.id}`}
                            >
                              <Checkbox
                                checked={selectedLocationIds.includes(location.id)}
                                onCheckedChange={() => handleLocationToggle(location.id)}
                                data-testid={`checkbox-location-${location.id}`}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{location.name}</p>
                                {location.address && (
                                  <p className="text-xs text-muted-foreground truncate">{location.address}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                    
                    <div className="border-t pt-3 mt-2">
                      <label className="text-sm font-medium mb-2 block">Star Rating</label>
                      <div className="flex gap-2 items-center flex-wrap">
                        <Select value={minStars.toString()} onValueChange={(v) => setMinStars(Number(v))}>
                          <SelectTrigger className="w-[100px]" data-testid="select-min-stars">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <SelectItem key={n} value={n.toString()} data-testid={`select-min-stars-${n}`}>
                                {n} star{n !== 1 ? 's' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">to</span>
                        <Select value={maxStars.toString()} onValueChange={(v) => setMaxStars(Number(v))}>
                          <SelectTrigger className="w-[100px]" data-testid="select-max-stars">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].filter(n => n >= minStars).map((n) => (
                              <SelectItem key={n} value={n.toString()} data-testid={`select-max-stars-${n}`}>
                                {n} star{n !== 1 ? 's' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-1 ml-2">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-5 h-5 ${
                                star >= minStars && star <= maxStars
                                  ? "fill-yellow-400 text-yellow-400"
                                  : "fill-gray-200 text-gray-200"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t pt-3 mt-2">
                      <label className="text-sm font-medium mb-2 block">Date Range (optional)</label>
                      <div className="flex gap-2 items-center flex-wrap">
                        <div className="flex-1 min-w-[140px]">
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            placeholder="Start date"
                            data-testid="input-start-date"
                          />
                        </div>
                        <span className="text-muted-foreground">to</span>
                        <div className="flex-1 min-w-[140px]">
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            placeholder="End date"
                            data-testid="input-end-date"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEndDate(new Date().toISOString().split('T')[0])}
                          data-testid="button-today"
                        >
                          Today
                        </Button>
                        {(startDate || endDate) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setStartDate(""); setEndDate(""); }}
                            data-testid="button-clear-dates"
                          >
                            <X className="w-3 h-3 mr-1" />
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    <Button
                      onClick={fetchReviews}
                      disabled={selectedLocationIds.length === 0 || isFetching}
                      className="w-full"
                      data-testid="button-fetch-reviews"
                    >
                      {isFetching ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          Fetch Reviews ({selectedLocationIds.length} location{selectedLocationIds.length !== 1 ? "s" : ""})
                        </>
                      )}
                    </Button>
                  </div>
                )}
                
                {selectedClient && (
                  <p className="text-sm text-muted-foreground" data-testid="text-location-count">
                    {filteredLocations.length} of {locations.length} location{locations.length !== 1 ? "s" : ""} shown
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {hasFetched && (
            <div className="space-y-4">
              {reviews.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                        <Star className="w-6 h-6 text-green-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground" data-testid="text-no-reviews-found">No Reviews Found</h3>
                      <p className="text-muted-foreground max-w-md">
                        No reviews found matching your filters for the selected location{selectedLocationIds.length !== 1 ? "s" : ""}.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="destructive" className="text-sm" data-testid="badge-bad-reviews-count">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {reviews.length} Bad Review{reviews.length !== 1 ? "s" : ""}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEmailModalOpen(true)}
                      data-testid="button-email-reviews"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Email
                    </Button>
                  </div>

                  {reviews.map((review, index) => (
                    <Card key={review.reviewId || index} data-testid={`review-card-${index}`}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                <span className="text-lg font-semibold text-muted-foreground" data-testid={`text-reviewer-initial-${index}`}>
                                  {review.reviewer.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <h4 className="font-semibold text-foreground" data-testid={`text-reviewer-name-${index}`}>{review.reviewer}</h4>
                                <div className="flex items-center gap-2">
                                  <div data-testid={`rating-stars-${index}`}>
                                    <StarRating rating={review.starRating} />
                                  </div>
                                  <span className="text-sm text-muted-foreground" data-testid={`text-review-date-${index}`}>
                                    {new Date(review.createTime).toLocaleDateString("en-US", {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {review.comment ? (
                              <p className="text-foreground mt-3 leading-relaxed" data-testid={`text-review-comment-${index}`}>
                                "{review.comment}"
                              </p>
                            ) : (
                              <p className="text-muted-foreground italic mt-3" data-testid={`text-review-no-comment-${index}`}>
                                No comment provided
                              </p>
                            )}

                            <div className="mt-4 pt-3 border-t border-border">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="w-4 h-4" />
                                <span className="font-medium" data-testid={`text-review-location-${index}`}>{review.locationName}</span>
                                {review.locationAddress && (
                                  <span className="text-xs" data-testid={`text-review-address-${index}`}>• {review.locationAddress}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>
          )}

          {!hasFetched && !isFetching && (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Search className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground" data-testid="text-select-client-prompt">Select a Location</h3>
                  <p className="text-muted-foreground max-w-md">
                    Choose a client and locations, set your star rating and date filters, then click "Fetch Reviews" to see matching reviews.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent data-testid="dialog-email-reviews">
          <DialogHeader>
            <DialogTitle>Email Reviews Report</DialogTitle>
            <DialogDescription>
              Send a formatted report of {reviews.length} review{reviews.length !== 1 ? 's' : ''} to your client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="recipient-email">Recipient Email(s)</Label>
              <Input
                id="recipient-email"
                type="text"
                placeholder="email@example.com, another@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                data-testid="input-recipient-email"
              />
              <p className="text-xs text-muted-foreground">Separate multiple emails with commas</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc-email">CC (optional)</Label>
              <Input
                id="cc-email"
                type="text"
                placeholder="cc@example.com, another@example.com"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                data-testid="input-cc-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-message">Message (optional)</Label>
              <Textarea
                id="custom-message"
                placeholder="Add a personal note to include at the top of the email..."
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={3}
                data-testid="input-custom-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmailModalOpen(false)}
              data-testid="button-cancel-email"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={!recipientEmail || sendEmailMutation.isPending}
              data-testid="button-send-email"
            >
              {sendEmailMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
