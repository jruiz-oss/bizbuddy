import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, MapPin, Star, Eye, MessageSquare, Camera } from "lucide-react";

interface DashboardOverviewProps {
  analytics: {
    current: {
      totalLocations: number;
      averageRating: number;
      profileViews: number;
      postsCount: number;
      photosCount: number;
    };
    previous: {
      totalLocations: number;
      averageRating: number;
      profileViews: number;
      postsCount: number;
      photosCount: number;
    };
    trends: {
      totalLocations: number;
      averageRating: number;
      profileViews: number;
      postsCount: number;
      photosCount: number;
    };
  };
}

export function DashboardOverview({ analytics }: DashboardOverviewProps) {
  const formatTrend = (trend: number | null | undefined) => {
    if (trend === null || trend === undefined) {
      return (
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100">
          <span className="text-xs font-medium text-gray-600">N/A</span>
        </div>
      );
    }
    
    const isPositive = trend > 0;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;
    const color = isPositive ? "text-green-600" : "text-red-600";
    const bgColor = isPositive ? "bg-green-100" : "bg-red-100";
    
    return (
      <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${bgColor}`}>
        <TrendIcon className={`w-3 h-3 ${color}`} />
        <span className={`text-xs font-medium ${color}`}>
          {isPositive ? '+' : ''}{trend.toFixed(1)}%
        </span>
      </div>
    );
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const MetricCard = ({ 
    icon: Icon, 
    title, 
    value, 
    trend, 
    subtitle,
    testId,
    headerColor,
    headerTextColor
  }: {
    icon: any;
    title: string;
    value: string | number;
    trend: number;
    subtitle: string;
    testId: string;
    headerColor?: string;
    headerTextColor?: string;
  }) => (
    <Card className="hover:shadow-md transition-shadow overflow-hidden bg-white">
      <CardContent className="p-0">
        <div className={`flex items-center justify-between p-4 ${headerColor || 'bg-muted/30'}`}>
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${headerTextColor || 'text-gray-700 dark:text-gray-300'}`} />
            <span className={`text-sm font-medium ${headerTextColor || 'text-gray-700 dark:text-gray-300'}`}>{title}</span>
          </div>
          {formatTrend(trend)}
        </div>
        
        <div className="space-y-1 p-6 pt-4">
          <div 
            className="text-2xl font-bold text-gray-900"
            data-testid={`${testId}-value`}
          >
            {value}
          </div>
          <p className="text-xs text-gray-700">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Performance metrics compared to last week
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={MapPin}
          title="Total Locations"
          value={analytics.current.totalLocations}
          trend={analytics.trends.totalLocations}
          subtitle="Business locations"
          testId="metric-locations"
          headerColor="bg-blue-50 dark:bg-blue-950/30"
        />
        
        <MetricCard
          icon={Star}
          title="Average Rating"
          value={analytics.current.averageRating.toFixed(1)}
          trend={analytics.trends.averageRating}
          subtitle="Across all locations"
          testId="metric-rating"
          headerColor="bg-amber-50 dark:bg-amber-950/30"
        />
        
        <MetricCard
          icon={Eye}
          title="Profile Views"
          value={formatNumber(analytics.current.profileViews)}
          trend={analytics.trends.profileViews}
          subtitle="This week"
          testId="metric-views"
          headerColor="bg-purple-50 dark:bg-purple-950/30"
        />
        
        <MetricCard
          icon={MessageSquare}
          title="Posts Published"
          value={analytics.current.postsCount}
          trend={analytics.trends.postsCount}
          subtitle="This week"
          testId="metric-posts"
          headerColor="bg-green-50 dark:bg-green-950/30"
          headerTextColor="text-green-700 dark:text-green-300"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Photos Added</span>
              </div>
              {formatTrend(analytics.trends.photosCount)}
            </div>
            
            <div className="space-y-2">
              <div 
                className="text-2xl font-bold text-foreground"
                data-testid="metric-photos-value"
              >
                {analytics.current.photosCount}
              </div>
              <p className="text-xs text-muted-foreground">This week</p>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-muted-foreground">Weekly Summary</span>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Profile engagement</span>
                <Badge variant={analytics.trends.profileViews > 0 ? "default" : "secondary"}>
                  {analytics.trends.profileViews > 0 ? "Growing" : "Declining"}
                </Badge>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Content activity</span>
                <Badge variant={analytics.trends.postsCount > 0 ? "default" : "secondary"}>
                  {analytics.trends.postsCount > 0 ? "Active" : "Low"}
                </Badge>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Overall trend</span>
                <Badge variant="default" data-testid="summary-trend">
                  {(analytics.trends.profileViews + analytics.trends.postsCount) / 2 > 0 ? "Positive" : "Needs attention"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}