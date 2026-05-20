import { createContext, useContext, useState, ReactNode } from "react";

interface JobProgressContextType {
  currentJobId: string | null;
  jobType: "hours" | "posts" | "photos" | null;
  startJobProgress: (jobId: string, jobType: "hours" | "posts" | "photos") => void;
  clearJobProgress: () => void;
}

const JobProgressContext = createContext<JobProgressContextType | undefined>(undefined);

export function JobProgressProvider({ children }: { children: ReactNode }) {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobType, setJobType] = useState<"hours" | "posts" | "photos" | null>(null);

  const startJobProgress = (jobId: string, type: "hours" | "posts" | "photos") => {
    setCurrentJobId(jobId);
    setJobType(type);
  };

  const clearJobProgress = () => {
    setCurrentJobId(null);
    setJobType(null);
  };

  return (
    <JobProgressContext.Provider value={{ currentJobId, jobType, startJobProgress, clearJobProgress }}>
      {children}
    </JobProgressContext.Provider>
  );
}

export function useJobProgressContext() {
  const context = useContext(JobProgressContext);
  if (context === undefined) {
    throw new Error("useJobProgressContext must be used within a JobProgressProvider");
  }
  return context;
}
