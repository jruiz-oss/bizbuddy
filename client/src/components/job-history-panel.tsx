import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Clock, Download, Eye, CheckCircle, AlertCircle, Zap, Undo2, Loader2 } from "lucide-react";
import { formatPhoenixDateTime } from "@/lib/formatDate";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Job } from "@shared/schema";

interface JobHistoryPanelProps {
  jobs: Job[];
}

export function JobHistoryPanel({ jobs }: JobHistoryPanelProps) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [jobToUndo, setJobToUndo] = useState<Job | null>(null);
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const { toast } = useToast();

  const undoJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("DELETE", `/api/jobs/${jobId}/undo`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Job Undone",
        description: data.message || "The job has been undone successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setShowUndoConfirm(false);
      setJobToUndo(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to undo job",
        variant: "destructive",
      });
    },
  });

  const handleUndoClick = (job: Job) => {
    setJobToUndo(job);
    setShowUndoConfirm(true);
  };

  const confirmUndo = () => {
    if (jobToUndo) {
      undoJobMutation.mutate(jobToUndo.id);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "partial":
        return "bg-yellow-100 text-yellow-800";
      case "running":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getJobTypeIcon = (type: string) => {
    switch (type) {
      case "hours":
        return "fas fa-clock";
      case "posts":
        return "fas fa-bullhorn";
      case "photo":
        return "fas fa-camera";
      default:
        return "fas fa-cog";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case "partial":
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case "running":
        return <Zap className="w-5 h-5 text-blue-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const handleViewDetails = (job: Job) => {
    setSelectedJob(job);
    setShowDetails(true);
  };

  const handleDownloadResults = (jobId: string) => {
    window.open(`/api/jobs/${jobId}/results.csv`, '_blank');
  };

  return (
    <aside className="w-80 bg-card border-l border-border flex flex-col">
      <CardHeader className="p-4 border-b border-border">
        <CardTitle className="text-base">Job History</CardTitle>
        <p className="text-xs text-muted-foreground">Last 20 jobs</p>
      </CardHeader>
      
      <CardContent className="flex-1 p-4 overflow-auto space-y-3">
        {jobs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No jobs yet</p>
            <p className="text-xs text-muted-foreground">Upload a CSV to get started</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="p-3 bg-muted/30 rounded-lg"
              data-testid={`job-history-item-${job.id}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <i className={`${getJobTypeIcon(job.type)} text-sm text-muted-foreground`}></i>
                  <span className="text-sm font-medium capitalize">
                    {job.type} {job.type === "photo" ? "Upload" : job.type === "posts" ? "" : "Update"}
                  </span>
                  {job.isScheduled && (
                    <Badge variant="outline" className="text-xs">
                      <Clock className="w-3 h-3 mr-1" />
                      Scheduled
                    </Badge>
                  )}
                </div>
                <Badge className={`text-xs ${getStatusColor(job.status)}`} data-testid={`job-status-${job.id}`}>
                  {job.status}
                </Badge>
              </div>
              
              <p className="text-xs text-muted-foreground mb-1">
                {job.status === "success" && `${job.successCount}/${job.totalItems} locations`}
                {job.status === "partial" && `${job.successCount}/${job.totalItems} locations`}
                {job.status === "failed" && `Failed to process`}
                {job.status === "running" && `Processing...`}
                {job.status === "queued" && `Queued for processing`}
              </p>
              
              <p className="text-xs text-muted-foreground mb-2">
                {formatPhoenixDateTime(job.createdAt)}
              </p>
              
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2"
                  onClick={() => handleViewDetails(job)}
                  data-testid={`button-view-details-${job.id}`}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  Details
                </Button>
                {(job.status === "success" || job.status === "partial" || job.status === "failed") && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 px-2"
                      onClick={() => handleDownloadResults(job.id)}
                      data-testid={`button-download-results-${job.id}`}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleUndoClick(job)}
                      data-testid={`button-undo-job-${job.id}`}
                    >
                      <Undo2 className="w-3 h-3 mr-1" />
                      Undo
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>

      {/* Job Details Dialog */}
      {selectedJob && (
        <Dialog open={showDetails} onOpenChange={setShowDetails}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader className="border-b pb-4">
              <DialogTitle className="text-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  {getStatusIcon(selectedJob.status)}
                </div>
                <div className="flex-1 text-left">
                  <div className="capitalize">
                    {selectedJob.type === "photo" ? "Photo Upload" : selectedJob.type === "posts" ? "Create Posts" : "Update " + selectedJob.type}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-normal">
                    {formatPhoenixDateTime(selectedJob.createdAt)}
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* Status Overview */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Status</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
                    <Badge className={`w-full justify-center mb-2 ${getStatusColor(selectedJob.status)}`}>
                      {selectedJob.status.toUpperCase()}
                    </Badge>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Job Status</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400 mb-1">
                      {selectedJob.successCount}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Successful</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400 mb-1">
                      {selectedJob.totalItems - selectedJob.successCount}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Failed/Skipped</p>
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold mb-2">
                    Total Locations
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedJob.totalItems}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold mb-2">
                    Type
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                    {selectedJob.type === "photo" ? "Photo Upload" : selectedJob.type === "posts" ? "Posts" : selectedJob.type}
                  </p>
                </div>
              </div>

              {/* Timestamps */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold mb-2">
                  Timeline
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Created:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {new Date(selectedJob.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {selectedJob.updatedAt && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Updated:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {new Date(selectedJob.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Scheduled Info */}
              {selectedJob.isScheduled && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                  <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold mb-2">
                    Scheduling
                  </p>
                  <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                    <Clock className="w-3 h-3 mr-1" />
                    This is a scheduled job
                  </Badge>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Undo Confirmation Dialog */}
      <Dialog open={showUndoConfirm} onOpenChange={setShowUndoConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Undo2 className="w-5 h-5" />
              Confirm Undo Job
            </DialogTitle>
            <DialogDescription className="pt-2">
              {jobToUndo && (
                <>
                  Are you sure you want to undo this{" "}
                  <strong className="text-foreground">
                    {jobToUndo.type === "posts" ? "post creation" : jobToUndo.type} job
                  </strong>
                  ?
                  <div className="mt-3 p-3 bg-muted rounded-lg">
                    <p className="text-sm">
                      <strong>{jobToUndo.successCount}</strong> of{" "}
                      <strong>{jobToUndo.totalItems}</strong> locations will be affected
                    </p>
                    {jobToUndo.type === "posts" && (
                      <p className="text-sm text-red-600 mt-2">
                        All posts created by this job will be permanently deleted from Google Business Profile.
                      </p>
                    )}
                    {jobToUndo.type === "hours" && (
                      <p className="text-sm text-amber-600 mt-2">
                        This will remove the job record. Note: Hours changes cannot be automatically reverted - you may need to manually update them.
                      </p>
                    )}
                    {jobToUndo.type === "photo" && (
                      <p className="text-sm text-amber-600 mt-2">
                        This will remove the job record. Note: Photos uploaded to Google cannot be automatically removed.
                      </p>
                    )}
                  </div>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowUndoConfirm(false)}
              disabled={undoJobMutation.isPending}
              data-testid="button-cancel-undo"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmUndo}
              disabled={undoJobMutation.isPending}
              data-testid="button-confirm-undo"
            >
              {undoJobMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Undoing...
                </>
              ) : (
                <>
                  <Undo2 className="w-4 h-4 mr-2" />
                  Yes, Undo Job
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
