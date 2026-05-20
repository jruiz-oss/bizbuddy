import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  BarChart3, MapPin, MessageSquare, 
  Building2, History, Settings, Clock, Lightbulb, Star, Share2
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlatformContext } from "@/contexts/platform-context";
import { PlatformSwitchButton } from "@/components/platform-switch-button";
import type { Client } from "@shared/schema";

interface SidebarProps {
  selectedClient?: Client;
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
}

export function Sidebar({ selectedClient, selectedClientId, setSelectedClientId }: SidebarProps) {
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });
  const [location] = useLocation();
  const { platform, setShowPlatformModal } = usePlatformContext();

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setShowPlatformModal(true);
  };
  
  const isActive = (path: string) => {
    if (path === '/') {
      return location === '/' || location === '/dashboard';
    }
    return location === path;
  };

  const linkClass = (path: string) => 
    isActive(path)
      ? "flex items-center gap-3 px-4 py-3 text-sm font-semibold bg-[#001f3f] text-white rounded-xl shadow-lg transition-all duration-200"
      : "flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-all duration-200";

  return (
    <aside className="w-64 bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-r border-gray-200 dark:border-gray-800 flex flex-col fixed h-full shadow-xl">
      {/* Logo Section with Client Selector */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-800">
        <Select value={selectedClientId} onValueChange={handleClientChange}>
          <SelectTrigger className="w-full border-2 border-gray-200 dark:border-gray-700 h-12 hover:border-orange-400 dark:hover:border-orange-600 hover:shadow-md rounded-xl transition-all px-4" data-testid="sidebar-client-selector">
            <div className="flex items-center justify-between w-full">
              <span className="text-base font-bold text-gray-900 dark:text-white truncate">
                {selectedClient?.name || 'Select Client'}
              </span>
              <span className="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase tracking-wider">Active</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            {clients.map(client => (
              <SelectItem key={client.id} value={client.id} data-testid={`sidebar-client-${client.id}`}>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-orange-600" />
                  <span className="font-medium">{client.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* FranchiseHub Branding */}
      <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/20 dark:to-orange-900/10">
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-md">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900 dark:text-white">BizBuddy</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 font-medium ml-11">
          {platform === "google" ? "Google Business Profile" : "Apple Maps Connect"}
        </p>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-4 pt-6">
        {platform === "google" ? (
          <>
            {/* Google Business Profile Section */}
            <div className="mb-8">
              <p className="text-xs font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-4">
                MANAGE
              </p>
              <ul className="space-y-2">
                <li>
                  <Link href="/" className={linkClass('/')} data-testid="link-dashboard">
                    <BarChart3 className="w-5 h-5" />
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link href="/locations" className={linkClass('/locations')} data-testid="link-locations">
                    <MapPin className="w-5 h-5" />
                    Locations
                  </Link>
                </li>
                <li>
                  <Link href="/posts" className={linkClass('/posts')} data-testid="link-posts">
                    <MessageSquare className="w-5 h-5" />
                    Posts & Updates
                  </Link>
                </li>
                <li>
                  <Link href="/hours" className={linkClass('/hours')} data-testid="link-hours">
                    <Clock className="w-5 h-5" />
                    Business Hours
                  </Link>
                </li>
                <li>
                  <Link href="/social-media" className={linkClass('/social-media')} data-testid="link-social-media">
                    <Share2 className="w-5 h-5" />
                    Social Media
                  </Link>
                </li>
                <li>
                  <Link href="/reviews" className={linkClass('/reviews')} data-testid="link-reviews">
                    <Star className="w-5 h-5" />
                    Reviews
                  </Link>
                </li>
                <li>
                  <Link href="/suggested-edits" className={linkClass('/suggested-edits')} data-testid="link-suggested-edits">
                    <Lightbulb className="w-5 h-5" />
                    Suggested Edits
                  </Link>
                </li>
              </ul>
            </div>
          </>
        ) : (
          <>
            {/* Apple Maps Section */}
            <div className="mb-8">
              <p className="text-xs font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-4">
                APPLE MAPS
              </p>
              <ul className="space-y-2">
                <li>
                  <Link href="/apple-maps" className={linkClass('/apple-maps')} data-testid="link-apple-maps">
                    <MapPin className="w-5 h-5" />
                    Locations
                  </Link>
                </li>
              </ul>
            </div>
          </>
        )}

        {/* Management Section */}
        <div>
          <p className="text-xs font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-4">
            ADMIN
          </p>
          <ul className="space-y-2">
            <li>
              <Link href="/jobs" className={linkClass('/jobs')} data-testid="link-activity">
                <History className="w-5 h-5" />
                Activity Log
              </Link>
            </li>
            <li>
              <Link href="/settings" className={linkClass('/settings')} data-testid="link-settings">
                <Settings className="w-5 h-5" />
                Settings
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </aside>
  );
}
