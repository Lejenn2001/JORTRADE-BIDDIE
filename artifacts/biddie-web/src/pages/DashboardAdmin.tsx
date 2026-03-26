import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { usePresenceTracker } from "@/hooks/usePresence";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Shield, Search, UserCog, Crown, Zap, Star, Trash2, ShieldCheck, ShieldOff, Download, Users, UserPlus, MessageSquare, TrendingUp, Anchor, Gauge, Circle, Globe } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
}

const StatCard = ({ icon: Icon, label, value, subtitle, color }: StatCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass-panel rounded-xl p-5 border-border/40"
  >
    <div className="flex items-center gap-3 mb-3">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
  </motion.div>
);

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

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const DashboardAdmin = () => {
  const { isAdmin, user } = useAuth();
  const onlineUsers = usePresenceTracker();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [chatCount, setChatCount] = useState(0);
  const [apiUsageToday, setApiUsageToday] = useState(0);
  const [apiUsageMinute, setApiUsageMinute] = useState(0);

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

    const chatRes = await supabase.from("chat_messages").select("id", { count: "exact", head: true });
    if (chatRes.count !== null) setChatCount(chatRes.count);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const minuteAgo = new Date(Date.now() - 60 * 1000);

    const [dailyRes, minuteRes] = await Promise.all([
      supabase
        .from("api_usage_log" as any)
        .select("id", { count: "exact", head: true })
        .eq("api_name", "unusual_whales")
        .gte("created_at", todayStart.toISOString()),
      supabase
        .from("api_usage_log" as any)
        .select("id", { count: "exact", head: true })
        .eq("api_name", "unusual_whales")
        .gte("created_at", minuteAgo.toISOString()),
    ]);

    if (dailyRes.count !== null) setApiUsageToday(dailyRes.count);
    if (minuteRes.count !== null) setApiUsageMinute(minuteRes.count);

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
            <div className="flex items-center gap-2">
              <Link to="/ecosystem">
                <Button size="sm" variant="outline" className="text-xs gap-2 border-border/50">
                  <Globe className="h-3.5 w-3.5" /> Preview Ecosystem Page
                </Button>
              </Link>
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
          </div>

          {(() => {
            const today = new Date().toISOString().split("T")[0];
            const newToday = users.filter((m) => m.created_at.startsWith(today)).length;
            const onlineCount = users.filter((m) => onlineUsers.has(m.id)).length;
            const thisWeekStart = new Date();
            thisWeekStart.setDate(thisWeekStart.getDate() - 7);
            const newThisWeek = users.filter((m) => new Date(m.created_at) >= thisWeekStart).length;

            return (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <StatCard icon={Users} label="Total Members" value={users.length} color="bg-primary" />
                  <StatCard icon={Circle} label="Online Now" value={onlineCount} color="bg-emerald-500" />
                  <StatCard icon={UserPlus} label="New Today" value={newToday} color="bg-primary" />
                  <StatCard icon={TrendingUp} label="This Week" value={newThisWeek} subtitle="New signups" color="bg-purple-500" />
                  <StatCard icon={MessageSquare} label="Chat Messages" value={chatCount} color="bg-amber-500" />
                </div>

                <div className="glass-panel rounded-xl p-5 border-border/40">
                  <div className="flex items-center gap-2 mb-4">
                    <Anchor className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Unusual Whales API Usage</h2>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="bg-muted/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">Per Minute</p>
                      </div>
                      <p className="text-xl font-bold text-foreground">{apiUsageMinute} <span className="text-sm font-normal text-muted-foreground">/ 120</span></p>
                      <div className="mt-2 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${apiUsageMinute > 100 ? "bg-destructive" : apiUsageMinute > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min((apiUsageMinute / 120) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">Today</p>
                      </div>
                      <p className="text-xl font-bold text-foreground">{apiUsageToday.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ 15,000</span></p>
                      <div className="mt-2 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${apiUsageToday > 12000 ? "bg-destructive" : apiUsageToday > 7500 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min((apiUsageToday / 15000) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">Remaining Today</p>
                      </div>
                      <p className="text-xl font-bold text-foreground">{(15000 - apiUsageToday).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">requests left</p>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

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
            <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Plan</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Joined</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Role</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const plan = u.selected_plan as keyof typeof planConfig;
                      const config = planConfig[plan] || null;
                      const isSelf = u.id === user?.id;
                      const isOnline = onlineUsers.has(u.id);

                      return (
                        <tr key={u.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                          <td className="px-5 py-3">
                            <span className={`w-2 h-2 rounded-full inline-block ${isOnline ? "bg-emerald-400" : "bg-muted-foreground/30"}`} title={isOnline ? "Online" : "Offline"} />
                          </td>
                          <td className="px-5 py-3 text-foreground">
                            {u.full_name || "No name"}
                            {isSelf && <span className="text-xs text-muted-foreground ml-2">(you)</span>}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground text-xs">{u.email || "—"}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
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
                                    className={`text-[10px] h-6 px-2 ${isActive ? "bg-primary" : "border-border/50"}`}
                                  >
                                    <pc.icon className="h-3 w-3 mr-1" />
                                    {pc.label.split(" ")[0]}
                                  </Button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-muted-foreground text-xs">{formatDate(u.created_at)}</td>
                          <td className="px-5 py-3">
                            {u.is_admin ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
                                <ShieldCheck className="h-3 w-3" /> Admin
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Member</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {!isSelf && (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant={u.is_admin ? "destructive" : "outline"}
                                  className="text-xs h-7 px-3"
                                  disabled={updating === u.id}
                                  onClick={() => toggleAdmin(u.id, !!u.is_admin)}
                                >
                                  {updating === u.id ? (
                                    <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                  ) : u.is_admin ? (
                                    <><ShieldOff className="h-3 w-3 mr-1" /> Revoke</>
                                  ) : (
                                    <><ShieldCheck className="h-3 w-3 mr-1" /> Make Admin</>
                                  )}
                                </Button>
                                {confirmDelete === u.id ? (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={updating === u.id}
                                      onClick={() => deleteUser(u.id)}
                                      className="text-xs h-7 px-3"
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setConfirmDelete(null)}
                                      className="text-xs h-7 px-2 border-border/50"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    disabled={updating === u.id}
                                    onClick={() => setConfirmDelete(u.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground text-sm">No users found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DashboardAdmin;
