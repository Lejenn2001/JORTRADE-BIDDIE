import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bell, MessageSquare, Smartphone, Send, HelpCircle, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NotificationSettings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSend, setTestingSend] = useState(false);

  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [alertSignals, setAlertSignals] = useState(true);
  const [alertWhales, setAlertWhales] = useState(true);
  const [alertBiddiePicks, setAlertBiddiePicks] = useState(true);
  const [alertBreakouts, setAlertBreakouts] = useState(true);
  const [alertZeroDTE, setAlertZeroDTE] = useState(false);
  const [alertMarketPulse, setAlertMarketPulse] = useState(false);
  const [alertOutcomes, setAlertOutcomes] = useState(true);
  const [alertTrumpFeed, setAlertTrumpFeed] = useState(false);
  const [alertTypesOpen, setAlertTypesOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadPreferences();
  }, [user]);

  const loadPreferences = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("user_alert_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setTelegramEnabled(data.telegram_enabled);
        setTelegramChatId(data.telegram_chat_id || "");
        setPushEnabled(data.push_enabled);
        setAlertSignals(data.alert_signals);
        setAlertWhales(data.alert_whales);
      }

      const stored = localStorage.getItem(`alert_prefs_${user!.id}`);
      if (stored) {
        try {
          const extra = JSON.parse(stored);
          setAlertBiddiePicks(extra.alertBiddiePicks ?? true);
          setAlertBreakouts(extra.alertBreakouts ?? true);
          setAlertZeroDTE(extra.alertZeroDTE ?? false);
          setAlertMarketPulse(extra.alertMarketPulse ?? false);
          setAlertOutcomes(extra.alertOutcomes ?? true);
          setAlertTrumpFeed(extra.alertTrumpFeed ?? false);
        } catch {}
      }
    } catch (err) {
      console.error("Failed to load preferences:", err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const prefs = {
        user_id: user.id,
        telegram_enabled: telegramEnabled,
        telegram_chat_id: telegramChatId || null,
        push_enabled: pushEnabled,
        alert_signals: alertSignals,
        alert_whales: alertWhales,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("user_alert_preferences")
        .upsert(prefs, { onConflict: "user_id" });

      localStorage.setItem(`alert_prefs_${user.id}`, JSON.stringify({
        alertBiddiePicks,
        alertBreakouts,
        alertZeroDTE,
        alertMarketPulse,
        alertOutcomes,
        alertTrumpFeed,
      }));

      if (error) throw error;
      toast.success("Alert preferences saved!");
    } catch (err) {
      console.error("Failed to save preferences:", err);
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const sendTestAlert = async () => {
    if (!telegramChatId) {
      toast.error("Enter your Telegram chat ID first");
      return;
    }
    setTestingSend(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-alert", {
        body: {
          signals: [{
            ticker: "TEST",
            signal_type: "bullish",
            put_call: "call",
            strike: "$150",
            expiry: "2026-04-17",
            premium: "$25K",
            confidence: 9.0,
            description: "Test alert — your notifications are working! 🎉",
          }],
          override_chat_id: telegramChatId,
        },
      });

      if (error) throw error;
      toast.success("Test alert sent! Check your Telegram.");
    } catch (err) {
      console.error("Test alert failed:", err);
      toast.error("Failed to send test alert. Make sure you started @BiddieAIBot first.");
    } finally {
      setTestingSend(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 bg-muted/30 rounded-xl" />
        <div className="h-32 bg-muted/30 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Telegram Alerts */}
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Telegram Alerts</h3>
            <p className="text-xs text-muted-foreground">Get signal alerts sent to your Telegram</p>
          </div>
          <Switch
            checked={telegramEnabled}
            onCheckedChange={setTelegramEnabled}
            className="ml-auto"
          />
        </div>

        {telegramEnabled && (
          <div className="space-y-3 pt-2 border-t border-border/40">
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">
                Your Telegram Chat ID
              </label>
              <div className="flex gap-2">
                <Input
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="bg-background/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendTestAlert}
                  disabled={testingSend || !telegramChatId}
                  className="shrink-0"
                >
                  {testingSend ? "Sending..." : "Test"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                1. Search <span className="font-medium text-foreground">@BiddieAIBot</span> on Telegram and tap Start
                <br />
                2. Message <span className="font-medium text-foreground">@userinfobot</span> to get your Chat ID
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Browser Push */}
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div className="flex items-center gap-1.5">
            <div>
              <h3 className="font-semibold text-foreground">Browser Push Notifications</h3>
              <p className="text-xs text-muted-foreground">Get alerts in your browser — no app needed</p>
            </div>
            <div className="relative group">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-3 rounded-lg bg-popover border border-border shadow-lg text-xs text-muted-foreground opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 space-y-1.5">
                <p className="font-medium text-foreground">How to enable:</p>
                <p><span className="font-medium text-foreground">Chrome/Edge:</span> Click the lock icon next to the URL bar, set Notifications to "Allow"</p>
                <p><span className="font-medium text-foreground">Safari:</span> Safari {">"} Settings {">"} Websites {">"} Notifications</p>
                <p><span className="font-medium text-foreground">Firefox:</span> Click the lock icon, then "More Information" and allow</p>
                <p><span className="font-medium text-foreground">Mobile:</span> Browser settings {">"} Site Settings {">"} Notifications</p>
                <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-popover border-b border-r border-border rotate-45 -mt-1" />
              </div>
            </div>
          </div>
          <Switch
            checked={pushEnabled}
            onCheckedChange={(checked) => {
              if (checked && "Notification" in window) {
                Notification.requestPermission().then((perm) => {
                  if (perm === "granted") {
                    setPushEnabled(true);
                    toast.success("Push notifications enabled!");
                  } else {
                    setPushEnabled(false);
                    toast.error("Notifications blocked — hover the ? icon for instructions");
                  }
                });
              } else {
                setPushEnabled(checked);
              }
            }}
            className="ml-auto"
          />
        </div>
        {pushEnabled && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">
            You'll receive alerts when the dashboard is open.
          </p>
        )}
      </div>

      {/* Alert Types */}
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <button
          onClick={() => setAlertTypesOpen(!alertTypesOpen)}
          className="flex items-center gap-3 w-full text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
            <Bell className="h-5 w-5 text-accent-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground">Alert Types</h3>
            <p className="text-xs text-muted-foreground">Choose what you want to be notified about</p>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${alertTypesOpen ? "rotate-180" : ""}`} />
        </button>

        <div className={`space-y-3 pt-2 border-t border-border/40 overflow-hidden transition-all duration-200 ${alertTypesOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0 pt-0 border-t-0"}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Biddie Picks</p>
              <p className="text-xs text-muted-foreground">Top AI-curated signals with highest conviction</p>
            </div>
            <Switch checked={alertBiddiePicks} onCheckedChange={setAlertBiddiePicks} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">High-Conviction Signals</p>
              <p className="text-xs text-muted-foreground">Strong setups with price action confirmation</p>
            </div>
            <Switch checked={alertSignals} onCheckedChange={setAlertSignals} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Whale Plays</p>
              <p className="text-xs text-muted-foreground">Large premium trades ($500K+)</p>
            </div>
            <Switch checked={alertWhales} onCheckedChange={setAlertWhales} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Breakout Alerts</p>
              <p className="text-xs text-muted-foreground">Real-time breakout detection on key levels</p>
            </div>
            <Switch checked={alertBreakouts} onCheckedChange={setAlertBreakouts} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">0DTE Plays</p>
              <p className="text-xs text-muted-foreground">Same-day expiry trades for quick movers</p>
            </div>
            <Switch checked={alertZeroDTE} onCheckedChange={setAlertZeroDTE} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Market Pulse Updates</p>
              <p className="text-xs text-muted-foreground">Big market-wide moves and sentiment shifts</p>
            </div>
            <Switch checked={alertMarketPulse} onCheckedChange={setAlertMarketPulse} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Signal Outcomes</p>
              <p className="text-xs text-muted-foreground">Get notified when a signal hits or misses its target</p>
            </div>
            <Switch checked={alertOutcomes} onCheckedChange={setAlertOutcomes} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Trump Feed</p>
              <p className="text-xs text-muted-foreground">Truth Social posts with potential market impact</p>
            </div>
            <Switch checked={alertTrumpFeed} onCheckedChange={setAlertTrumpFeed} />
          </div>
        </div>
      </div>

      <Button onClick={savePreferences} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Preferences"}
      </Button>
    </div>
  );
};

export default NotificationSettings;
