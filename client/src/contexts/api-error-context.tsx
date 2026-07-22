import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ApiErrorState {
  open: boolean;
  title: string;
  message: string;
  isAuthError: boolean;
}

interface ShowApiErrorOptions {
  /** Only true when the failure is a genuine Google session/auth problem that
   *  re-authenticating would fix. Gates the "Re-authenticate with Google" CTA. */
  isAuthError?: boolean;
}

interface ApiErrorContextValue {
  showApiError: (title: string, message: string, options?: ShowApiErrorOptions) => void;
  clearApiError: () => void;
  error: ApiErrorState;
}

const ApiErrorContext = createContext<ApiErrorContextValue | null>(null);

export function ApiErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ApiErrorState>({ open: false, title: "", message: "", isAuthError: false });

  const showApiError = useCallback((title: string, message: string, options?: ShowApiErrorOptions) => {
    setError({ open: true, title, message, isAuthError: options?.isAuthError ?? false });
  }, []);

  const clearApiError = useCallback(() => {
    setError({ open: false, title: "", message: "", isAuthError: false });
  }, []);

  return (
    <ApiErrorContext.Provider value={{ showApiError, clearApiError, error }}>
      {children}
    </ApiErrorContext.Provider>
  );
}

export function useApiError() {
  const ctx = useContext(ApiErrorContext);
  if (!ctx) throw new Error("useApiError must be used within ApiErrorProvider");
  return ctx;
}
