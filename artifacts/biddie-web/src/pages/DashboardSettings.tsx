import { useState, useEffect } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotificationSettings from "@/components/dashboard/NotificationSettings";
import { useAuth } from "@/hooks/useAuth";
import { User, MessageSquare, Check, Copy, Gift, Star, Crown, Zap, Users, ExternalLink, Share2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const TIERS = [
  {
    key: "first",
    icon: "🚀",
    requirement: 1,
    rewards: ["50% OFF your next month"],
    color: "from-blue-400 to-blue-600",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/[0.06]",
    textColor: "text-blue-400",
  },
  {
    key: "bronze",
    label: "Bronze",
    icon: "🥉",
    requirement: 3,
    rewards: ["1 FREE month", "Community badge"],
    color: "from-amber-600 to-amber-800",
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-500/[0.06]",
    textColor: "text-amber-400",
  },
  {
    key: "silver",
    label: "Silver",
    icon: "🥈",
    requirement: 5,
    rewards: ["1 FREE month", "20% OFF for life", "Early feature access"],
    color: "from-slate-300 to-slate-500",
    borderColor: "border-slate-400/30",
    bgColor: "bg-slate-400/[0.06]",
    textColor: "text-slate-300",
  },
  {
    key: "gold",
    label: "Gold",
    icon: "🥇",
    requirement: 10,
    rewards: ["Pro upgrade or 50% OFF Pro for life", "Priority Biddie AI access", "Exclusive signals access"],
    color: "from-yellow-400 to-yellow-600",
    borderColor: "border-yellow-500/30",
    bgColor: "bg-yellow-500/[0.06]",
    textColor: "text-yellow-400",
  },
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
  const { user, profile } = useAuth();
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
  const maxReq = 10;
  const progressPercent = Math.min((referralCount / maxReq) * 100, 100);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[hsl(232,30%,8%)] overflow-hidden">
      <div className="relative px-5 pt-6 pb-5 border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.04] via-transparent to-blue-500/[0.04]" />
        <div className="relative space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Share2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-black text-foreground tracking-wide">Turn Your Network Into Your Edge</h2>
              <p className="text-[11px] text-muted-foreground font-medium">Invite. Earn. Upgrade.</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Most traders trade alone. The smart ones build networks — and get rewarded for it.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">How It Works</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
              <div className="text-lg mb-1">1</div>
              <div className="text-[10px] text-foreground/70 font-medium">Share your referral link</div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
              <div className="text-lg mb-1">2</div>
              <div className="text-[10px] text-foreground/70 font-medium">Friend joins & subscribes</div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-center">
              <div className="text-lg mb-1">3</div>
              <div className="text-[10px] text-foreground/70 font-medium">You earn rewards</div>
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground/40 leading-relaxed">
            Referrals are counted once a referred user completes their first successful subscription payment. Abuse or self-referrals may result in disqualification.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
          <label className="text-xs text-emerald-400 font-bold block uppercase tracking-wider">Your Referral Link</label>
          <div className="flex gap-2">
            <div className="flex-1 text-foreground/80 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 truncate font-mono text-[11px]">
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
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">Earn More As You Grow</span>
          </div>

          <div className="space-y-1.5">
            {[
              { req: 1, text: "50% OFF your next month", icon: "🚀" },
              { req: 3, text: "1 FREE month + Bronze status", icon: "🥉" },
              { req: 5, text: "1 FREE month + 20% OFF for life (Silver)", icon: "🥈" },
              { req: 10, text: "Gold status + Pro upgrade or Pro Elite", icon: "🥇" },
            ].map((step) => (
              <div
                key={step.req}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-all ${
                  referralCount >= step.req
                    ? "bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-400"
                    : "bg-white/[0.01] border border-white/[0.04] text-foreground/60"
                }`}
              >
                <span className="text-base">{step.icon}</span>
                <span className="font-bold min-w-[20px]">{step.req}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                <span className="font-medium">{step.text}</span>
                {referralCount >= step.req && <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              {currentTier ? `${currentTier.icon} ${currentTier.label || "Started"}` : "No tier yet"}
            </span>
            <span className="text-xs text-muted-foreground">
              {referralCount} referral{referralCount !== 1 ? "s" : ""}
              {nextTier ? ` · ${nextTier.requirement - referralCount} more to ${nextTier.label || "next reward"}` : " · Max tier reached!"}
            </span>
          </div>

          <div className="relative h-3 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
              style={{ width: `${progressPercent}%` }}
            />
            {TIERS.map((tier) => {
              const pos = (tier.requirement / maxReq) * 100;
              return (
                <div
                  key={tier.key}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 transition-all ${
                    referralCount >= tier.requirement
                      ? "bg-emerald-400 border-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                      : "bg-white/10 border-white/20"
                  }`}
                  style={{ left: `${Math.min(pos, 97)}%` }}
                  title={`${tier.label || "First"}: ${tier.requirement} referral${tier.requirement > 1 ? "s" : ""}`}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Crown className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">What You Unlock</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`rounded-lg border p-4 space-y-2 ${referralCount >= 3 ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/[0.06] bg-white/[0.01]"}`}>
              <div className="text-lg">🥉</div>
              <div className={`text-xs font-bold ${referralCount >= 3 ? "text-amber-400" : "text-foreground/60"}`}>Bronze (3 Referrals)</div>
              <ul className="space-y-1">
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> 1 FREE month</li>
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> Community badge</li>
              </ul>
            </div>
            <div className={`rounded-lg border p-4 space-y-2 ${referralCount >= 5 ? "border-slate-400/30 bg-slate-400/[0.04]" : "border-white/[0.06] bg-white/[0.01]"}`}>
              <div className="text-lg">🥈</div>
              <div className={`text-xs font-bold ${referralCount >= 5 ? "text-slate-300" : "text-foreground/60"}`}>Silver (5 Referrals)</div>
              <ul className="space-y-1">
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> 1 FREE month</li>
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> 20% OFF for life</li>
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> Early feature access</li>
              </ul>
            </div>
            <div className={`rounded-lg border p-4 space-y-2 ${referralCount >= 10 ? "border-yellow-500/30 bg-yellow-500/[0.04]" : "border-white/[0.06] bg-white/[0.01]"}`}>
              <div className="text-lg">🥇</div>
              <div className={`text-xs font-bold ${referralCount >= 10 ? "text-yellow-400" : "text-foreground/60"}`}>Gold (10 Referrals)</div>
              <ul className="space-y-1">
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> Free Pro upgrade (or 50% OFF Pro for life)</li>
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> Priority Biddie AI access</li>
                <li className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><Check className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground/30" /> Exclusive signals access</li>
              </ul>
            </div>
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

        <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-4 text-center space-y-1">
          <p className="text-xs font-bold text-foreground">The traders who share the edge... become the edge.</p>
          <p className="text-[10px] text-muted-foreground/60">Share your link. Build your network. Unlock your edge.</p>
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
          <ReferralSection />
          <NotificationSettings />
        </main>
      </div>
    </div>
  );
};

export default DashboardSettings;
