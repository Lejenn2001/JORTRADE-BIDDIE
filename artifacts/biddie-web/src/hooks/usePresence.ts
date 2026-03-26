import { useState, useEffect, createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const CHANNEL_NAME = "presence-room";

const PresenceContext = createContext<Set<string>>(new Set());

export { PresenceContext };

export function usePresenceSetup() {
  const { session, profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: session.user.id } },
    });

    const extractUsers = () => {
      const state = channel.presenceState();
      const ids = new Set<string>();
      Object.values(state).forEach((presences: any) => {
        (presences as any[]).forEach((p: any) => {
          if (p.user_id) ids.add(p.user_id);
        });
      });
      setOnlineUsers(ids);
    };

    channel
      .on("presence", { event: "sync" }, extractUsers)
      .on("presence", { event: "join" }, extractUsers)
      .on("presence", { event: "leave" }, extractUsers)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: session.user.id,
            full_name: profile?.full_name || "Unknown",
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, profile?.full_name]);

  return onlineUsers;
}

export function usePresenceTracker() {
  return useContext(PresenceContext);
}
