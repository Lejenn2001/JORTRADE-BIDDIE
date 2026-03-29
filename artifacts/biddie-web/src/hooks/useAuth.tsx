import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type UserPlan = "starter" | "active" | "pro" | null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { full_name: string; selected_plan: UserPlan; created_at: string; chat_alias: string | null; referral_code: string | null; referral_count: number } | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; selected_plan: UserPlan; created_at: string; chat_alias: string | null; referral_code: string | null; referral_count: number } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const [{ data }, aliasResp] = await Promise.all([
      supabase.from("profiles").select("full_name, selected_plan, created_at").eq("id", userId).single(),
      fetch(`/api/whale/user-settings?userId=${userId}`).then(r => r.json()).catch(() => ({ chat_alias: null })),
    ]);
    if (data) {
      const plan = (data.selected_plan as UserPlan) || "starter";
      if (!data.selected_plan) {
        supabase.from("profiles").update({ selected_plan: "starter" }).eq("id", userId).then(() => {});
      }
      setProfile({ full_name: data.full_name, selected_plan: plan, created_at: data.created_at, chat_alias: aliasResp?.chat_alias || null, referral_code: aliasResp?.referral_code || null, referral_count: aliasResp?.referral_count || 0 });
    }

    try {
      const adminResp = await fetch(`/api/whale/admin/check?userId=${userId}`);
      const adminData = await adminResp.json();
      setIsAdmin(!!adminData?.isAdmin);
    } catch {
      setIsAdmin(false);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchProfile(session.user.id), 0);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
