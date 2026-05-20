import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// In production the frontend (Vercel) and backend (Railway) are on different domains.
// Intercept all relative fetch calls so /api/... and /auth/... automatically go to Railway.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
if (API_BASE) {
  const _originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && (input.startsWith('/api/') || input.startsWith('/auth/'))) {
      return _originalFetch(API_BASE + input, { credentials: 'include', ...init });
    }
    return _originalFetch(input, init);
  };
}

createRoot(document.getElementById("root")!).render(<App />);
