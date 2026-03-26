import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Shield, Search, UserCog, Crown, Zap, Star, Trash2, ShieldCheck, ShieldOff, Download } from "lucide-react";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string;
  selected_plan: string | null;
  created_at: string;
  is_admin?: boolean;
}

const planConfig = {
  starter: { label: "Signal Scout", icon: Star, color: "text-blue-400" },
  active: { label: "Active Trader", icon: Zap, color: "text-amber-400" },
  pro: { label: "Pro Trader", icon: Crown, color: "text-purple-400" },
};

const DashboardAdmin = () => {
  const { isAdmin, user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers();
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, selected_plan, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load users");
      setLoading(false);
      return;
    }

    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = new Set((adminRoles || []).map(r => r.user_id));

    setUsers((profiles || []).map(p => ({ ...p, is_admin: adminIds.has(p.id) })));
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

  const toggleAdmin = async (userId: string, currentlyAdmin: boolean) => {
    setUpdating(userId);
    if (currentlyAdmin) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");
      if (error) {
        toast.error("Failed to remove admin role");
      } else {
        toast.success("Admin role removed");
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: false } : u));
      }
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });
      if (error) {
        toast.error("Failed to grant admin role");
      } else {
        toast.success("Admin role granted");
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: true } : u));
      }
    }
    setUpdating(null);
  };

  const deleteUser = async (userId: string) => {
    setUpdating(userId);
    const { error: roleError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (roleError) console.error("Error deleting roles:", roleError);

    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileError) {
      toast.error("Failed to delete user profile");
    } else {
      toast.success("User deleted");
      setUsers(prev => prev.filter(u => u.id !== userId));
    }
    setConfirmDelete(null);
    setUpdating(null);
  };

  const exportCSV = () => {
    const headers = ["Name", "Email", "Plan", "Admin", "Joined"];
    const rows = users.map(u => [
      u.full_name || "No name",
      u.email || "No email",
      planConfig[u.selected_plan as keyof typeof planConfig]?.label || "None",
      u.is_admin ? "Yes" : "No",
      new Date(u.created_at).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jortrade-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Users exported");
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
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={users.length === 0}
              className="text-xs border-border/50 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
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
              {filteredUsers.map((u) => {
                const plan = u.selected_plan as keyof typeof planConfig;
                const config = planConfig[plan] || null;
                const PlanIcon = config?.icon || Star;
                const isSelf = u.id === user?.id;

                return (
                  <div key={u.id} className="glass-panel rounded-xl p-4 border-border/30 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground text-sm truncate">{u.full_name || "No name"}</p>
                        {config && (
                          <span className={`flex items-center gap-1 text-[10px] font-bold ${config.color}`}>
                            <PlanIcon className="h-3 w-3" />
                            {config.label}
                          </span>
                        )}
                        {u.is_admin && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <Shield className="h-3 w-3" />
                            Admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email || "No email"}</p>
                      <p className="text-[10px] text-muted-foreground/60">Joined {new Date(u.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {(["starter", "active", "pro"] as const).map((p) => {
                        const pc = planConfig[p];
                        const isActive = u.selected_plan === p;
                        return (
                          <Button
                            key={p}
                            size="sm"
                            variant={isActive ? "default" : "outline"}
                            disabled={isActive || updating === u.id}
                            onClick={() => updateUserPlan(u.id, p)}
                            className={`text-xs h-8 px-3 ${isActive ? "bg-primary" : "border-border/50"}`}
                          >
                            <pc.icon className="h-3 w-3 mr-1" />
                            {pc.label.split(" ")[0]}
                          </Button>
                        );
                      })}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updating === u.id || isSelf}
                        onClick={() => toggleAdmin(u.id, !!u.is_admin)}
                        className={`text-xs h-8 px-3 border-border/50 ${u.is_admin ? "text-emerald-400 hover:text-red-400" : "text-muted-foreground hover:text-emerald-400"}`}
                        title={isSelf ? "Cannot change own admin status" : u.is_admin ? "Remove admin" : "Make admin"}
                      >
                        {u.is_admin ? <ShieldOff className="h-3 w-3 mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                        {u.is_admin ? "Revoke" : "Admin"}
                      </Button>

                      {confirmDelete === u.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={updating === u.id}
                            onClick={() => deleteUser(u.id)}
                            className="text-xs h-8 px-3"
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs h-8 px-3 border-border/50"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updating === u.id || isSelf}
                          onClick={() => setConfirmDelete(u.id)}
                          className="text-xs h-8 px-3 border-border/50 text-muted-foreground hover:text-destructive"
                          title={isSelf ? "Cannot delete yourself" : "Delete user"}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
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
