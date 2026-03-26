import { useState, useCallback } from "react";
import { useAuth, UserPlan } from "@/hooks/useAuth";

const LIMITS: Record<string, number> = {
  starter: 5,
  active: 25,
  pro: 50,
};

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStorageKey(userId: string): string {
  return `biddie-questions-${userId}`;
}

interface StoredData {
  date: string;
  count: number;
}

export function useQuestionLimit() {
  const { user, profile } = useAuth();
  const plan: UserPlan = profile?.selected_plan ?? null;
  const limit = plan ? (LIMITS[plan] ?? 0) : 0;

  const getCount = useCallback((): number => {
    if (!user) return 0;
    try {
      const raw = localStorage.getItem(getStorageKey(user.id));
      if (!raw) return 0;
      const data: StoredData = JSON.parse(raw);
      if (data.date !== getTodayKey()) return 0;
      return data.count;
    } catch {
      return 0;
    }
  }, [user]);

  const [used, setUsed] = useState(getCount);

  const increment = useCallback(() => {
    if (!user) return;
    const today = getTodayKey();
    const newCount = getCount() + 1;
    localStorage.setItem(
      getStorageKey(user.id),
      JSON.stringify({ date: today, count: newCount })
    );
    setUsed(newCount);
  }, [user, getCount]);

  const remaining = Math.max(0, limit - used);
  const canAsk = plan !== null && remaining > 0;
  const hasAccess = plan !== null;

  return { used, remaining, limit, canAsk, hasAccess, increment, plan };
}
