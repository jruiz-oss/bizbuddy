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

  // On mount: try to restore the saved user from localStorage
  useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      fetch(getApiUrl(`/api/local-users/${savedId}`), { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((user) => {
          if (user) {
            setSelectedLocalUserState(user);
            setCurrentLocalUserId(user.id);
            setShowSelectionModal(false);
          } else {
            localStorage.removeItem(STORAGE_KEY);
            setShowSelectionModal(true);
          }
        })
        .catch(() => {
          localStorage.removeItem(STORAGE_KEY);
          setShowSelectionModal(true);
        })
        .finally(() => setInitialized(true));
    } else {
      setShowSelectionModal(true);
      setInitialized(true);
    }
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
