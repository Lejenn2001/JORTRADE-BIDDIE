import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";

const HEARTBEAT_INTERVAL = 30_000;
const POLL_INTERVAL = 15_000;

const PresenceContext = createContext<Set<string>>(new Set());

export { PresenceContext };

export function usePresenceSetup() {
  const { session, profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const sendHeartbeat = useCallback(async (userId: string, name: string) => {
    try {
      await fetch("/api/whale/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ name }),
      });
    } catch {}
  }, []);

  const pollOnline = useCallback(async (myId: string) => {
    try {
      const resp = await fetch("/api/whale/presence/online");
      if (resp.ok) {
        const data = await resp.json();
        const ids = new Set<string>([myId]);
        for (const u of data.online) {
          ids.add(u.userId);
        }
        setOnlineUsers(ids);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    const myId = session.user.id;
    const myName = profile?.full_name || "Unknown";

    setOnlineUsers(new Set([myId]));

    sendHeartbeat(myId, myName);
    pollOnline(myId);

    const heartbeatTimer = setInterval(() => sendHeartbeat(myId, myName), HEARTBEAT_INTERVAL);
    const pollTimer = setInterval(() => pollOnline(myId), POLL_INTERVAL);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(pollTimer);
    };
  }, [session?.user?.id, profile?.full_name, sendHeartbeat, pollOnline]);

  return onlineUsers;
}

export function usePresenceTracker() {
  return useContext(PresenceContext);
}
