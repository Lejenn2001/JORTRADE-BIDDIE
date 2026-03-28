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
import { Shield, Search, UserCog, Crown, Zap, Star, Trash2, ShieldCheck, ShieldOff, Download, Users, UserPlus, MessageSquare, TrendingUp, Anchor, Gauge, Circle, Globe, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import AdminSignalInsights from "@/components/dashboard/AdminSignalInsights";
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
  const [showReference, setShowReference] = useState(false);
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

    const adminChecks = await Promise.all(
      (profiles || []).map(async (p) => {
        try {
          const resp = await fetch(`/api/whale/admin/check?userId=${p.id}`);
          const data = await resp.json();
          return { id: p.id, isAdmin: !!data?.isAdmin };
        } catch {
          return { id: p.id, isAdmin: false };
        }
      })
    );
    const adminIds = new Set(adminChecks.filter(c => c.isAdmin).map(c => c.id));

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
    try {
      const resp = await fetch("/api/whale/admin/update-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": user?.id || "" },
        body: JSON.stringify({ userId, plan }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || "Failed to update user plan");
      } else {
        toast.success(`Plan updated to ${planConfig[plan as keyof typeof planConfig]?.label || plan}`);
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, selected_plan: plan } : u));
      }
    } catch {
      toast.error("Failed to update user plan");
    }
    setUpdating(null);
  };

  const toggleAdmin = async (userId: string, currentlyAdmin: boolean) => {
    setUpdating(userId);
    try {
      const resp = await fetch("/api/whale/admin/toggle-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": user?.id || "" },
        body: JSON.stringify({ userId, makeAdmin: !currentlyAdmin }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || "Failed to update admin role");
      } else {
        toast.success(currentlyAdmin ? "Admin role removed" : "Admin role granted");
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: !currentlyAdmin } : u));
      }
    } catch (e: any) {
      toast.error("Network error: " + (e?.message || "Failed to update admin role"));
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

          <AdminSignalInsights />

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

          {/* Signal System Reference */}
          <div className="mt-8">
            <button
              onClick={() => setShowReference(!showReference)}
              className="w-full flex items-center justify-between glass-panel rounded-xl p-5 border-border/40 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-indigo-400" />
                </div>
                <div className="text-left">
                  <p className="font-bold text-foreground">Signal System Reference</p>
                  <p className="text-xs text-muted-foreground">Criteria, tags, scoring, and how each feature works</p>
                </div>
              </div>
              {showReference ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </button>

            {showReference && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-4 space-y-6"
              >
                {/* Signal Sources */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Signal Sources Overview</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-emerald-400 mb-2">Community Chat (Auto-Posts)</h4>
                      <p className="text-xs text-muted-foreground mb-3">Biddie monitors the tape and only posts when something serious hits. 3-5 alerts max on a busy day.</p>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">&#9679;</span> Sweep orders only (urgency signal)</li>
                        <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">&#9679;</span> $250K+ total premium</li>
                        <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">&#9679;</span> 85%+ ask-side aggression</li>
                        <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">&#9679;</span> 5x+ volume/open interest ratio</li>
                        <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">&#9679;</span> Strike within 5% of current price (near ATM)</li>
                      </ul>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-blue-400 mb-2">Dashboard & Signals Tab</h4>
                      <p className="text-xs text-muted-foreground mb-3">Wider scan pulling 500+ flow alerts. AI scores and categorizes into Algorithm, Whale, and Spread plays.</p>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> $25K+ total premium</li>
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> 50%+ ask-side aggression</li>
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> Up to 40 candidates scored by AI</li>
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> Only confidence 7-10 make the cut</li>
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> Key levels (VWAP, pivots, PDH/PDL) used for entries</li>
                        <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">&#9679;</span> Signals tab retains 7 days of history</li>
                      </ul>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-purple-400 mb-2">Biddie AI Chat (On-Demand)</h4>
                      <p className="text-xs text-muted-foreground mb-3">Full access to live flow data. No pre-filtering — Biddie pulls everything and gives a specific, data-backed answer.</p>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">&#9679;</span> All flow data (no minimum thresholds)</li>
                        <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">&#9679;</span> Real-time key levels per ticker</li>
                        <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">&#9679;</span> Dark pool data when requested</li>
                        <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">&#9679;</span> Sector ETF analysis</li>
                        <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">&#9679;</span> Position reviews with gamma/theta analysis</li>
                      </ul>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-amber-400 mb-2">Morning Outlook (Auto, ~8:15 AM ET)</h4>
                      <p className="text-xs text-muted-foreground mb-3">Automated pre-market analysis posted to community chat before the open.</p>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#9679;</span> Posts once daily, 8:15-8:30 AM ET</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#9679;</span> Key levels for SPY, QQQ, NVDA, AAPL, TSLA</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#9679;</span> Top 50 flow alerts analyzed</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#9679;</span> Sector ETF data + economic calendar</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#9679;</span> Weekdays only, skips weekends</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Signal Categories */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Signal Categories</h3>
                  <div className="space-y-4">
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-emerald-400 mb-1">Algorithm Plays</h4>
                      <p className="text-xs text-muted-foreground mb-2">Single-leg directional plays confirmed by price action + gamma analysis. Intraday entries.</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><span className="text-foreground font-medium">How detected:</span> Price action at key support/resistance levels + confirming options flow + gamma zone alignment</p>
                        <p><span className="text-foreground font-medium">Typical setup:</span> Stock bounces off VWAP or prior day level while sweep orders stack in that direction</p>
                      </div>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-blue-400 mb-1">Whale Plays</h4>
                      <p className="text-xs text-muted-foreground mb-2">Large institutional single-leg flow. Sweeps, blocks, floor trades. Swing positioning.</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><span className="text-foreground font-medium">Threshold:</span> $100K+ premium for large-caps, $50K+ for mid/small-caps</p>
                        <p><span className="text-foreground font-medium">Key indicators:</span> Sweep orders, block trades, floor trades with high ask-side aggression</p>
                      </div>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-border/30">
                      <h4 className="font-semibold text-purple-400 mb-1">Spreads & Butterflies</h4>
                      <p className="text-xs text-muted-foreground mb-2">Multi-leg strategies — debit spreads and butterflies only. Defined risk.</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><span className="text-foreground font-medium">How detected:</span> Multiple flow alerts on same ticker + same expiry at different strikes</p>
                        <p><span className="text-foreground font-medium">Butterfly:</span> 3 strikes with middle having 2x volume = likely butterfly</p>
                        <p><span className="text-foreground font-medium">Debit spread:</span> Sweeps at adjacent strikes on same ticker</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tag Legend */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Tag Legend</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">🔥 ACT NOW</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Price confirmed at a key level AND in a favorable gamma zone. Highest conviction — both flow and price action agree. Confidence 9-10.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">⚡ HIGH CONVICTION</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Conviction score 70+. Strong flow with good premium, aggression, and volume. May not have full price confirmation yet.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">✅ PRICE CONFIRMED</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Price action has confirmed the signal — stock is bouncing off support (for calls) or rejecting resistance (for puts) at a key level. +10 conviction score boost.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-violet-500/20 text-violet-400 text-[10px] font-bold px-2 py-0.5 rounded-full">⚡ NEG GAMMA</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Negative gamma zone — moves are amplified. Market makers are short gamma, so price moves accelerate through this level. Breakouts and breakdowns are more explosive.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-bold px-2 py-0.5 rounded-full">🧲 POS GAMMA</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Positive gamma zone — expect mean-reversion and pinning. Market makers are long gamma and will hedge against the move, keeping price contained near this level. Butterflies benefit here.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full">Sweep</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Large aggressive order routed across multiple exchanges simultaneously to get filled fast. Indicates urgency — the trader wants in NOW and doesn't care about paying up.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">Call Flow</span>
                        <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">Put Flow</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Direction of the options flow. Call flow = bullish positioning. Put flow = bearish positioning. Check ask aggression % to confirm it's opening (buying) not closing.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-orange-500/20 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded-full">High Volume</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Volume/open interest ratio significantly above normal. High ratios (5x+) indicate new positions being opened, not just closing or rolling existing ones.</p>
                    </div>
                  </div>
                </div>

                {/* Conviction Scoring */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Conviction Scoring (0-100)</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 font-bold text-sm shrink-0">90+</div>
                      <div>
                        <p className="text-sm font-semibold text-red-400">Extreme Conviction</p>
                        <p className="text-xs text-muted-foreground">Multiple sweeps, 80%+ ask aggression, 10x+ vol/OI, large premium, near ATM. Often price confirmed.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm shrink-0">75-89</div>
                      <div>
                        <p className="text-sm font-semibold text-amber-400">Very High Conviction</p>
                        <p className="text-xs text-muted-foreground">Strong sweep or 80%+ aggression with large premium and clear direction. One or two conditions may be slightly weaker.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm shrink-0">60-74</div>
                      <div>
                        <p className="text-sm font-semibold text-emerald-400">High Conviction</p>
                        <p className="text-xs text-muted-foreground">Good flow with decent premium and aggression but may be slightly OTM or moderate volume. Still worth watching.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm shrink-0">40-59</div>
                      <div>
                        <p className="text-sm font-semibold text-blue-400">Moderate Conviction</p>
                        <p className="text-xs text-muted-foreground">Mixed signals — some positive indicators but missing key confirmations. Generally filtered out from dashboard signals.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <div className="w-12 h-12 rounded-full bg-zinc-500/20 flex items-center justify-center text-zinc-400 font-bold text-sm shrink-0">&lt;40</div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-400">Low Conviction</p>
                        <p className="text-xs text-muted-foreground">Not enough confirmation. Filtered out — you will never see these on the dashboard.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Key Levels Reference */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Key Levels Used in Analysis</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <p className="text-sm font-semibold text-foreground mb-1">VWAP</p>
                      <p className="text-xs text-muted-foreground">Volume Weighted Average Price — calculated from intraday 5-min bars. Primary trigger for entries. Above VWAP = bullish, below = bearish. Reclaim or rejection at VWAP is a key signal.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <p className="text-sm font-semibold text-foreground mb-1">Prior Day High / Low (PDH/PDL)</p>
                      <p className="text-xs text-muted-foreground">Yesterday's high and low. Major support/resistance levels. A break above PDH or below PDL with volume is a strong continuation signal.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <p className="text-sm font-semibold text-foreground mb-1">Pivot Points (P, R1, R2, S1, S2)</p>
                      <p className="text-xs text-muted-foreground">Calculated from prior day OHLC. Pivot = neutral level. R1/R2 = resistance targets for calls. S1/S2 = support targets for puts. Used for target zones and invalidation.</p>
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                      <p className="text-sm font-semibold text-foreground mb-1">Gamma Zones</p>
                      <p className="text-xs text-muted-foreground">Negative gamma = moves amplify (good for directional plays). Positive gamma = moves dampen (good for butterflies/pinning). Determines which strategy type benefits most.</p>
                    </div>
                  </div>
                </div>

                {/* Flow Data Metrics */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Flow Data Metrics Explained</h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Total Premium</span>
                      <span className="text-muted-foreground">Total dollar amount spent on the options contracts. Higher = more money behind the bet. $250K+ is institutional-level.</span>
                    </div>
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Ask Aggression %</span>
                      <span className="text-muted-foreground">Percentage of premium paid at the ask price. 85%+ means they're buying aggressively (opening positions). Below 50% = likely closing or hedging.</span>
                    </div>
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Vol/OI Ratio</span>
                      <span className="text-muted-foreground">Today's volume vs open interest. 1x = normal. 5x+ = significant new positioning. 10x+ = extremely unusual activity.</span>
                    </div>
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Sweep</span>
                      <span className="text-muted-foreground">Order split across multiple exchanges to fill quickly. Indicates urgency. Non-sweep (regular flow) is less indicative of informed trading.</span>
                    </div>
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Trade Count</span>
                      <span className="text-muted-foreground">Number of individual trades that make up the alert. Higher count = sustained interest over time, not just a single one-off order.</span>
                    </div>
                    <div className="flex items-start gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                      <span className="font-semibold text-foreground whitespace-nowrap min-w-[140px]">Moneyness</span>
                      <span className="text-muted-foreground">How close the strike is to current price. ATM = at the money (highest delta, most responsive). Deep OTM = lottery ticket. Signals within 5% of price are most actionable.</span>
                    </div>
                  </div>
                </div>

                {/* Tier Features */}
                <div className="glass-panel rounded-xl p-6 border-border/40">
                  <h3 className="text-lg font-bold text-foreground mb-4">Subscription Tiers</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-card/50 rounded-lg p-4 border border-blue-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <Star className="h-4 w-4 text-blue-400" />
                        <h4 className="font-semibold text-blue-400">Signal Scout (Starter)</h4>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li>Dashboard access</li>
                        <li>Biddie AI: Locked (0/day)</li>
                        <li>Can purchase credit packs</li>
                      </ul>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-amber-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="h-4 w-4 text-amber-400" />
                        <h4 className="font-semibold text-amber-400">Active Trader</h4>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li>Full dashboard access</li>
                        <li>Biddie AI: 25 questions/day</li>
                        <li>Can purchase credit packs</li>
                      </ul>
                    </div>
                    <div className="bg-card/50 rounded-lg p-4 border border-purple-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <Crown className="h-4 w-4 text-purple-400" />
                        <h4 className="font-semibold text-purple-400">Pro Trader</h4>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1.5">
                        <li>Full dashboard access</li>
                        <li>Biddie AI: 50 questions/day</li>
                        <li>Can purchase credit packs</li>
                      </ul>
                    </div>
                  </div>
                  <div className="mt-4 bg-card/50 rounded-lg p-4 border border-border/30">
                    <h4 className="font-semibold text-foreground mb-2">Credit Packs (All Tiers)</h4>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>10 credits — $4.99</span>
                      <span>25 credits — $9.99</span>
                      <span>50 credits — $17.99</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardAdmin;
