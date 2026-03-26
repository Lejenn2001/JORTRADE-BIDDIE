import { useState, useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import SignalAccuracyPanel from "@/components/dashboard/SignalAccuracyPanel";
import { useMarketData } from "@/hooks/useMarketData";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const DashboardAnalytics = () => {
  const { session } = useAuth();
  const { signals, loading: signalsLoading } = useMarketData();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!session?.user?.id) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    };
    checkAdmin();
  }, [session?.user?.id]);

  if (isAdmin === null) {
    return (
      <div className="h-screen flex bg-background overflow-hidden">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="h-screen flex bg-background overflow-hidden">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <DashboardHeader />
          <main className="flex-1 flex items-center justify-center bg-mesh">
            <div className="text-center space-y-3">
              <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="text-lg font-bold text-foreground">Admin Access Only</h2>
              <p className="text-sm text-muted-foreground">You don't have permission to view this page.</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-mesh">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-foreground">Analytics</h1>
                <p className="text-sm text-muted-foreground">Signal accuracy tracking</p>
              </div>
            </div>

          {signalsLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <SignalAccuracyPanel isAdmin={!!isAdmin} liveSignals={signals} />
          )}
        </main>
      </div>
    </div>
  );
};

export default DashboardAnalytics;
