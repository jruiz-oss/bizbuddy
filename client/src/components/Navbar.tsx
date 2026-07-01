import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  BarChart3, MapPin, MessageSquare, 
  Building2, History, Settings, Clock, RefreshCw, LogOut, Lightbulb
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiUrl } from "@/lib/queryClient";
import { usePlatformContext } from "@/contexts/platform-context";
import { PlatformSwitchButton } from "@/components/platform-switch-button";
import type { Client } from "@shared/schema";

interface NavbarProps {
  selectedClient?: Client;
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

export function Navbar({ selectedClient, selectedClientId, setSelectedClientId }: NavbarProps) {
  const { toast } = useToast();
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });
  const [location] = useLocation();
  const { setShowPlatformModal } = usePlatformContext();

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setShowPlatformModal(true);
  };
  
  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      toast({
        title: "Logged out",
        description: "Redirecting to login page...",
      });
      setTimeout(() => {
        window.location.href = '/login';
      }, 1000);
    },
    onError: (error: Error) => {
      toast({
        title: "Error logging out",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const syncAccountsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl('/api/sync/accounts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, credentials: "include" });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to sync accounts');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Complete!",
        description: data.message || `Synced ${data.totalAccounts || 0} accounts with ${data.totalLocations || 0} locations`,
      });
      // Refresh clients and locations
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (selectedClientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "locations"] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  const isActive = (path: string) => {
    if (path === '/' || path === '/analytics') {
      return location === '/' || location === '/analytics' || location === '/dashboard';
    }
    return location === path;
  };

  const linkClass = (path: string) => 
    isActive(path)
      ? "flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#001f3f] text-white rounded-lg shadow-lg transition-all duration-200"
      : "flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200";

  return (
    <header className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800 shadow-sm sticky top-0 z-50">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between gap-8">
          {/* Left: Logo and Brand */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-gray-900">BizBuddy</span>
                <p className="text-xs text-gray-500 font-medium">Google Business Profile Manager</p>
              </div>
            </div>
          </div>

          {/* Center: Navigation Links */}
          <nav className="flex-1 flex items-center justify-center">
            <ul className="flex items-center gap-2">
              <li>
                <Link href="/analytics" className={linkClass('/analytics')} data-testid="link-dashboard">
                  <BarChart3 className="w-4 h-4" />
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/locations" className={linkClass('/locations')} data-testid="link-locations">
                  <MapPin className="w-4 h-4" />
                  Locations
                </Link>
              </li>
              <li>
                <Link href="/posts" className={linkClass('/posts')} data-testid="link-posts">
                  <MessageSquare className="w-4 h-4" />
                  Posts
                </Link>
              </li>
              <li>
                <Link href="/hours" className={linkClass('/hours')} data-testid="link-hours">
                  <Clock className="w-4 h-4" />
                  Hours
                </Link>
              </li>
              <li>
                <Link href="/suggested-edits" className={linkClass('/suggested-edits')} data-testid="link-suggested-edits">
                  <Lightbulb className="w-4 h-4" />
                  Suggested Edits
                </Link>
              </li>
              <li>
                <Link href="/jobs" className={linkClass('/jobs')} data-testid="link-change-history">
                  <History className="w-4 h-4" />
                  Activity Log
                </Link>
              </li>
              <li>
                <Link href="/settings" className={linkClass('/settings')} data-testid="link-settings">
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </li>
            </ul>
          </nav>

          {/* Right: Client Selector, Sync Button, and User Menu */}
          <div className="flex-shrink-0 flex items-center gap-3">
            <PlatformSwitchButton />
            <Button
              onClick={() => syncAccountsMutation.mutate()}
              disabled={syncAccountsMutation.isPending}
              variant="outline"
              size="sm"
              className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all"
              data-testid="button-sync-accounts"
            >
              <RefreshCw className={`w-4 h-4 ${syncAccountsMutation.isPending ? 'animate-spin' : ''}`} />
              {syncAccountsMutation.isPending ? 'Syncing...' : 'Sync'}
            </Button>
            
            <Select value={selectedClientId} onValueChange={handleClientChange}>
              <SelectTrigger className="w-64 border border-gray-300 bg-white h-10 hover:border-blue-400 rounded-lg transition-all px-3" data-testid="navbar-client-selector">
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-bold text-gray-900 truncate">
                    {selectedClient?.name || 'Select Client'}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Active</span>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                {clients.map(client => (
                  <SelectItem key={client.id} value={client.id} data-testid={`navbar-client-${client.id}`}>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-orange-600" />
                      <span className="font-medium">{client.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              variant="outline"
              size="sm"
              className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
              {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
