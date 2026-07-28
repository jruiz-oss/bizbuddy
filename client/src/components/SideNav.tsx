import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Home,
  MapPin,
  MessageSquare,
  Clock,
  Share2,
  PenLine,
  Star,
  History,
  Settings,
  Loader2,
} from "lucide-react";
import logoPath from "@/assets/bizbuddy-logo.png";
import { useScanProgress } from "@/contexts/scan-progress-context";

type NavItem = {
  href: string;
  icon: typeof Home;
  label: string;
  countKey?: "locations" | "edits";
  badgeTone?: "amber" | "neutral";
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const sections: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", icon: Home, label: "Dashboard" }],
  },
  {
    label: "Manage",
    items: [
      { href: "/locations", icon: MapPin, label: "Locations", countKey: "locations", badgeTone: "neutral" },
      { href: "/posts", icon: MessageSquare, label: "Posts" },
      { href: "/hours", icon: Clock, label: "Hours" },
      { href: "/social-media", icon: Share2, label: "Social" },
    ],
  },
  {
    label: "Quality",
    items: [
      { href: "/suggested-edits", icon: PenLine, label: "Suggested Edits", countKey: "edits", badgeTone: "amber" },
      { href: "/reviews", icon: Star, label: "Reviews" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/jobs", icon: History, label: "Activity" },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

export function SideNav() {
  const [location] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { data: allLocations = [] } = useQuery<any[]>({ queryKey: ["/api/locations/all"] });

  // Suggested-edit counts come from the last persisted scan run, not the
  // legacy suggested_edits table (which is never written to, so this badge was
  // permanently 0). While a scan is running the badge becomes a spinner, so a
  // scan is visible from anywhere in the app.
  const { results: scanResults, isScanning } = useScanProgress();

  const counts: Record<string, number> = {
    locations: allLocations.length,
    edits: scanResults.length,
  };

  const lcQuery = query.trim().toLowerCase();
  const filterItem = (item: NavItem) => !lcQuery || item.label.toLowerCase().includes(lcQuery);

  return (
    <div className="w-56 bg-white border-r border-gray-200 min-h-screen flex flex-col fixed left-0 top-0">
      <div className="px-4 pt-4 pb-3">
        <Link href="/dashboard">
          <img src={logoPath} alt="BizBuddy" className="w-3/4 h-auto object-contain rounded-md cursor-pointer" />
        </Link>
      </div>
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Jump to..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-11 py-2 text-[13px] text-gray-700 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-gray-300 focus:ring-0"
            data-testid="input-nav-search"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium pointer-events-none">
            ⌘K
          </kbd>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
        {sections.map((section) => {
          const visibleItems = section.items.filter(filterItem);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label}>
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 px-2 mb-1.5"
                data-testid={`nav-section-${section.label.toLowerCase()}`}
              >
                {section.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    location === item.href ||
                    (item.href === "/dashboard" && (location === "/" || location === "/analytics"));
                  const count = item.countKey ? counts[item.countKey] : undefined;
                  const showSpinner = item.countKey === "edits" && isScanning;
                  const showBadge = !showSpinner && typeof count === "number" && count > 0;
                  const badgeClass =
                    item.badgeTone === "amber"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600";

                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                          isActive ? "bg-[#001f3f] text-white" : "text-gray-700 hover:bg-gray-50"
                        }`}
                        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon
                          className={`w-[18px] h-[18px] ${isActive ? "text-white" : "text-gray-500"}`}
                        />
                        <span className="text-[14px] font-medium flex-1 truncate">{item.label}</span>
                        {showSpinner && (
                          <Loader2
                            className={`w-3.5 h-3.5 animate-spin ${isActive ? "text-white" : "text-orange-500"}`}
                            data-testid="nav-spinner-suggested-edits"
                          />
                        )}
                        {showBadge && (
                          <span
                            className={`text-[11px] font-semibold rounded-full px-1.5 py-0.5 leading-none ${
                              isActive ? "bg-white/20 text-white" : badgeClass
                            }`}
                            data-testid={`nav-badge-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            {count}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
