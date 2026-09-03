import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { setCurrentLocalUserId, getApiUrl } from "@/lib/queryClient";
import type { LocalUser } from "@shared/schema";

const STORAGE_KEY = "bizbuddy_local_user_id";

type ModalMode = 'select' | 'manage';

interface LocalUserContextType {
  selectedLocalUser: LocalUser | null;
  setSelectedLocalUser: (user: LocalUser | null) => void;
  showSelectionModal: boolean;
  setShowSelectionModal: (show: boolean) => void;
  openSelectionModal: (mode?: ModalMode) => void;
  modalMode: ModalMode;
  logout: () => void;
}

const LocalUserContext = createContext<LocalUserContextType | undefined>(undefined);

export function LocalUserProvider({ children }: { children: ReactNode }) {
  const [selectedLocalUser, setSelectedLocalUserState] = useState<LocalUser | null>(null);
  // Hidden until we've checked localStorage; then we show it if no user is saved
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('select');
  const [initialized, setInitialized] = useState(false);

  // On mount: ask the SERVER who is logged in. The server session (set by
  // /api/local-users/:id/login) is the only thing that actually authorizes API
  // calls, so it — not localStorage — decides whether we're signed in. Trusting
  // localStorage meant a browser could render the app after its session had
  // expired, then 401 on every request and look like a Google/auth outage.
  // localStorage is still written, but only as a hint for which profile to
  // pre-select in the picker.
  useEffect(() => {
    fetch(getApiUrl(`/api/auth/session`), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data?.localUser ?? null;
        if (user) {
          setSelectedLocalUserState(user);
          setCurrentLocalUserId(user.id);
          localStorage.setItem(STORAGE_KEY, user.id);
          setShowSelectionModal(false);
        } else {
          // No server session — show the picker. Keep the saved id so the
          // modal can highlight the profile this browser last used.
          setShowSelectionModal(true);
        }
      })
      .catch(() => {
        // Network/server hiccup: don't pretend we're signed in.
        setShowSelectionModal(true);
      })
      .finally(() => setInitialized(true));
  }, []);

  const setSelectedLocalUser = useCallback((user: LocalUser | null) => {
    setSelectedLocalUserState(user);
    setCurrentLocalUserId(user?.id || null);
    if (user) {
      localStorage.setItem(STORAGE_KEY, user.id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    // Also end the SERVER session. Clearing client state alone used to leave the
    // session cookie valid — now that we restore identity from the server on
    // mount, that would silently sign you back in on the next refresh.
    fetch(getApiUrl(`/api/auth/logout`), { method: "POST", credentials: "include" })
      .catch(() => { /* best effort — still drop client state below */ });
    setSelectedLocalUser(null);
    setModalMode('select');
    setShowSelectionModal(true);
  }, [setSelectedLocalUser]);

  const openSelectionModal = useCallback((mode: ModalMode = 'select') => {
    setModalMode(mode);
    setShowSelectionModal(true);
  }, []);

  // Don't render children until we've resolved the saved session
  if (!initialized) return null;

  return (
    <LocalUserContext.Provider value={{
      selectedLocalUser,
      setSelectedLocalUser,
      showSelectionModal,
      setShowSelectionModal,
      openSelectionModal,
      modalMode,
      logout,
    }}>
      {children}
    </LocalUserContext.Provider>
  );
}

export function useLocalUserContext() {
  const context = useContext(LocalUserContext);
  if (context === undefined) {
    throw new Error("useLocalUserContext must be used within a LocalUserProvider");
  }
  return context;
}
