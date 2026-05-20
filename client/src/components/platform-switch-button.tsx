import { Button } from "@/components/ui/button";
import { usePlatformContext } from "@/contexts/platform-context";
import { SiGoogle, SiApple } from "react-icons/si";
import { ArrowRightLeft } from "lucide-react";

export function PlatformSwitchButton() {
  const { platform, setPlatform } = usePlatformContext();

  const switchPlatform = () => {
    setPlatform(platform === "google" ? "apple" : "google");
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={switchPlatform}
      className="flex items-center gap-2 shadow-sm hover:shadow-md transition-all bg-white dark:bg-gray-900 border border-gray-300 rounded-lg h-9 px-3"
      data-testid="button-switch-platform"
    >
      {platform === "google" ? (
        <>
          <SiApple className="w-4 h-4" />
          <span className="text-xs">Switch to Apple</span>
        </>
      ) : (
        <>
          <SiGoogle className="w-4 h-4" />
          <span className="text-xs">Switch to Google</span>
        </>
      )}
      <ArrowRightLeft className="w-3 h-3 ml-auto" />
    </Button>
  );
}
