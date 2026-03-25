import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import SignalAlerts from "./SignalAlerts";

const DashboardHeader = () => {
  const { profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const initial = firstName.charAt(0).toUpperCase();

  return (
    <header className="h-16 glass-panel border-b border-border/60 flex items-center justify-between px-6 pl-14 lg:pl-6 shrink-0 overflow-visible relative z-20">
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search signals, tickers..."
          className="bg-transparent border-none shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex items-center gap-4">
        <SignalAlerts />
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">{initial}</span>
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-medium text-foreground">{firstName}</div>
            <div className="text-xs text-muted-foreground">Pro Member</div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
