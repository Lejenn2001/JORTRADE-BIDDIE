import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, AlertTriangle, Target, Clock, X, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface SignalAlert {
  id: string;
  signal_id: string;
  ticker: string;
  alert_type: string;
  message: string;
  current_price: number | null;
  trigger_price: number | null;
  read: boolean;
  created_at: string;
}

interface UserAlert {
  id: string;
  user_id: string;
  ticker: string;
  target_price: string;
  condition: string;
  signal_id: string | null;
  label: string | null;
  active: boolean;
  triggered: boolean;
  triggered_at: string | null;
  triggered_price: string | null;
  created_at: string;
}

const SignalAlerts = () => {
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [userAlerts, setUserAlerts] = useState<UserAlert[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [tab, setTab] = useState<"notifications" | "active">("active");
  const { toast } = useToast();
  const { user } = useAuth();

  const fetchAlerts = async () => {
    const { data } = await supabase
      .from("signal_alerts" as any)
      .select("*")
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) setAlerts(data as any as SignalAlert[]);
  };

  const fetchUserAlerts = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/alerts?userId=${user.id}`);
      const data = await res.json();
      if (data.alerts) setUserAlerts(data.alerts);
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    fetchAlerts();
    fetchUserAlerts();

    const channel = supabase
      .channel("signal-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signal_alerts" },
        (payload) => {
          const alert = payload.new as SignalAlert;
          setAlerts((prev) => [alert, ...prev]);

          const icon = alert.alert_type === "invalidated" ? "🚨"
            : alert.alert_type === "target_hit" ? "🎯"
            : alert.alert_type === "price_alert" ? "🔔"
            : "⏰";

          toast({
            title: `${icon} ${alert.ticker} — ${
              alert.alert_type === "invalidated" ? "Invalidated"
              : alert.alert_type === "target_hit" ? "Target Hit!"
              : alert.alert_type === "price_alert" ? "Price Alert!"
              : "Expired"
            }`,
            description: alert.message,
            variant: alert.alert_type === "invalidated" ? "destructive" : "default",
            duration: 10000,
          });

          fetchUserAlerts();
        }
      )
      .subscribe();

    const handleOpenPanel = () => {
      fetchUserAlerts();
      setShowPanel(true);
      setTab("active");
    };
    window.addEventListener("open-alerts-panel", handleOpenPanel);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("open-alerts-panel", handleOpenPanel);
    };
  }, [user?.id]);

  const markRead = async (id: string) => {
    await supabase.from("signal_alerts" as any).update({ read: true }).eq("id", id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const markAllRead = async () => {
    const ids = alerts.map((a) => a.id);
    if (ids.length === 0) return;
    await supabase.from("signal_alerts" as any).update({ read: true }).in("id", ids);
    setAlerts([]);
  };

  const deleteUserAlert = async (id: string) => {
    if (!user?.id) return;
    try {
      await fetch(`/api/alerts/${id}?userId=${user.id}`, { method: "DELETE" });
      setUserAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {}
  };

  const unreadCount = alerts.length;
  const activeCount = userAlerts.filter(a => a.active && !a.triggered).length;
  const totalBadge = unreadCount + activeCount;

  const alertIcon = (type: string) => {
    if (type === "invalidated") return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
    if (type === "target_hit") return <Target className="h-4 w-4 text-emerald-400 shrink-0" />;
    if (type === "price_alert") return <Bell className="h-4 w-4 text-amber-400 shrink-0" />;
    return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  };

  const alertBorder = (type: string) => {
    if (type === "invalidated") return "border-destructive/30 bg-destructive/5";
    if (type === "target_hit") return "border-emerald-500/30 bg-emerald-500/5";
    if (type === "price_alert") return "border-amber-500/30 bg-amber-500/5";
    return "border-muted bg-muted/10";
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {totalBadge > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center"
          >
            {totalBadge > 9 ? "9+" : totalBadge}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed right-4 top-14 w-[360px] max-h-[480px] overflow-hidden glass-panel rounded-xl border border-border/50 shadow-xl z-[100] flex flex-col"
          >
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
              <div className="flex gap-1">
                <button
                  onClick={() => setTab("active")}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    tab === "active" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  My Alerts {activeCount > 0 && `(${activeCount})`}
                </button>
                <button
                  onClick={() => setTab("notifications")}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    tab === "notifications" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Notifications {unreadCount > 0 && `(${unreadCount})`}
                </button>
              </div>
              <button onClick={() => setShowPanel(false)} className="p-1 hover:bg-muted/50 rounded transition-colors">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {tab === "active" ? (
                userAlerts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                    <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No price alerts set</p>
                    <p className="text-[10px] mt-1">Tap the bell on any signal card to set one</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {userAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`px-4 py-3 flex gap-3 items-center ${
                          alert.triggered
                            ? "bg-amber-500/5 border-l-2 border-amber-500/30"
                            : "border-l-2 border-primary/20"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">{alert.ticker}</span>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              alert.triggered
                                ? "bg-amber-400/15 text-amber-400"
                                : "bg-primary/15 text-primary"
                            }`}>
                              {alert.triggered ? "TRIGGERED" : "ACTIVE"}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {alert.condition === "above" ? "↗" : "↘"} {alert.condition} ${parseFloat(alert.target_price).toFixed(2)}
                            {alert.label && ` — ${alert.label}`}
                          </p>
                          {alert.triggered && alert.triggered_price && (
                            <p className="text-[10px] text-amber-400 mt-0.5">
                              Hit at ${parseFloat(alert.triggered_price).toFixed(2)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteUserAlert(alert.id)}
                          className="p-1.5 hover:bg-destructive/10 rounded transition-colors shrink-0"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <>
                  {unreadCount > 0 && (
                    <div className="px-4 py-2 border-b border-border/20 flex justify-end">
                      <button
                        onClick={markAllRead}
                        className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors"
                      >
                        Mark all read
                      </button>
                    </div>
                  )}
                  {alerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No new notifications
                    </div>
                  ) : (
                    <div className="divide-y divide-border/20">
                      {alerts.map((alert) => (
                        <motion.div
                          key={alert.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`px-4 py-3 flex gap-3 items-start border-l-2 ${alertBorder(alert.alert_type)}`}
                        >
                          {alertIcon(alert.alert_type)}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-foreground leading-relaxed">{alert.message}</p>
                            <span className="text-[9px] text-muted-foreground mt-1 block">
                              {new Date(alert.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <button
                            onClick={() => markRead(alert.id)}
                            className="p-1 hover:bg-muted/50 rounded transition-colors shrink-0"
                          >
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SignalAlerts;
