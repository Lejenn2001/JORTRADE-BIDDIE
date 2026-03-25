import { useState, useEffect } from "react";
import { Users, UserPlus, MessageSquare, TrendingUp, ShieldAlert, Shield, ShieldCheck, ShieldX, Anchor, Gauge, Download, Globe, Trash2, Circle } from "lucide-react";
import { usePresenceTracker } from "@/hooks/usePresence";
import { Link } from "react-router-dom";
import SignalAccuracyPanel from "@/components/dashboard/SignalAccuracyPanel";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import { useMarketData } from "@/hooks/useMarketData";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

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

interface MemberWithRoles {
  id: string;
  full_name: string;
  email: string;
  selected_plan: string | null;
  created_at: string;
  roles: string[];
}

const planLabel = (plan: string | null) => {
  if (!plan) return "—";
  if (plan === "founding") return "Founding 50";
  if (plan === "lifetime") return "Lifetime";
  if (plan === "monthly") return "Monthly";
  return plan;
};

const exportToCSV = (members: MemberWithRoles[]) => {
  const headers = ["Name", "Email", "Plan", "Role", "Joined"];
  const rows = members.map((m) => [
    m.full_name || "Unknown",
    m.email || "",
    planLabel(m.selected_plan),
    m.roles.includes("admin") ? "Admin" : "Member",
    new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jortrade-members-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const DashboardAnalytics = () => {
  const { session } = useAuth();
  const { signals, loading: signalsLoading } = useMarketData();
  const onlineUsers = usePresenceTracker();
  const [members, setMembers] = useState<MemberWithRoles[]>([]);
  const [chatCount, setChatCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [apiUsageToday, setApiUsageToday] = useState(0);
  const [apiUsageMinute, setApiUsageMinute] = useState(0);

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

  const loadMembers = async () => {
    const { data, error } = await supabase.functions.invoke("manage-roles", {
      body: { action: "list" },
    });
    if (error) {
      console.error("Failed to load members:", error);
      return;
    }
    if (data?.members) setMembers(data.members);

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

  useEffect(() => {
    if (isAdmin !== true) return;
    loadMembers();
  }, [isAdmin]);

  const toggleAdmin = async (userId: string, currentlyAdmin: boolean) => {
    setTogglingId(userId);
    const { data, error } = await supabase.functions.invoke("manage-roles", {
      body: {
        action: currentlyAdmin ? "revoke" : "grant",
        user_id: userId,
        role: "admin",
      },
    });
    if (error || data?.error) {
      toast({
        title: "Error",
        description: data?.error || error?.message || "Failed to update role",
        variant: "destructive",
      });
    } else {
      toast({
        title: currentlyAdmin ? "Admin removed" : "Admin granted",
        description: currentlyAdmin ? "User is no longer an admin." : "User is now an admin.",
      });
      await loadMembers();
    }
    setTogglingId(null);
  };

  const deleteMember = async (userId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name || "this member"}? This cannot be undone.`)) return;
    setDeletingId(userId);
    const { data, error } = await supabase.functions.invoke("manage-roles", {
      body: { action: "delete", user_id: userId },
    });
    if (error || data?.error) {
      toast({
        title: "Error",
        description: data?.error || error?.message || "Failed to delete member",
        variant: "destructive",
      });
    } else {
      toast({ title: "Member deleted", description: `${name || "User"} has been removed.` });
      await loadMembers();
    }
    setDeletingId(null);
  };

  const today = new Date().toISOString().split("T")[0];
  const newToday = members.filter((m) => m.created_at.startsWith(today)).length;
  const onlineCount = members.filter((m) => onlineUsers.has(m.id)).length;

  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);
  const newThisWeek = members.filter((m) => new Date(m.created_at) >= thisWeekStart).length;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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
                <p className="text-sm text-muted-foreground">Member activity and platform overview</p>
              </div>
              <Link to="/ecosystem">
                <Button size="sm" variant="outline" className="text-xs gap-2">
                  <Globe className="h-3.5 w-3.5" /> Preview Ecosystem Page
                </Button>
              </Link>
            </div>

          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
               <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                <StatCard icon={Users} label="Total Members" value={members.length} color="bg-primary" />
                <StatCard icon={Circle} label="Online Now" value={onlineCount} color="bg-emerald-500" />
                <StatCard icon={UserPlus} label="New Today" value={newToday} color="bg-primary" />
                <StatCard icon={TrendingUp} label="This Week" value={newThisWeek} subtitle="New signups" color="bg-purple-500" />
                <StatCard icon={MessageSquare} label="Chat Messages" value={chatCount} color="bg-amber-500" />
              </div>

              {/* Whale API Usage */}
              <div className="glass-panel rounded-xl p-5 border-border/40 mb-6">
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

              {/* Signal Accuracy Tracker */}
              <SignalAccuracyPanel isAdmin={!!isAdmin} liveSignals={signals} />


              <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
                <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Members & Roles</h2>
                  <span className="text-xs text-muted-foreground ml-auto mr-3">{members.length} total</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-3"
                    onClick={() => exportToCSV(members)}
                  >
                    <Download className="h-3 w-3 mr-1" /> Export CSV
                  </Button>
                </div>
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
                      {members.map((m) => {
                        const memberIsAdmin = m.roles.includes("admin");
                        const isSelf = m.id === session?.user?.id;
                        const isOnline = onlineUsers.has(m.id);
                        return (
                          <tr key={m.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                            <td className="px-5 py-3">
                              <span className={`w-2 h-2 rounded-full inline-block ${isOnline ? "bg-emerald-400" : "bg-muted-foreground/30"}`} title={isOnline ? "Online" : "Offline"} />
                            </td>
                            <td className="px-5 py-3 text-foreground">
                              {m.full_name || "Unknown"}
                              {isSelf && <span className="text-xs text-muted-foreground ml-2">(you)</span>}
                            </td>
                            <td className="px-5 py-3 text-muted-foreground text-xs">{m.email || "—"}</td>
                            <td className="px-5 py-3">
                              {m.selected_plan ? (
                                <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full ${
                                  m.selected_plan === "founding"
                                    ? "text-amber-400 bg-amber-400/10"
                                    : m.selected_plan === "lifetime"
                                    ? "text-purple-400 bg-purple-400/10"
                                    : "text-primary bg-primary/10"
                                }`}>
                                  {planLabel(m.selected_plan)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-muted-foreground">{formatDate(m.created_at)}</td>
                            <td className="px-5 py-3">
                              {memberIsAdmin ? (
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
                                    variant={memberIsAdmin ? "destructive" : "outline"}
                                    className="text-xs h-7 px-3"
                                    disabled={togglingId === m.id}
                                    onClick={() => toggleAdmin(m.id, memberIsAdmin)}
                                  >
                                    {togglingId === m.id ? (
                                      <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                    ) : memberIsAdmin ? (
                                      <><ShieldX className="h-3 w-3 mr-1" /> Remove Admin</>
                                    ) : (
                                      <><ShieldCheck className="h-3 w-3 mr-1" /> Make Admin</>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    disabled={deletingId === m.id}
                                    onClick={() => deleteMember(m.id, m.full_name)}
                                  >
                                    {deletingId === m.id ? (
                                      <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">No members yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default DashboardAnalytics;
