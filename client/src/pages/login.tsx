import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, CheckCircle } from "lucide-react";
const redbullIcon = "/redbullicon.png";

export default function Login() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Check authentication status
  const { data: authStatus, isLoading } = useQuery({
    queryKey: ["/api/auth/status"],
    refetchInterval: 2000, // Check every 2 seconds
  });

  const handleGoogleLogin = () => {
    setIsLoggingIn(true);
    // Redirect to Google OAuth
    window.location.href = "/auth/google";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Checking authentication...</span>
        </div>
      </div>
    );
  }

  if (authStatus?.authenticated) {
    // User is authenticated, redirect to main app
    window.location.href = "/";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="w-4 h-4" />
          <span>Authenticated! Redirecting...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* Easter Egg - Red Bull Can */}
      <div className="fixed bottom-3 right-3 group cursor-pointer" data-testid="easter-egg-redbull">
        <div className="relative">
          <img 
            src={redbullIcon} 
            alt="" 
            className="w-11 h-11 object-contain opacity-60 group-hover:opacity-100 transition-opacity"
          />
          {/* Tooltip */}
          <div className="absolute bottom-full right-0 mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="bg-gray-900 dark:bg-gray-800 text-white text-[10px] rounded py-1.5 px-2.5 shadow-lg border border-gray-700 text-center">
              <div>Created By Jorgey Porgie</div>
              <div className="absolute top-full right-6 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[3px] border-transparent border-t-gray-900 dark:border-t-gray-800"></div>
            </div>
          </div>
        </div>
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-2">
            <img
              src="/bizbuddy-logo-white.png"
              alt="BizBuddy"
              className="h-32 object-contain"
            />
          </div>
          <CardDescription>
            Sign in with your agency Google account to manage multiple client business profiles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="text-center">
              <Badge variant="secondary" className="mb-4">
                Agency Authentication
              </Badge>
            </div>

            <Button
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="w-full h-12"
              data-testid="button-google-login"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting to Google...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>
          </div>

          <div className="text-center">
            <a 
              href="https://support.google.com/business/answer/3038063" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Learn about Google Business Profile permissions
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
