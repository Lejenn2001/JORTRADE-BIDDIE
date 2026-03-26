import { useState, useCallback } from "react";
import { useAuth, UserPlan } from "@/hooks/useAuth";

const LIMITS: Record<string, number> = {
  starter: 0,
  active: 25,
  pro: 50,
};

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStorageKey(userId: string): string {
  return `biddie-questions-${userId}`;
}

function getCreditsKey(userId: string): string {
  return `biddie-credits-${userId}`;
}

interface StoredData {
  date: string;
  count: number;
}

export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  price: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack-10", label: "10 Questions", credits: 10, price: "$4.99" },
  { id: "pack-25", label: "25 Questions", credits: 25, price: "$9.99" },
  { id: "pack-50", label: "50 Questions", credits: 50, price: "$17.99" },
];

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

  const getCredits = useCallback((): number => {
    if (!user) return 0;
    try {
      return parseInt(localStorage.getItem(getCreditsKey(user.id)) || "0", 10);
    } catch {
      return 0;
    }
  }, [user]);

  const [used, setUsed] = useState(getCount);
  const [credits, setCredits] = useState(getCredits);

  const increment = useCallback(() => {
    if (!user) return;
    const today = getTodayKey();
    const currentUsed = getCount();

    if (currentUsed < limit) {
      const newCount = currentUsed + 1;
      localStorage.setItem(
        getStorageKey(user.id),
        JSON.stringify({ date: today, count: newCount })
      );
      setUsed(newCount);
    } else if (credits > 0) {
      const newCredits = credits - 1;
      localStorage.setItem(getCreditsKey(user.id), String(newCredits));
      setCredits(newCredits);
    }
  }, [user, getCount, limit, credits]);

  const addCredits = useCallback((amount: number) => {
    if (!user) return;
    const newCredits = getCredits() + amount;
    localStorage.setItem(getCreditsKey(user.id), String(newCredits));
    setCredits(newCredits);
  }, [user, getCredits]);

  const remaining = Math.max(0, limit - used);
  const totalAvailable = remaining + credits;
  const canAsk = plan !== "starter" && plan !== null && totalAvailable > 0;
  const hasAccess = plan !== "starter" && plan !== null;
  const usingCredits = remaining === 0 && credits > 0;
  const dailyLimitHit = remaining === 0;

  return {
    used,
    remaining,
    limit,
    canAsk,
    hasAccess,
    increment,
    plan,
    credits,
    totalAvailable,
    usingCredits,
    dailyLimitHit,
    addCredits,
  };
}
