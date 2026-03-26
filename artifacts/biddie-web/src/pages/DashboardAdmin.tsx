import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Shield, Search, UserCog, Crown, Zap, Star } from "lucide-react";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string;
  selected_plan: string | null;
  created_at: string;
}

const planConfig = {
  starter: { label: "Starter Trader", icon: Star, color: "text-blue-400" },
  active: { label: "Active Trader", icon: Zap, color: "text-amber-400" },
  pro: { label: "Pro Trader", icon: Crown, color: "text-purple-400" },
};

const DashboardAdmin = () => {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers();
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, selected_plan, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load users");
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  const updateUserPlan = async (userId: string, plan: string) => {
    setUpdating(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ selected_plan: plan })
      .eq("id", userId);
    if (error) {
      toast.error("Failed to update user plan");
    } else {
      toast.success(`Plan updated to ${planConfig[plan as keyof typeof planConfig]?.label || plan}`);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, selected_plan: plan } : u));
    }
    setUpdating(null);
  };

  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return !q || u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
  });

  if (!isAdmin) {
    return (
      <div className="h-screen flex bg-background overflow-hidden">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <DashboardHeader />
          <main className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
              <p className="text-muted-foreground text-sm mt-2">You need admin privileges to view this page.</p>
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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <UserCog className="h-6 w-6" />
                User Management
              </h1>
              <p className="text-muted-foreground text-sm mt-1">{users.length} registered users</p>
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-muted/30 border-border/50 rounded-lg"
            />
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading users...</div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const plan = user.selected_plan as keyof typeof planConfig;
                const config = planConfig[plan] || null;
                const PlanIcon = config?.icon || Star;

                return (
                  <div key={user.id} className="glass-panel rounded-xl p-4 border-border/30 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground text-sm truncate">{user.full_name || "No name"}</p>
                        {config && (
                          <span className={`flex items-center gap-1 text-[10px] font-bold ${config.color}`}>
                            <PlanIcon className="h-3 w-3" />
                            {config.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{user.email || "No email"}</p>
                      <p className="text-[10px] text-muted-foreground/60">Joined {new Date(user.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(["starter", "active", "pro"] as const).map((p) => {
                        const pc = planConfig[p];
                        const isActive = user.selected_plan === p;
                        return (
                          <Button
                            key={p}
                            size="sm"
                            variant={isActive ? "default" : "outline"}
                            disabled={isActive || updating === user.id}
                            onClick={() => updateUserPlan(user.id, p)}
                            className={`text-xs h-8 px-3 ${isActive ? "bg-primary" : "border-border/50"}`}
                          >
                            <pc.icon className="h-3 w-3 mr-1" />
                            {pc.label.split(" ")[0]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">No users found</div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DashboardAdmin;
