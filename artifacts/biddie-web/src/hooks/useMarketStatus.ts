import { useEffect, useState } from "react";
import { isMarketOpenET, marketClosedReason, type MarketClosedReason } from "@/lib/marketHours";

// useMarketStatus
// ─────────────────────────────────────────────────────────────────────────────
// Live-updating market status for trade-execution gating in the UI.
// Re-evaluates every 30s (cheap — local clock + Intl format only) so that the
// state flips to "closed" within ~30s of 4:00 PM ET, and back to "open" within
// ~30s of 9:30 AM ET on the next session.
//
// Backend is authoritative; this hook only mirrors the gate so we can
// preemptively disable buttons and show the closed-market banner.
export function useMarketStatus(): { isOpen: boolean; reason: MarketClosedReason | null } {
  const [isOpen, setIsOpen] = useState<boolean>(() => isMarketOpenET());
  const [reason, setReason] = useState<MarketClosedReason | null>(() => marketClosedReason());

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const open = isMarketOpenET(now);
      const r = marketClosedReason(now);
      // Only set state when something actually changed to avoid spurious
      // re-renders on consumers (PaperTradeTicket re-mounts a fetch loop).
      setIsOpen((prev) => (prev === open ? prev : open));
      setReason((prev) => (prev === r ? prev : r));
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return { isOpen, reason };
}
