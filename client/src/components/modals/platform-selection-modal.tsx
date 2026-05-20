import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePlatformContext } from "@/contexts/platform-context";
import { MapPin } from "lucide-react";
import { SiGoogle, SiApple } from "react-icons/si";

interface PlatformSelectionModalProps {
  open: boolean;
}

export function PlatformSelectionModal({ open }: PlatformSelectionModalProps) {
  const { setPlatform, setShowPlatformModal } = usePlatformContext();

  const handleSelect = (platform: "google" | "apple") => {
    setPlatform(platform);
  };

  return (
    <Dialog open={open} onOpenChange={setShowPlatformModal}>
      <DialogContent className="sm:max-w-md" data-testid="modal-platform-selection">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">Choose Platform</DialogTitle>
          <DialogDescription className="text-center">
            Which platform would you like to manage?
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-2 gap-4 py-6">
          <Button
            variant="outline"
            className="h-32 flex flex-col items-center justify-center gap-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 transition-all"
            onClick={() => handleSelect("google")}
            data-testid="button-select-google"
          >
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 via-red-500 to-yellow-500 flex items-center justify-center">
              <SiGoogle className="w-7 h-7 text-white" />
            </div>
            <span className="font-semibold text-lg">Google</span>
            <span className="text-xs text-muted-foreground">Business Profile</span>
          </Button>
          
          <Button
            variant="outline"
            className="h-32 flex flex-col items-center justify-center gap-3 hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
            onClick={() => handleSelect("apple")}
            data-testid="button-select-apple"
          >
            <div className="w-14 h-14 rounded-full bg-black flex items-center justify-center">
              <SiApple className="w-8 h-8 text-white" />
            </div>
            <span className="font-semibold text-lg">Apple</span>
            <span className="text-xs text-muted-foreground">Maps Connect</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
