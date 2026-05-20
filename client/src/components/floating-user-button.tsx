import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocalUserContext } from "@/contexts/local-user-context";
import { RefreshCw, Users } from "lucide-react";

export function FloatingUserButton() {
  const { selectedLocalUser, openSelectionModal } = useLocalUserContext();
  const [open, setOpen] = useState(false);

  if (!selectedLocalUser) return null;

  const getInitials = (name: string) => {
    if (!name) return "?";
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleSwitch = () => {
    setOpen(false);
    openSelectionModal('select');
  };

  const handleManageTeam = () => {
    setOpen(false);
    openSelectionModal('manage');
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 ring-4 ring-white dark:ring-gray-800 hover:scale-105 focus:outline-none focus:ring-orange-400"
            data-testid="button-floating-user"
          >
            <Avatar className="h-14 w-14">
              {selectedLocalUser.profilePictureUrl && (
                <AvatarImage src={selectedLocalUser.profilePictureUrl} alt={selectedLocalUser.name} />
              )}
              <AvatarFallback className="text-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white font-semibold">
                {getInitials(selectedLocalUser.name)}
              </AvatarFallback>
            </Avatar>
          </button>
        </PopoverTrigger>
        <PopoverContent 
          side="top" 
          align="end" 
          className="w-64 p-4"
          data-testid="popover-user-menu"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                {selectedLocalUser.profilePictureUrl && (
                  <AvatarImage src={selectedLocalUser.profilePictureUrl} alt={selectedLocalUser.name} />
                )}
                <AvatarFallback className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                  {getInitials(selectedLocalUser.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate" data-testid="text-current-user-name">
                  {selectedLocalUser.name}
                </p>
                {selectedLocalUser.title && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate" data-testid="text-current-user-title">
                    {selectedLocalUser.title}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleSwitch}
                data-testid="button-switch-user"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Switch
              </Button>
              {selectedLocalUser.role === 'super_admin' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleManageTeam}
                  data-testid="button-manage-team"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Team
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
