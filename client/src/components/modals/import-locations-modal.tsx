import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useApiError } from "@/contexts/api-error-context";
import { apiRequest } from "@/lib/queryClient";
import { parseApiError } from "@/lib/parseApiError";
import { isGoogleAuthError } from "@/lib/authError";

interface UntrackedLocation {
  locationName: string;
  title: string;
  address: string;
  phone: string;
  status: string;
  accountId: string;
  accountName: string | null;
  accountTracked: boolean;
}

interface ImportLocationsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportLocationsModal({ open, onClose }: ImportLocationsModalProps) {
  const { toast } = useToast();
  const { showApiError } = useApiError();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery<{ locations: UntrackedLocation[]; totalFromGoogle: number; inDb?: { visible: number; hidden: number; otherUser: number } }>({
    queryKey: ["/api/locations/untracked"],
    queryFn: async () => (await apiRequest("GET", "/api/locations/untracked")).json(),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearch("");
    }
  }, [open]);

  const locations = data?.locations ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((l) =>
      [l.title, l.address, l.accountName ?? "", l.accountId].some((v) => v.toLowerCase().includes(q)),
    );
  }, [locations, search]);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.locationName));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((l) => next.delete(l.locationName));
      else filtered.forEach((l) => next.add(l.locationName));
      return next;
    });

  const importMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/locations/import", { locationNames: Array.from(selected) })).json(),
    onSuccess: (res: { imported: number; createdClients: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations/call-counts"] });
      toast({
        title: "Locations added",
        description: `${res.imported} location${res.imported === 1 ? "" : "s"} imported${res.createdClients ? `, ${res.createdClients} new client${res.createdClients === 1 ? "" : "s"} created` : ""}.`,
      });
      onClose();
    },
    onError: (err: unknown) => {
      showApiError("Import Failed", parseApiError(err, "Could not import locations."), { isAuthError: isGoogleAuthError(err) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add locations from Google</DialogTitle>
          <DialogDescription>
            Locations on your Google connection that aren't in BizBuddy yet. Pick the ones to import.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking Google...
          </div>
        ) : error ? (
          <div className="py-6 text-sm text-destructive">
            Could not load locations from Google.{" "}
            <button className="underline" onClick={() => refetch()}>Try again</button>
          </div>
        ) : locations.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p>Nothing new. All {data?.totalFromGoogle ?? 0} locations Google returned are already in BizBuddy.</p>
            {data?.inDb && (
              <p className="mt-2">
                {data.inDb.visible} shown on the Locations page, {data.inDb.hidden} hidden, {data.inDb.otherUser} under another user's clients.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Input
                placeholder="Search name, address or account"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-import-search"
              />
              <label className="flex items-center gap-2 text-sm whitespace-nowrap cursor-pointer">
                <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} data-testid="checkbox-import-all" />
                Select all
              </label>
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y rounded-md border">
              {filtered.map((l) => (
                <label key={l.locationName} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(l.locationName)}
                    onCheckedChange={() => toggle(l.locationName)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{l.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.address || "No address"}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {l.accountName ?? `Account ${l.accountId}`}
                      </span>
                      {!l.accountTracked && <Badge variant="outline">New client</Badge>}
                    </div>
                  </div>
                </label>
              ))}
              {filtered.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">No matches.</div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={selected.size === 0 || importMutation.isPending}
            data-testid="button-import-confirm"
          >
            {importMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Add {selected.size > 0 ? selected.size : ""} location{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
