import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { parseApiError } from "@/lib/parseApiError";

// Public page reached from the "Reset your BizBuddy password" email — no
// Google session or local-user selection required. Reads ?token= straight
// from the URL (never persisted anywhere on this page) and exchanges it for
// a new password via a single POST; the server validates/consumes the token.
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/local-users/reset-password", { token, password });
      return res.json();
    },
    onSuccess: () => setDone(true),
    onError: (err: Error) => setError(parseApiError(err, "Something went wrong. Please try again.")),
  });

  const handleSubmit = () => {
    setError(null);
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    resetMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-2">
            <img src="/bizbuddy-logo-white.png" alt="BizBuddy" className="h-24 object-contain" />
          </div>
          <CardTitle>Reset your password</CardTitle>
          {!done && <CardDescription>Choose a new password for your account</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? (
            <p className="text-sm text-destructive text-center">
              This link is missing its reset token. Please use the link from your email exactly as sent.
            </p>
          ) : done ? (
            <div className="text-center space-y-3 py-2">
              <CheckCircle className="w-10 h-10 mx-auto text-green-600" />
              <p className="font-medium">Password updated</p>
              <p className="text-sm text-muted-foreground">You can close this tab and sign in with your new password.</p>
              <Button className="w-full" onClick={() => { window.location.href = "/"; }}>
                Go to BizBuddy
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoFocus
                  />
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm password</Label>
                <Input
                  id="reset-confirm-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Re-enter your new password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!password || !confirmPassword || resetMutation.isPending}
              >
                {resetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update Password
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
