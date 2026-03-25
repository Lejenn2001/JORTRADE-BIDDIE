import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, AlertTriangle, Target, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

const SignalAlerts = () => {
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const { toast } = useToast();

  // Fetch recent unread alerts
  const fetchAlerts = async () => {
    const { data } = await supabase
      .from("signal_alerts" as any)
      .select("*")
      .eq("read", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) setAlerts(data as any as SignalAlert[]);
  };

  // Subscribe to realtime inserts for instant notifications
  useEffect(() => {
    fetchAlerts();

    const channel = supabase
      .channel("signal-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signal_alerts" },
        (payload) => {
          const alert = payload.new as SignalAlert;
          setAlerts((prev) => [alert, ...prev]);

          // Show toast notification
          const icon = alert.alert_type === "invalidated" ? "🚨"
            : alert.alert_type === "target_hit" ? "🎯" : "⏰";

          toast({
            title: `${icon} ${alert.ticker} — ${alert.alert_type === "invalidated" ? "Invalidated" : alert.alert_type === "target_hit" ? "Target Hit!" : "Expired"}`,
            description: alert.message,
            variant: alert.alert_type === "invalidated" ? "destructive" : "default",
            duration: 10000,
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

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

  const unreadCount = alerts.length;

  const alertIcon = (type: string) => {
    if (type === "invalidated") return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
    if (type === "target_hit") return <Target className="h-4 w-4 text-emerald-400 shrink-0" />;
    return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  };

  const alertBorder = (type: string) => {
    if (type === "invalidated") return "border-destructive/30 bg-destructive/5";
    if (type === "target_hit") return "border-emerald-500/30 bg-emerald-500/5";
    return "border-muted bg-muted/10";
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </motion.span>
        )}
      </button>

      {/* Alert panel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed right-4 top-14 w-[340px] max-h-[420px] overflow-y-auto glass-panel rounded-xl border border-border/50 shadow-xl z-[100]"
          >
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Signal Alerts</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                No new alerts
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SignalAlerts;
