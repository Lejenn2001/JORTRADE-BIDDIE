import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bell, MessageSquare, Smartphone, Send } from "lucide-react";
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
          <div>
            <h3 className="font-semibold text-foreground">Browser Push Notifications</h3>
            <p className="text-xs text-muted-foreground">Get alerts in your browser — no app needed</p>
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
                    toast.error("Please allow notifications in your browser settings");
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
            ✅ Browser notifications are enabled. You'll receive alerts when the dashboard is open.
          </p>
        )}
      </div>

      {/* Alert Types */}
      <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
            <Bell className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Alert Types</h3>
            <p className="text-xs text-muted-foreground">Choose what you want to be notified about</p>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">High-Conviction Signals</p>
              <p className="text-xs text-muted-foreground">Unusual options activity with strong Vol/OI</p>
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
        </div>
      </div>

      <Button onClick={savePreferences} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Preferences"}
      </Button>
    </div>
  );
};

export default NotificationSettings;
