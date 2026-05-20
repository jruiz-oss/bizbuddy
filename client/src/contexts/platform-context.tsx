import { createContext, useContext, useState, ReactNode } from "react";

type Platform = "google" | "apple";

interface PlatformContextType {
  platform: Platform;
  setPlatform: (platform: Platform) => void;
  showPlatformModal: boolean;
  setShowPlatformModal: (show: boolean) => void;
}

const PlatformContext = createContext<PlatformContextType | undefined>(undefined);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatformState] = useState<Platform>("google");
  const [showPlatformModal, setShowPlatformModal] = useState(false);

  const setPlatform = (p: Platform) => {
    setPlatformState(p);
    setShowPlatformModal(false);
  };

  return (
    <PlatformContext.Provider value={{ platform, setPlatform, showPlatformModal, setShowPlatformModal }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatformContext() {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error("usePlatformContext must be used within a PlatformProvider");
  }
  return context;
}
