import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Edit2, Check, Phone, Globe, Navigation, Eye, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ClientLocation } from "@shared/schema";

interface GbpPerformanceData {
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  impressionsTotal: number;
  daily: Array<{ date: string; impressions: number; callClicks: number; websiteClicks: number; directionRequests: number }>;
}

interface MetricSlot {
  id: string;
  name: string;
  posts: number;
  targetPosts: number;
  avgRating: number;
  type: 'location' | 'folder';
}

export function PerformanceMetrics({ selectedClientId }: { selectedClientId: string }) {
  const [slots, setSlots] = useState<MetricSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const { toast } = useToast();

  const { data: parentLocations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  const { data: folders = [] } = useQuery<any[]>({
    queryKey: ["/api/folders"],
  });

  const availableOptions = [
    ...parentLocations.map(loc => ({ id: loc.id, name: loc.name, type: 'location' as const })),
    ...folders.map(folder => ({ id: folder.id, name: folder.name, type: 'folder' as const }))
  ];

  const fetchMetrics = useCallback(async (id: string, type: 'location' | 'folder') => {
    try {
      const endpoint = type === 'location' ? `/api/locations/${id}/metrics` : `/api/folders/${id}/metrics`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        return { posts: 0, targetPosts: 0, avgRating: 0 };
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching ${type} metrics:`, error);
      return { posts: 0, targetPosts: 0, avgRating: 0 };
    }
  }, []);

  const refreshAllSlotMetrics = useCallback(async (slotsToRefresh: MetricSlot[]) => {
    const updatedSlots = await Promise.all(
      slotsToRefresh.map(async (slot) => {
        const metrics = await fetchMetrics(slot.id, slot.type);
        return {
          ...slot,
          posts: metrics.posts || 0,
          // Keep existing targetPosts, don't overwrite
          avgRating: metrics.avgRating || 0,
        };
      })
    );
    setSlots(updatedSlots);
  }, [fetchMetrics]);

  useEffect(() => {
    let isMounted = true;
    
    const loadSlotsFromStorage = async () => {
      const saved = localStorage.getItem("performanceMetricSlots");
      if (saved) {
        try {
          const parsedSlots = JSON.parse(saved);
          if (parsedSlots.length > 0 && isMounted) {
            // Show cached slots immediately, then refresh in background
            setSlots(parsedSlots);
            setIsLoading(false);
            // Refresh metrics in background - only update posts and avgRating, keep local targetPosts
            try {
              const updatedSlots = await Promise.all(
                parsedSlots.map(async (slot: MetricSlot) => {
                  const metrics = await fetchMetrics(slot.id, slot.type);
                  return {
                    ...slot,
                    posts: metrics.posts || 0,
                    // Keep existing targetPosts from localStorage, don't overwrite with API value
                    avgRating: metrics.avgRating || 0,
                  };
                })
              );
              if (isMounted) {
                setSlots(updatedSlots);
              }
            } catch (error) {
              console.error("Error refreshing slot metrics:", error);
            }
            return;
          }
        } catch {
          if (isMounted) setSlots([]);
        }
      }
      if (isMounted) setIsLoading(false);
    };
    
    loadSlotsFromStorage();
    
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem("performanceMetricSlots", JSON.stringify(slots));
    }
  }, [slots, isLoading]);

  // Refresh metrics when page becomes visible (user navigates back to dashboard)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && slots.length > 0) {
        // Background refresh - don't block UI
        try {
          const updatedSlots = await Promise.all(
            slots.map(async (slot) => {
              const metrics = await fetchMetrics(slot.id, slot.type);
              return {
                ...slot,
                posts: metrics.posts || 0,
                // Keep local targetPosts, don't overwrite from API
                avgRating: metrics.avgRating || 0,
              };
            })
          );
          setSlots(updatedSlots);
        } catch (error) {
          console.error("Error refreshing metrics on visibility change:", error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [slots, fetchMetrics]);

  const updateTargetPostsMutation = useMutation({
    mutationFn: async ({ id, type, targetPosts }: { id: string; type: 'location' | 'folder'; targetPosts: number }) => {
      const endpoint = type === 'location' 
        ? `/api/locations/${id}/target-posts` 
        : `/api/folders/${id}/target-posts`;
      return apiRequest('PATCH', endpoint, { targetPosts });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
    }
  });

  const addSlot = async () => {
    if (slots.length < 5 && availableOptions.length > 0) {
      const unselected = availableOptions.find(opt => !slots.some(s => s.id === opt.id));
      if (unselected) {
        const metrics = await fetchMetrics(unselected.id, unselected.type);
        setSlots([...slots, {
          id: unselected.id,
          name: unselected.name,
          posts: metrics.posts || 0,
          targetPosts: metrics.targetPosts || 0,
          avgRating: metrics.avgRating || 0,
          type: unselected.type
        }]);
      }
    }
  };

  const updateSlot = async (index: number, optionId: string) => {
    const option = availableOptions.find(opt => opt.id === optionId);
    if (option) {
      const metrics = await fetchMetrics(optionId, option.type);
      const newSlots = [...slots];
      newSlots[index] = {
        id: optionId,
        name: option.name,
        posts: metrics.posts || 0,
        targetPosts: metrics.targetPosts || 0,
        avgRating: metrics.avgRating || 0,
        type: option.type
      };
      setSlots(newSlots);
    }
  };

  const removeSlot = (index: number) => {
    setSlots(slots.filter((_, i) => i !== index));
  };

  const startEditing = (index: number) => {
    setEditingSlot(index);
    setEditValue(slots[index].targetPosts.toString());
  };

  const cancelEditing = () => {
    setEditingSlot(null);
    setEditValue("");
  };

  const saveTargetPosts = (index: number) => {
    const slot = slots[index];
    const newTarget = parseInt(editValue) || 0;
    
    if (newTarget < 0 || newTarget > 1000) {
      toast({
        title: "Invalid target",
        description: "Target must be between 0 and 1000",
        variant: "destructive"
      });
      setEditingSlot(null);
      setEditValue("");
      return;
    }
    
    // Update local state only - saves to localStorage via useEffect
    const newSlots = [...slots];
    newSlots[index] = { ...slot, targetPosts: newTarget };
    setSlots(newSlots);
    
    setEditingSlot(null);
    setEditValue("");
  };

  const formatPostsDisplay = (posts: number, targetPosts: number) => {
    if (targetPosts > 0) {
      return `${posts}/${targetPosts}`;
    }
    return `${posts}`;
  };

  if (isLoading) {
    return (
      <Card className="hover:shadow-md transition-shadow overflow-hidden bg-white">
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-5 bg-cyan-400 dark:bg-cyan-500">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-white font-semibold text-lg">Performance Chart</span>
          </div>
          <div className="bg-cyan-400 dark:bg-cyan-500 px-6 py-8 text-center text-white text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow overflow-hidden bg-white dark:bg-gray-800">
      <CardContent className="p-0">
        <div className="flex items-center gap-3 p-5 bg-cyan-400 dark:bg-cyan-500">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-white font-semibold text-lg">Performance Chart</span>
        </div>

        <div className="bg-cyan-400 dark:bg-cyan-500 px-6 py-6">
          {slots.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white text-sm mb-4">
                Add up to 5 clients to monitor their performance
              </p>
              <Button
                onClick={addSlot}
                disabled={!selectedClientId}
                className="bg-white text-cyan-600 hover:bg-gray-100 font-semibold"
                data-testid="button-add-first-client"
              >
                Add Client
              </Button>
            </div>
          ) : (
            <div className="space-y-0">
              {slots.map((slot, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between py-4 ${
                    index !== slots.length - 1 ? 'border-b border-cyan-300 dark:border-cyan-600' : ''
                  }`}
                  data-testid={`metric-slot-${index}`}
                >
                  <div className="flex-1 mr-4">
                    <Select
                      value={slot.id}
                      onValueChange={(optionId) => updateSlot(index, optionId)}
                    >
                      <SelectTrigger 
                        className="w-auto bg-transparent border-0 text-white font-semibold hover:bg-cyan-500/50 px-0 text-base"
                        data-testid={`select-slot-${index}`}
                      >
                        <SelectValue placeholder="Select location or folder" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableOptions.map(option => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name} {option.type === 'folder' ? '(Folder)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 px-4">
                    {editingSlot === index ? (
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-lg">{slot.posts}/</span>
                        <Input
                          type="number"
                          min="0"
                          max="1000"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-16 h-8 text-center bg-white/20 border-white/30 text-white placeholder:text-white/50"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTargetPosts(index);
                            if (e.key === 'Escape') cancelEditing();
                          }}
                          data-testid={`input-target-posts-${index}`}
                        />
                        <button
                          onClick={() => saveTargetPosts(index)}
                          className="p-1 hover:bg-cyan-300/50 rounded transition"
                          disabled={updateTargetPostsMutation.isPending}
                          data-testid={`button-save-target-${index}`}
                        >
                          <Check className="w-4 h-4 text-white" />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1 hover:bg-cyan-300/50 rounded transition"
                          data-testid={`button-cancel-target-${index}`}
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-white font-bold text-lg">
                          {formatPostsDisplay(slot.posts, slot.targetPosts)} posts
                        </p>
                        <button
                          onClick={() => startEditing(index)}
                          className="p-1 hover:bg-cyan-300/50 rounded transition opacity-60 hover:opacity-100"
                          title="Set monthly target"
                          data-testid={`button-edit-target-${index}`}
                        >
                          <Edit2 className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 flex-1 justify-end">
                    <p className="text-white font-bold text-lg">
                      {typeof slot.avgRating === 'number' && !isNaN(slot.avgRating) ? slot.avgRating.toFixed(1) : 'N/A'} rating
                    </p>
                    <button
                      onClick={() => removeSlot(index)}
                      className="p-1 hover:bg-cyan-300/50 rounded transition flex-shrink-0"
                      data-testid={`remove-metric-slot-${index}`}
                    >
                      <X className="w-5 h-5 text-white" />
                    </button>
                  </div>
                </div>
              ))}

              {slots.length < 5 && (
                <div className="pt-4 border-t border-cyan-300 dark:border-cyan-600">
                  <Button
                    onClick={addSlot}
                    disabled={!selectedClientId}
                    variant="ghost"
                    className="w-full text-white hover:bg-cyan-500/50 font-semibold"
                    data-testid="button-add-another-client"
                  >
                    + Add Another Client
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function GbpLocationInsights({ selectedClientId }: { selectedClientId: string }) {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const { data: locations = [] } = useQuery<ClientLocation[]>({
    queryKey: ["/api/clients", selectedClientId, "locations"],
    enabled: !!selectedClientId,
  });

  // Reset location selection when client changes
  useEffect(() => {
    setSelectedLocationId("");
  }, [selectedClientId]);

  // Auto-select first location when locations load or client changes
  useEffect(() => {
    if (locations.length > 0) {
      const isCurrentValid = locations.some((l) => l.id === selectedLocationId);
      if (!isCurrentValid) {
        setSelectedLocationId(locations[0].id);
      }
    }
  }, [locations]);

  const { data, isLoading, isError, error } = useQuery<GbpPerformanceData>({
    queryKey: ["/api/locations", selectedLocationId, "performance", days],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${selectedLocationId}/performance?days=${days}&_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load performance data");
      }
      return res.json();
    },
    enabled: !!selectedLocationId,
    staleTime: 5 * 60 * 1000,
  });

  const statCards = [
    {
      icon: <Phone className="w-5 h-5 text-primary" />,
      label: "Call Clicks",
      value: data?.callClicks ?? 0,
      testId: "stat-call-clicks",
    },
    {
      icon: <Globe className="w-5 h-5 text-primary" />,
      label: "Website Clicks",
      value: data?.websiteClicks ?? 0,
      testId: "stat-website-clicks",
    },
    {
      icon: <Navigation className="w-5 h-5 text-primary" />,
      label: "Direction Requests",
      value: data?.directionRequests ?? 0,
      testId: "stat-direction-requests",
    },
    {
      icon: <Eye className="w-5 h-5 text-primary" />,
      label: "Total Impressions",
      value: data?.impressionsTotal ?? 0,
      testId: "stat-impressions-total",
    },
  ];

  const chartData = (data?.daily || []).map((d) => ({
    date: d.date.slice(5),
    impressions: d.impressions,
  }));

  return (
    <Card className="hover:shadow-md transition-shadow overflow-hidden bg-white dark:bg-gray-800 mt-4">
      <CardContent className="p-0">
        <div className="flex items-center gap-3 p-5 bg-primary">
          <Eye className="w-5 h-5 text-primary-foreground" />
          <span className="text-primary-foreground font-semibold text-lg">GBP Location Insights</span>
        </div>

        <div className="p-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Select
              value={selectedLocationId}
              onValueChange={setSelectedLocationId}
            >
              <SelectTrigger
                className="w-56"
                data-testid="select-gbp-location"
              >
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center rounded-lg border border-border overflow-hidden" data-testid="toggle-date-range">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  data-testid={`toggle-days-${d}`}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    days === d
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div data-testid="gbp-insights-loading">
              <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rounded-xl border border-border p-4 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div
              className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive"
              data-testid="gbp-insights-error"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm">{(error as Error)?.message || "Failed to load performance data from Google."}</p>
            </div>
          )}

          {/* Empty / no location selected */}
          {!isLoading && !isError && !selectedLocationId && (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="gbp-insights-empty">
              Select a location to view GBP performance metrics.
            </p>
          )}

          {/* Data */}
          {!isLoading && !isError && data && selectedLocationId && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
                {statCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-xl border border-border bg-muted/30 p-4"
                    data-testid={card.testId}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {card.icon}
                      <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{card.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <div data-testid="gbp-impressions-chart">
                <p className="text-sm font-medium text-muted-foreground mb-3">Daily Impressions</p>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        interval={Math.floor(chartData.length / 6)}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(value: number) => [value.toLocaleString(), "Impressions"]}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Bar dataKey="impressions" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6" data-testid="gbp-chart-empty">
                    No impression data available for this period.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function LocationPerformancePanel({ locationId }: { locationId: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const { data, isLoading, isError, error } = useQuery<GbpPerformanceData>({
    queryKey: ["/api/locations", locationId, "performance", days],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${locationId}/performance?days=${days}&_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load performance data");
      }
      return res.json();
    },
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  const statCards = [
    { icon: <Phone className="w-4 h-4 text-primary" />, label: "Call Clicks", value: data?.callClicks ?? 0, testId: "panel-stat-call-clicks" },
    { icon: <Globe className="w-4 h-4 text-primary" />, label: "Website Clicks", value: data?.websiteClicks ?? 0, testId: "panel-stat-website-clicks" },
    { icon: <Navigation className="w-4 h-4 text-primary" />, label: "Direction Requests", value: data?.directionRequests ?? 0, testId: "panel-stat-directions" },
    { icon: <Eye className="w-4 h-4 text-primary" />, label: "Impressions", value: data?.impressionsTotal ?? 0, testId: "panel-stat-impressions" },
  ];

  const chartData = (data?.daily || []).map((d) => ({
    date: d.date.slice(5),
    impressions: d.impressions,
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-semibold text-foreground">GBP Performance</span>
        <div className="flex items-center rounded-lg border border-border overflow-hidden ml-auto" data-testid="panel-toggle-date-range">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              data-testid={`panel-toggle-days-${d}`}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border p-3 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm mb-4" data-testid="panel-gbp-error">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {(error as Error)?.message?.includes('Business Profile Performance API is not enabled') ? (
                <>
                  <p className="font-semibold mb-1">Performance API not enabled</p>
                  <p className="text-xs opacity-90">To fix this, go to <strong>Google Cloud Console</strong> → APIs &amp; Services → Library → search <strong>"Business Profile Performance API"</strong> → Enable it.</p>
                </>
              ) : (
                <p>{(error as Error)?.message || "Failed to load performance data from Google."}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {statCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-border bg-muted/30 p-3" data-testid={card.testId}>
                <div className="flex items-center gap-1.5 mb-1">
                  {card.icon}
                  <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
                </div>
                <p className="text-xl font-bold text-foreground">{card.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div data-testid="panel-gbp-chart">
            <p className="text-xs font-medium text-muted-foreground mb-2">Daily Impressions</p>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(chartData.length / 5)} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value: number) => [value.toLocaleString(), "Impressions"]} labelFormatter={(label) => `Date: ${label}`} />
                  <Bar dataKey="impressions" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">No impression data for this period.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
