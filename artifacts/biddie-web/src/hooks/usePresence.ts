import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const CHANNEL_NAME = "presence-room";

export function usePresenceBroadcast() {
  const { session, profile } = useAuth();

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: session.user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {})
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
}

export function usePresenceTracker() {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const extractUsers = useCallback((channel: any) => {
    const state = channel.presenceState();
    const ids = new Set<string>();
    Object.values(state).forEach((presences: any[]) => {
      presences.forEach((p) => {
        if (p.user_id) ids.add(p.user_id);
      });
    });
    setOnlineUsers(ids);
  }, []);

  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME);

    channel
      .on("presence", { event: "sync" }, () => extractUsers(channel))
      .on("presence", { event: "join" }, () => extractUsers(channel))
      .on("presence", { event: "leave" }, () => extractUsers(channel))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [extractUsers]);

  return onlineUsers;
}
