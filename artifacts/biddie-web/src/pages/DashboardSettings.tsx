import { useState, useEffect } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotificationSettings from "@/components/dashboard/NotificationSettings";
import { useAuth } from "@/hooks/useAuth";
import { User, MessageSquare, Check } from "lucide-react";

const ProfileSection = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile?.chat_alias) setAlias(profile.chat_alias);
  }, [profile?.chat_alias]);

  const saveAlias = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await fetch("/api/whale/user-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, chat_alias: alias || null }),
      });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save alias:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[hsl(232,30%,8%)] p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">Profile</h2>
          <p className="text-[10px] text-muted-foreground">Manage your display name</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1.5">Real Name</label>
          <div className="text-sm text-foreground/60 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
            {profile?.full_name || "—"}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1.5">
            <MessageSquare className="w-3 h-3 inline mr-1 -mt-0.5" />
            Chat Alias
          </label>
          <p className="text-[10px] text-muted-foreground/70 mb-1.5">
            This name will show in the community chat instead of your real name. Leave blank to use your real name.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value.slice(0, 20))}
              placeholder="Enter a display name..."
              maxLength={20}
              className="flex-1 text-sm text-foreground bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-colors"
            />
            <button
              onClick={saveAlias}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saved ? <><Check className="w-3 h-3" /> Saved</> : saving ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1">{alias.length}/20 characters</p>
        </div>
      </div>
    </div>
  );
};

const DashboardSettings = () => {
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
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#94a3b8" : "#64748b"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#94a3b8" : "#64748b"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/15 via-transparent to-slate-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

            <div className="relative px-6 py-7">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-slate-400 to-slate-600" />
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                    SETTINGS
                  </h1>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400/80 font-semibold mt-0.5">
                    Preferences & Configuration
                  </p>
                </div>
              </div>
            </div>
          </div>
          <ProfileSection />
          <NotificationSettings />
        </main>
      </div>
    </div>
  );
};

export default DashboardSettings;
