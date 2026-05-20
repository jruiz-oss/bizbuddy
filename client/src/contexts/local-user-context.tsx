import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { setCurrentLocalUserId } from "@/lib/queryClient";
import type { LocalUser } from "@shared/schema";

type ModalMode = 'select' | 'manage';

interface LocalUserContextType {
  selectedLocalUser: LocalUser | null;
  setSelectedLocalUser: (user: LocalUser | null) => void;
  showSelectionModal: boolean;
  setShowSelectionModal: (show: boolean) => void;
  openSelectionModal: (mode?: ModalMode) => void;
  modalMode: ModalMode;
}

const LocalUserContext = createContext<LocalUserContextType | undefined>(undefined);

export function LocalUserProvider({ children }: { children: ReactNode }) {
  const [selectedLocalUser, setSelectedLocalUserState] = useState<LocalUser | null>(null);
  const [showSelectionModal, setShowSelectionModal] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>('select');

  const setSelectedLocalUser = useCallback((user: LocalUser | null) => {
    setSelectedLocalUserState(user);
    setCurrentLocalUserId(user?.id || null);
  }, []);

  const openSelectionModal = useCallback((mode: ModalMode = 'select') => {
    setModalMode(mode);
    setShowSelectionModal(true);
  }, []);

  return (
    <LocalUserContext.Provider value={{ 
      selectedLocalUser, 
      setSelectedLocalUser, 
      showSelectionModal, 
      setShowSelectionModal,
      openSelectionModal,
      modalMode
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
