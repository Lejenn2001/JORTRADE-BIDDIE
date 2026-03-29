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
import { Shield, Search, UserCog, Crown, Zap, Star, Trash2, ShieldCheck, ShieldOff, Download, Users, UserPlus, MessageSquare, TrendingUp, Anchor, Gauge, Circle, Globe, BookOpen, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle, RefreshCw, ExternalLink, Server, Activity } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<'overview' | 'health' | 'signals' | 'users'>('overview');
  const [apiCounts, setApiCounts] = useState<Record<string, { today: number; minute: number }>>({});
  const [systemHealth, setSystemHealth] = useState<{ name: string; description: string; status: string; details: string; url: string; usage?: string }[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);

  const fetchSystemHealth = async () => {
    setHealthLoading(true);
    try {
      const resp = await fetch("/api/whale/admin/system-health", {
        headers: { "x-user-id": user?.id || "" },
      });
      const data = await resp.json();
      setSystemHealth(data.services || []);
      setHealthChecked(true);
    } catch {
      toast.error("Failed to check system health");
    }
    setHealthLoading(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers();
    fetchSystemHealth();
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

    try {
      const usageResp = await fetch("/api/whale/admin/api-usage", {
        headers: { "x-user-id": user?.id || "" },
      });
      if (usageResp.ok) {
        const usageData = await usageResp.json();
        setApiCounts(usageData.counts || {});
      }
    } catch {}


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

  const [exportingSignals, setExportingSignals] = useState(false);

  const exportSignalsCSV = async () => {
    setExportingSignals(true);
    try {
      const resp = await fetch("/api/whale/signals/export");
      const data = await resp.json();
      if (!data.signals || data.signals.length === 0) {
        toast.error("No signals found to export");
        setExportingSignals(false);
        return;
      }
      const fmtDate = (d: string | null) => {
        if (!d) return "";
        try {
          return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
        } catch { return d; }
      };

      const headers = [
        "Date (ET)", "Ticker", "Direction", "Option Type", "Category",
        "Strike", "Expiry", "Premium", "Alert Price", "Target", "Target Price",
        "Invalidation", "Invalidation Price", "% to Target", "Conviction Score",
        "Confidence", "Entry Trigger", "Reason", "Outcome", "Tags"
      ];
      const rows = data.signals.map((s: any) => [
        fmtDate(s.detected_at || s.created_at),
        s.ticker || "",
        s.direction || "",
        (s.option_type || "").toUpperCase(),
        s.category || "",
        s.strike ? `$${s.strike}` : "",
        s.expiry || "",
        s.premium || "",
        s.price_at_signal ? `$${parseFloat(s.price_at_signal).toFixed(2)}` : "",
        s.target || "",
        s.target_price_numeric ? `$${parseFloat(s.target_price_numeric).toFixed(2)}` : "",
        s.invalidation || "",
        s.invalidation_price_numeric ? `$${parseFloat(s.invalidation_price_numeric).toFixed(2)}` : "",
        s.pct_to_target ? `${s.pct_to_target}%` : "",
        s.conviction_score ?? "",
        s.confidence ? `${Math.round(s.confidence * 100)}%` : "",
        s.entry_trigger || "",
        (s.reason || "").replace(/"/g, "'"),
        s.outcome || "pending",
        Array.isArray(s.tags) ? s.tags.join(", ") : "",
      ]);
      const csv = [headers, ...rows].map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jortrade-signals-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.signals.length} signals`);
    } catch (err) {
      toast.error("Failed to export signals");
    }
    setExportingSignals(false);
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
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
            <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
              {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
                const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
                const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
                const green = i % 3 !== 0;
                return (
                  <g key={i}>
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#dc2626" : "#991b1b"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#dc2626" : "#991b1b"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-red-900/15 via-transparent to-red-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

            <div className="relative px-6 py-7 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-red-400 to-red-700" />
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                    ADMIN PANEL
                  </h1>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/80 font-semibold mt-0.5">
                    Platform Control
                  </p>
                </div>
              </div>
              <Link to="/ecosystem">
                <Button size="sm" variant="outline" className="text-xs gap-2 border-border/50">
                  <Globe className="h-3.5 w-3.5" /> Ecosystem
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex gap-1 bg-muted/20 rounded-xl p-1 border border-border/30">
            {([
              { id: 'overview' as const, label: 'Overview', icon: Activity },
              { id: 'health' as const, label: 'System Health', icon: Server },
              { id: 'signals' as const, label: 'Signal Insights', icon: Zap },
              { id: 'users' as const, label: 'Users', icon: Users },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {(() => {
                const today = new Date().toISOString().split("T")[0];
                const newToday = users.filter((m) => m.created_at.startsWith(today)).length;
                const onlineCount = users.filter((m) => onlineUsers.has(m.id)).length;
                const thisWeekStart = new Date();
                thisWeekStart.setDate(thisWeekStart.getDate() - 7);
                const newThisWeek = users.filter((m) => new Date(m.created_at) >= thisWeekStart).length;
                const errorCount = systemHealth.filter(s => s.status === 'error').length;
                const warningCount = systemHealth.filter(s => s.status === 'warning').length;

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
                        <Gauge className="h-5 w-5 text-primary" />
                        <h3 className="text-sm font-bold text-foreground">API Usage (Today)</h3>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {(() => {
                          const uw = apiCounts["unusual_whales"] || { today: 0, minute: 0 };
                          const uwDayPct = Math.min((uw.today / 15000) * 100, 100);
                          const uwMinPct = Math.min((uw.minute / 120) * 100, 100);
                          return (
                            <div className="rounded-lg p-3 bg-emerald-500/10 border border-border/20 col-span-2">
                              <p className="text-[11px] font-medium text-emerald-400 mb-2">Unusual Whales</p>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="flex items-baseline gap-1">
                                    <p className="text-lg font-bold text-foreground">~{uw.minute}</p>
                                    <p className="text-[10px] text-muted-foreground">/ 120 per min</p>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-border/30 mt-1 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${uwMinPct > 80 ? 'bg-red-400' : uwMinPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                      style={{ width: `${Math.max(uwMinPct, 3)}%` }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-baseline gap-1">
                                    <p className="text-lg font-bold text-foreground">{uw.today.toLocaleString()}</p>
                                    <p className="text-[10px] text-muted-foreground">/ 15,000 per day</p>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-border/30 mt-1 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${uwDayPct > 80 ? 'bg-red-400' : uwDayPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                      style={{ width: `${Math.max(uwDayPct, 3)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        {([
                          { key: "polygon", label: "Polygon.io", color: "text-blue-400", bg: "bg-blue-500/10", sub: "unlimited" },
                          { key: "anthropic", label: "Anthropic (Claude)", color: "text-purple-400", bg: "bg-purple-500/10", sub: "pay-per-use" },
                          { key: "discord", label: "Discord", color: "text-amber-400", bg: "bg-amber-500/10" },
                          { key: "replit", label: "Replit", color: "text-orange-400", bg: "bg-orange-500/10", sub: "credits" },
                        ]).map((svc) => {
                          const c = apiCounts[svc.key] || { today: 0, minute: 0 };
                          return (
                            <div key={svc.key} className={`rounded-lg p-3 ${svc.bg} border border-border/20`}>
                              <p className={`text-[11px] font-medium ${svc.color} mb-1`}>{svc.label}</p>
                              <div className="flex items-baseline gap-1">
                                <p className="text-xl font-bold text-foreground">{c.today.toLocaleString()}</p>
                                <p className="text-[10px] text-muted-foreground">{(svc as any).sub || (svc.key === 'discord' ? `/ 30 per 60 sec` : `${c.minute}/min`)}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div
                        className="glass-panel rounded-xl p-5 border-border/40 cursor-pointer hover:border-primary/30 transition-colors"
                        onClick={() => setActiveTab('health')}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                            <Server className="h-5 w-5 text-emerald-400" />
                          </div>
                          <div>
                            <p className="font-bold text-foreground">System Health</p>
                            <p className="text-xs text-muted-foreground">{systemHealth.length} services monitored</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {errorCount > 0 && (
                            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-full">
                              <XCircle className="h-3 w-3" /> {errorCount} error{errorCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {warningCount > 0 && (
                            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">
                              <AlertTriangle className="h-3 w-3" /> {warningCount} warning{warningCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {errorCount === 0 && warningCount === 0 && systemHealth.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
                              <CheckCircle2 className="h-3 w-3" /> All systems operational
                            </span>
                          )}
                        </div>
                      </div>

                    </div>

                  </>
                );
              })()}
            </motion.div>
          )}

          {activeTab === 'health' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">System Health & Services</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchSystemHealth}
                  disabled={healthLoading}
                  className="gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
                  {healthLoading ? 'Checking...' : 'Refresh'}
                </Button>
              </div>
              {!healthChecked && !healthLoading ? (
                <p className="text-sm text-muted-foreground">Checking all services...</p>
              ) : (
                <div className="space-y-3">
                  {systemHealth.map((svc) => (
                    <div
                      key={svc.name}
                      className={`rounded-xl overflow-hidden border ${
                        svc.status === 'ok' ? 'border-emerald-500/20' :
                        svc.status === 'warning' ? 'border-amber-500/20' :
                        'border-red-500/20'
                      }`}
                    >
                      <div className={`flex items-center justify-between px-4 py-3 ${
                        svc.status === 'ok' ? 'bg-emerald-500/10' :
                        svc.status === 'warning' ? 'bg-amber-500/10' :
                        'bg-red-500/10'
                      }`}>
                        <div className="flex items-center gap-3">
                          {svc.status === 'ok' ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                          ) : svc.status === 'warning' ? (
                            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                          )}
                          <div>
                            <p className="text-sm font-bold text-foreground">{svc.name}</p>
                            <p className={`text-xs ${
                              svc.status === 'ok' ? 'text-emerald-400' :
                              svc.status === 'warning' ? 'text-amber-400' :
                              'text-red-400'
                            }`}>{svc.details}</p>
                          </div>
                        </div>
                        {svc.url && (
                          <a
                            href={svc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                          >
                            Manage <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="px-4 py-2.5 bg-muted/10 flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground">{svc.description}</p>
                        {svc.usage && (
                          <p className="text-[11px] text-foreground/60 font-medium shrink-0 ml-4">{svc.usage}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'signals' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportSignalsCSV}
                  disabled={exportingSignals}
                  className="text-xs border-border/50 gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exportingSignals ? "Exporting..." : "Export Signal Log"}
                </Button>
              </div>
              <AdminSignalInsights />

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
                  className="space-y-6"
                >
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

                  <div className="glass-panel rounded-xl p-6 border-border/40">
                    <h3 className="text-lg font-bold text-foreground mb-4">Tag Legend</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">ACT NOW</span>
                        <p className="text-xs text-muted-foreground mt-1">Price confirmed at a key level AND in a favorable gamma zone. Highest conviction.</p>
                      </div>
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">HIGH CONVICTION</span>
                        <p className="text-xs text-muted-foreground mt-1">Conviction score 70+. Strong flow with good premium, aggression, and volume.</p>
                      </div>
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">PRICE CONFIRMED</span>
                        <p className="text-xs text-muted-foreground mt-1">Price action confirmed the signal at a key level. +10 conviction boost.</p>
                      </div>
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-violet-500/20 text-violet-400 text-[10px] font-bold px-2 py-0.5 rounded-full">NEG GAMMA</span>
                        <p className="text-xs text-muted-foreground mt-1">Negative gamma zone — moves amplified. Breakouts/breakdowns more explosive.</p>
                      </div>
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-bold px-2 py-0.5 rounded-full">POS GAMMA</span>
                        <p className="text-xs text-muted-foreground mt-1">Positive gamma zone — mean-reversion and pinning. Butterflies benefit here.</p>
                      </div>
                      <div className="bg-card/50 rounded-lg p-3 border border-border/30">
                        <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full">Sweep</span>
                        <p className="text-xs text-muted-foreground mt-1">Large aggressive order across multiple exchanges. Indicates urgency.</p>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel rounded-xl p-6 border-border/40">
                    <h3 className="text-lg font-bold text-foreground mb-4">Conviction Scoring (0-100)</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 font-bold text-sm shrink-0">90+</div>
                        <div>
                          <p className="text-sm font-semibold text-red-400">Extreme Conviction</p>
                          <p className="text-xs text-muted-foreground">Multiple sweeps, 80%+ aggression, 10x+ vol/OI, large premium.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm shrink-0">75-89</div>
                        <div>
                          <p className="text-sm font-semibold text-amber-400">Very High Conviction</p>
                          <p className="text-xs text-muted-foreground">Strong sweep or 80%+ aggression with large premium and clear direction.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm shrink-0">60-74</div>
                        <div>
                          <p className="text-sm font-semibold text-emerald-400">High Conviction</p>
                          <p className="text-xs text-muted-foreground">Good flow with decent premium. May be slightly OTM or moderate volume.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border/30">
                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm shrink-0">40-59</div>
                        <div>
                          <p className="text-sm font-semibold text-blue-400">Moderate Conviction</p>
                          <p className="text-xs text-muted-foreground">Watchlist candidate. Has some conviction but missing key confirmation.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel rounded-xl p-6 border-border/40">
                    <h3 className="text-lg font-bold text-foreground mb-4">Subscription Tiers</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-card/50 rounded-lg p-4 border border-blue-500/20">
                        <div className="flex items-center gap-2 mb-3">
                          <Star className="h-4 w-4 text-blue-400" />
                          <h4 className="font-semibold text-blue-400">Signal Scout</h4>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-1.5">
                          <li>Community chat access</li>
                          <li>Biddie AI: 10 questions/day</li>
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
            </motion.div>
          )}

          {activeTab === 'users' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-muted/30 border-border/50 rounded-lg"
            />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={users.length === 0}
              className="text-xs border-border/50 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Export Users
            </Button>
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
            </motion.div>
          )}

        </main>
      </div>
    </div>
  );
};

export default DashboardAdmin;
