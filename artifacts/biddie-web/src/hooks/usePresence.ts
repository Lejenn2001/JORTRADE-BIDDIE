import { useState, useEffect, useRef, createContext, useContext } from "react";
import { useAuth } from "@/hooks/useAuth";

const HEARTBEAT_INTERVAL = 30_000;
const POLL_INTERVAL = 15_000;

const PresenceContext = createContext<Set<string>>(new Set());

export { PresenceContext };

export function usePresenceSetup() {
  const { session, profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const myId = session.user.id;
    const myName = profile?.full_name || "Unknown";

    setOnlineUsers(new Set([myId]));

    const heartbeat = async () => {
      try {
        await fetch("/api/whale/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": myId },
          body: JSON.stringify({ name: myName }),
        });
      } catch {}
    };

    const poll = async () => {
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
    };

    heartbeat();
    poll();

    const h = setInterval(heartbeat, HEARTBEAT_INTERVAL);
    const p = setInterval(poll, POLL_INTERVAL);
    intervalRef.current = [h, p];

    return () => {
      clearInterval(h);
      clearInterval(p);
    };
  }, [session?.user?.id, profile?.full_name]);

  return onlineUsers;
}

export function usePresenceTracker() {
  return useContext(PresenceContext);
}
