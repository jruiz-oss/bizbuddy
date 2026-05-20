import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ApiErrorState {
  open: boolean;
  title: string;
  message: string;
}

interface ApiErrorContextValue {
  showApiError: (title: string, message: string) => void;
  clearApiError: () => void;
  error: ApiErrorState;
}

const ApiErrorContext = createContext<ApiErrorContextValue | null>(null);

export function ApiErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ApiErrorState>({ open: false, title: "", message: "" });

  const showApiError = useCallback((title: string, message: string) => {
    setError({ open: true, title, message });
  }, []);

  const clearApiError = useCallback(() => {
    setError({ open: false, title: "", message: "" });
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
