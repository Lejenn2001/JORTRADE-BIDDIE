import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useLocation } from "react-router-dom";
import { usePresenceSetup, PresenceContext } from "@/hooks/usePresence";
import { Crown, Zap, Star, Sparkles } from "lucide-react";

const FREE_TRIAL_DAYS = 5;

const TrialExpiredWall = () => {
  const { profile, signOut } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";

  return (
    <div className="min-h-screen bg-background bg-mesh flex items-center justify-center p-4">
      <div className="glass-panel rounded-2xl border-border/40 max-w-lg w-full p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center mx-auto">
          <Sparkles className="h-8 w-8 text-cyan-400" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Hey {firstName}!</h1>
          <p className="text-muted-foreground">
            Hope you enjoyed your free trial with Biddie AI and the JORTRADE dashboard.
            Your {FREE_TRIAL_DAYS}-day preview has ended — upgrade your plan to keep the signals flowing.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-card/50 rounded-xl p-4 border border-blue-500/20 hover:border-blue-500/40 transition-colors">
            <Star className="h-5 w-5 text-blue-400 mx-auto mb-2" />
            <h3 className="font-semibold text-blue-400 text-sm">Signal Scout</h3>
            <p className="text-[11px] text-muted-foreground mt-1">Community + 10 Biddie chats/day</p>
          </div>
          <div className="bg-card/50 rounded-xl p-4 border border-amber-500/20 hover:border-amber-500/40 transition-colors relative">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">POPULAR</span>
            <Zap className="h-5 w-5 text-amber-400 mx-auto mb-2" />
            <h3 className="font-semibold text-amber-400 text-sm">Active Trader</h3>
            <p className="text-[11px] text-muted-foreground mt-1">Full access + 25 Biddie chats/day</p>
          </div>
          <div className="bg-card/50 rounded-xl p-4 border border-purple-500/20 hover:border-purple-500/40 transition-colors">
            <Crown className="h-5 w-5 text-purple-400 mx-auto mb-2" />
            <h3 className="font-semibold text-purple-400 text-sm">Pro Trader</h3>
            <p className="text-[11px] text-muted-foreground mt-1">Full access + 50 Biddie chats/day</p>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <a
            href="/dashboard/settings"
            className="block w-full py-3 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Choose a Plan
          </a>
          <button
            onClick={signOut}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground/60">
          Questions? Reach out to the JORTRADE team anytime.
        </p>
      </div>
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, isAdmin, loading } = useAuth();
  const onlineUsers = usePresenceSetup();
  const location = useLocation();

  useEffect(() => {
    let tag = document.querySelector('meta[name="robots"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", "noindex, nofollow");
    return () => { tag?.setAttribute("content", "index, follow"); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isSettingsPage = location.pathname === "/dashboard/settings";
  const isAdminPage = location.pathname === "/dashboard/admin";

  if (!isAdmin && !isSettingsPage && !isAdminPage && profile?.created_at) {
    const createdAt = new Date(profile.created_at);
    const now = new Date();
    const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceCreation > FREE_TRIAL_DAYS && profile.selected_plan === "starter") {
      return <TrialExpiredWall />;
    }
  }

  return (
    <PresenceContext.Provider value={onlineUsers}>
      {children}
    </PresenceContext.Provider>
  );
};

export default ProtectedRoute;
