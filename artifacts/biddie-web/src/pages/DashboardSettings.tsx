import { useState, useEffect } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotificationSettings from "@/components/dashboard/NotificationSettings";
import { useAuth } from "@/hooks/useAuth";
import { User, MessageSquare, Check, Copy, Gift, Trophy, Star, Crown, Zap, Users, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const TIERS = [
  { key: "launch", label: "Launch Special", icon: "🚀", requirement: 1, reward: "50% off next month", value: "~$25–$65 saved", color: "from-blue-400 to-blue-600" },
  { key: "bronze", label: "Bronze", icon: "🥉", requirement: 3, reward: "1 month free", value: "$49–$129 value", color: "from-amber-600 to-amber-800" },
  { key: "silver", label: "Silver", icon: "🥈", requirement: 5, reward: "Lifetime 25% off", value: "Permanent savings", color: "from-slate-300 to-slate-500" },
  { key: "gold", label: "Gold", icon: "🥇", requirement: 10, reward: "Free upgrade to Pro", value: "~$1,548/yr value", color: "from-yellow-400 to-yellow-600" },
];

const PLAN_DETAILS: Record<string, { name: string; price: string; icon: React.ReactNode; color: string }> = {
  starter: { name: "Signal Scout", price: "$49/mo", icon: <Star className="w-4 h-4" />, color: "text-blue-400" },
  active: { name: "Active Trader", price: "$89/mo", icon: <Zap className="w-4 h-4" />, color: "text-emerald-400" },
  pro: { name: "Pro Trader", price: "$129/mo", icon: <Crown className="w-4 h-4" />, color: "text-yellow-400" },
};

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

  const planInfo = PLAN_DETAILS[profile?.selected_plan || "starter"] || PLAN_DETAILS.starter;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[hsl(232,30%,8%)] p-5 space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">Profile & Membership</h2>
          <p className="text-[10px] text-muted-foreground">Your account details</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1.5">Name</label>
          <div className="text-sm text-foreground/60 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
            {profile?.full_name || "—"}
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1.5">Email</label>
          <div className="text-sm text-foreground/60 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 truncate">
            {user?.email || "—"}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-white/[0.05] flex items-center justify-center ${planInfo.color}`}>
              {planInfo.icon}
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">{planInfo.name}</div>
              <div className="text-xs text-muted-foreground">{planInfo.price}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">Active</span>
            <button className="text-[10px] text-primary hover:text-primary/80 font-semibold flex items-center gap-1 transition-colors">
              Manage Billing <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium block mb-1.5">
          <MessageSquare className="w-3 h-3 inline mr-1 -mt-0.5" />
          Chat Alias
        </label>
        <p className="text-[10px] text-muted-foreground/70 mb-1.5">
          This name shows in the community chat instead of your real name. Leave blank to use your real name.
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
  );
};

const ReferralSection = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [referrals, setReferrals] = useState<{ referred_name: string; created_at: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

  const referralCode = profile?.referral_code || "";
  const referralCount = profile?.referral_count || 0;
  const referralLink = referralCode ? `https://jortrade.com/signup?ref=${referralCode}` : "";

  useEffect(() => {
    if (!user) return;
    setLoadingReferrals(true);
    fetch(`/api/whale/referrals?userId=${user.id}`)
      .then((r) => r.json())
      .then((d) => setReferrals(d.referrals || []))
      .catch(() => {})
      .finally(() => setLoadingReferrals(false));
  }, [user]);

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const currentTierIndex = TIERS.findIndex((t) => referralCount < t.requirement);
  const currentTier = currentTierIndex === -1 ? TIERS[TIERS.length - 1] : (currentTierIndex > 0 ? TIERS[currentTierIndex - 1] : null);
  const nextTier = currentTierIndex === -1 ? null : TIERS[currentTierIndex];
  const progressToNext = nextTier ? (referralCount / nextTier.requirement) * 100 : 100;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[hsl(232,30%,8%)] p-5 space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <Gift className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">Referral Program</h2>
          <p className="text-[10px] text-muted-foreground">Invite friends, earn rewards</p>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <label className="text-xs text-muted-foreground font-medium block">Your Referral Link</label>
        <div className="flex gap-2">
          <div className="flex-1 text-sm text-foreground/80 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 truncate font-mono text-xs">
            {referralLink || "Loading..."}
          </div>
          <button
            onClick={copyLink}
            disabled={!referralLink}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
          >
            {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Friends who sign up with your link get 10% off their first paid month
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            {currentTier ? `${currentTier.icon} ${currentTier.label}` : "No tier yet"}
          </span>
          <span className="text-xs text-muted-foreground">
            {referralCount} referral{referralCount !== 1 ? "s" : ""}
            {nextTier ? ` · ${nextTier.requirement - referralCount} more to ${nextTier.label}` : " · Max tier reached! 🎉"}
          </span>
        </div>

        <div className="relative h-3 bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
            style={{ width: `${Math.min(progressToNext, 100)}%` }}
          />
          {TIERS.map((tier) => {
            const pos = nextTier ? (tier.requirement / nextTier.requirement) * 100 : (tier.requirement / 10) * 100;
            if (pos > 100) return null;
            return (
              <div
                key={tier.key}
                className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border ${
                  referralCount >= tier.requirement
                    ? "bg-emerald-400 border-emerald-300"
                    : "bg-white/10 border-white/20"
                }`}
                style={{ left: `${Math.min(pos, 98)}%` }}
                title={`${tier.label}: ${tier.requirement} referrals`}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIERS.map((tier) => {
            const reached = referralCount >= tier.requirement;
            const isNext = nextTier?.key === tier.key;
            return (
              <div
                key={tier.key}
                className={`rounded-lg border p-3 text-center transition-all ${
                  reached
                    ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                    : isNext
                    ? "border-primary/20 bg-primary/[0.04]"
                    : "border-white/[0.04] bg-white/[0.01]"
                }`}
              >
                <div className="text-lg mb-1">{tier.icon}</div>
                <div className={`text-[10px] font-bold ${reached ? "text-emerald-400" : "text-foreground/60"}`}>
                  {tier.label}
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{tier.requirement} referral{tier.requirement > 1 ? "s" : ""}</div>
                <div className={`text-[9px] mt-1 font-medium ${reached ? "text-emerald-400/80" : "text-muted-foreground/50"}`}>
                  {tier.reward}
                </div>
                {reached && (
                  <div className="text-[8px] text-emerald-400 font-bold mt-1 flex items-center justify-center gap-0.5">
                    <Check className="w-2.5 h-2.5" /> Unlocked
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Your Referrals</span>
        </div>
        {loadingReferrals ? (
          <div className="text-xs text-muted-foreground/50 py-4 text-center">Loading...</div>
        ) : referrals.length === 0 ? (
          <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] py-6 text-center">
            <Gift className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/50">No referrals yet</p>
            <p className="text-[10px] text-muted-foreground/30 mt-0.5">Share your link to start earning rewards</p>
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.04] overflow-hidden">
            <div className="grid grid-cols-3 text-[10px] text-muted-foreground/50 font-semibold uppercase tracking-wider px-3 py-2 border-b border-white/[0.04] bg-white/[0.01]">
              <span>Name</span>
              <span>Joined</span>
              <span>Status</span>
            </div>
            {referrals.map((ref, i) => (
              <div
                key={i}
                className="grid grid-cols-3 text-xs px-3 py-2.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-foreground/70 truncate">{ref.referred_name}</span>
                <span className="text-muted-foreground/60">
                  {new Date(ref.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="text-emerald-400/80 font-medium">Signed Up</span>
              </div>
            ))}
          </div>
        )}
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
          <ReferralSection />
          <NotificationSettings />
        </main>
      </div>
    </div>
  );
};

export default DashboardSettings;
