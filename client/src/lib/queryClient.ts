import { QueryClient, QueryFunction } from "@tanstack/react-query";

// VITE_API_URL is set on Vercel to point to the Railway backend (e.g. https://bizbuddy-api.railway.app)
// In local dev, Vite proxies /api and /auth to localhost:5000, so we use a relative path.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

let currentLocalUserId: string | null = null;

export function setCurrentLocalUserId(id: string | null) {
  currentLocalUserId = id;
}

export function getCurrentLocalUserId(): string | null {
  return currentLocalUserId;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isFormData = data instanceof FormData;
  
  const headers: Record<string, string> = {};
  if (!isFormData && data) {
    headers["Content-Type"] = "application/json";
  }
  if (currentLocalUserId) {
    headers["X-Local-User-Id"] = currentLocalUserId;
  }
  
  const res = await fetch(getApiUrl(url), {
    method,
    headers,
    body: isFormData ? data : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(getApiUrl(queryKey.join("/")), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
