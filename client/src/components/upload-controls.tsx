import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, MessageSquare, Camera, FileText } from "lucide-react";
import { PostCreationModal } from "@/components/modals/post-creation-modal";
import { HoursEditorModal } from "@/components/modals/hours-editor-modal";
import { PhotoUploadModal } from "@/components/modals/photo-upload-modal";

interface UploadControlsProps {
  clientId: string;
  selectedLocationIds: string[];
}

export function UploadControls({ clientId, selectedLocationIds }: UploadControlsProps) {
  const [showPostModal, setShowPostModal] = useState(false);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);

  const handleActionClick = (type: "hours" | "posts" | "photos") => {
    switch (type) {
      case "posts":
        setShowPostModal(true);
        break;
      case "hours":
        setShowHoursModal(true);
        break;
      case "photos":
        setShowPhotoModal(true);
        break;
    }
  };

  const ActionButton = ({ 
    type, 
    icon: Icon, 
    title, 
    description,
    disabled = false
  }: {
    type: "hours" | "posts" | "photos";
    icon: any;
    title: string;
    description: string;
    disabled?: boolean;
  }) => (
    <Button
      variant="outline"
      className="h-auto p-4 flex-col gap-2 hover:border-primary hover:bg-accent transition-all group"
      onClick={() => handleActionClick(type)}
      disabled={disabled || !clientId || selectedLocationIds.length === 0}
      data-testid={`button-${type}-action`}
    >
      <Icon className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </Button>
  );

  return (
    <>
      <div className="space-y-6">
        {/* Action Buttons */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Content Actions</h3>
            {selectedLocationIds.length > 0 ? (
              <span className="text-xs text-muted-foreground">({selectedLocationIds.length} locations selected)</span>
            ) : (
              <span className="text-xs text-muted-foreground text-orange-600">(Select locations first)</span>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ActionButton
              type="posts"
              icon={MessageSquare}
              title="Create Posts"
              description="Write and publish posts"
            />
            
            <ActionButton
              type="hours"
              icon={Clock}
              title="Edit Hours"
              description="Update business hours"
            />
            
            <ActionButton
              type="photos"
              icon={Camera}
              title="Upload Photos"
              description="Add photos to locations"
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <PostCreationModal
        open={showPostModal}
        onClose={() => setShowPostModal(false)}
        clientId={clientId}
        selectedLocationIds={selectedLocationIds}
      />
      
      <HoursEditorModal
        open={showHoursModal}
        onClose={() => setShowHoursModal(false)}
        clientId={clientId}
        selectedLocationIds={selectedLocationIds}
      />
      
      <PhotoUploadModal
        open={showPhotoModal}
        onClose={() => setShowPhotoModal(false)}
        clientId={clientId}
        selectedLocationIds={selectedLocationIds}
      />
    </>
  );
}