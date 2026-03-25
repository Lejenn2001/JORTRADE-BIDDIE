import { useState, useEffect } from "react";

function getETNow() {
  // Get the current ET time components reliably
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    now,
    weekday: get("weekday"),
    hour: parseInt(get("hour")) % 24,
    minute: parseInt(get("minute")),
    second: parseInt(get("second")),
  };
}

function getMarketState() {
  const { now, weekday, hour, minute, second } = getETNow();
  const totalSec = hour * 3600 + minute * 60 + second;
  const futuresSundaySec = 18 * 3600;       // 6:00 PM ET (Sunday futures open)
  const premarketSec = 4 * 3600;           // 4:00 AM ET
  const openSec = 9 * 3600 + 30 * 60;      // 9:30 AM ET
  const closeSec = 16 * 3600;              // 4:00 PM ET
  const afterHoursEnd = 20 * 3600;          // 8:00 PM ET

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const isWeekday = weekdays.includes(weekday);
  const isSunday = weekday === "Sun";

  // Sunday evening futures session (6 PM ET onward)
  const isSundayFutures = isSunday && totalSec >= futuresSundaySec;

  // Determine session
  const isPremarket = isWeekday && totalSec >= premarketSec && totalSec < openSec;
  const isOpen = isWeekday && totalSec >= openSec && totalSec < closeSec;
  const isAfterHours = isWeekday && totalSec >= closeSec && totalSec < afterHoursEnd;

  let status: "open" | "premarket" | "afterhours" | "closed" | "futures";
  let targetLabel = "";
  let targetTime = "";
  let remainingSec = 0;

  if (isOpen) {
    status = "open";
    targetLabel = "Closes at";
    targetTime = "4:00 PM ET";
    remainingSec = closeSec - totalSec;
  } else if (isPremarket) {
    status = "premarket";
    targetLabel = "Market opens at";
    targetTime = "9:30 AM ET";
    remainingSec = openSec - totalSec;
  } else if (isSundayFutures) {
    status = "futures";
    targetLabel = "Pre-market opens at";
    targetTime = "4:00 AM ET";
    // Seconds left Sunday + 4 hours into Monday
    remainingSec = (86400 - totalSec) + premarketSec;
  } else if (isAfterHours) {
    status = "afterhours";
    targetLabel = "After-hours end at";
    targetTime = "8:00 PM ET";
    remainingSec = afterHoursEnd - totalSec;
  } else {
    status = "closed";

    const secLeftToday = 86400 - totalSec;

    if (isSunday && totalSec < futuresSundaySec) {
      // Sunday before futures open
      targetLabel = "Futures open at";
      targetTime = "6:00 PM ET";
      remainingSec = futuresSundaySec - totalSec;
    } else if (isWeekday && totalSec < premarketSec) {
      // Before premarket on a weekday
      targetLabel = "Pre-market opens at";
      targetTime = "4:00 AM ET";
      remainingSec = premarketSec - totalSec;
    } else {
      // After all sessions or Saturday — find next session
      const dayOrder = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayIdx = dayOrder.indexOf(weekday);

      if (weekday === "Fri" && totalSec >= afterHoursEnd) {
        // Friday after hours ended — next is Sunday 6 PM
        targetLabel = "Futures open at";
        targetTime = "6:00 PM ET";
        remainingSec = secLeftToday + 86400 + futuresSundaySec; // Sat + part of Sun
      } else if (weekday === "Sat") {
        // Saturday — next is Sunday 6 PM
        targetLabel = "Futures open at";
        targetTime = "6:00 PM ET";
        remainingSec = secLeftToday + futuresSundaySec;
      } else {
        // Weekday after 8 PM — next premarket tomorrow
        targetLabel = "Pre-market opens at";
        targetTime = "4:00 AM ET";
        remainingSec = secLeftToday + premarketSec;
      }
    }
  }

  remainingSec = Math.max(0, remainingSec);
  const h = Math.floor(remainingSec / 3600);
  const m = Math.floor((remainingSec % 3600) / 60);
  const s = remainingSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${s}s`);
  const countdown = parts.join(" ");

  return { status, isOpen: status === "open", countdown, targetLabel, targetTime };
}

const MarketStatusSign = () => {
  const [state, setState] = useState(getMarketState);

  useEffect(() => {
    const interval = setInterval(() => setState(getMarketState()), 1000);
    return () => clearInterval(interval);
  }, []);

  const statusConfig = {
    open: {
      label: "Market Open",
      dotClass: "bg-green-500",
      pingClass: "bg-green-500/60",
      textClass: "text-green-400 drop-shadow-[0_0_8px_hsl(142_71%_45%/0.8)] drop-shadow-[0_0_20px_hsl(142_71%_45%/0.4)]",
      textShadow: "0 0 7px hsl(142 71% 45% / 0.8), 0 0 20px hsl(142 71% 45% / 0.4), 0 0 40px hsl(142 71% 45% / 0.2)",
      bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(142_71%_45%/0.15),transparent_70%)]",
      countdownClass: "text-green-400",
    },
    premarket: {
      label: "Pre-Market Open",
      dotClass: "bg-amber-400",
      pingClass: "bg-amber-400/60",
      textClass: "text-amber-400 drop-shadow-[0_0_8px_hsl(45_93%_47%/0.8)] drop-shadow-[0_0_20px_hsl(45_93%_47%/0.4)]",
      textShadow: "0 0 7px hsl(45 93% 47% / 0.8), 0 0 20px hsl(45 93% 47% / 0.4), 0 0 40px hsl(45 93% 47% / 0.2)",
      bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(45_93%_47%/0.12),transparent_70%)]",
      countdownClass: "text-amber-400",
    },
    afterhours: {
      label: "After-Hours",
      dotClass: "bg-purple-400",
      pingClass: "bg-purple-400/60",
      textClass: "text-purple-400 drop-shadow-[0_0_8px_hsl(270_70%_60%/0.8)] drop-shadow-[0_0_20px_hsl(270_70%_60%/0.4)]",
      textShadow: "0 0 7px hsl(270 70% 60% / 0.8), 0 0 20px hsl(270 70% 60% / 0.4)",
      bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(270_70%_60%/0.12),transparent_70%)]",
      countdownClass: "text-purple-400",
    },
    futures: {
      label: "Futures Open",
      dotClass: "bg-cyan-400",
      pingClass: "bg-cyan-400/60",
      textClass: "text-cyan-400 drop-shadow-[0_0_6px_hsl(190_80%_55%/0.5)]",
      textShadow: "0 0 5px hsl(190 80% 55% / 0.4), 0 0 12px hsl(190 80% 55% / 0.15)",
      bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(190_80%_55%/0.06),transparent_70%)]",
      countdownClass: "text-cyan-400",
    },
    closed: {
      label: "Market Closed",
      dotClass: "bg-destructive",
      pingClass: "bg-destructive/40",
      textClass: "text-destructive drop-shadow-[0_0_8px_hsl(0_72%_51%/0.6)]",
      textShadow: "0 0 7px hsl(0 72% 51% / 0.6), 0 0 20px hsl(0 72% 51% / 0.3)",
      bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(0_72%_51%/0.1),transparent_70%)]",
      countdownClass: "text-muted-foreground",
    },
  };

  const cfg = statusConfig[state.status];

  return (
    <div className="glass-panel rounded-xl p-4 border-glow-purple relative overflow-hidden">
      <div className={`absolute inset-0 rounded-xl transition-all duration-1000 ${cfg.bgGlow}`} />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${cfg.dotClass}`} />
            <div className={`absolute inset-0 w-3 h-3 rounded-full animate-ping ${cfg.pingClass}`} />
          </div>
          <span
            className={`text-lg font-black tracking-[0.25em] uppercase ${cfg.textClass}`}
            style={{ textShadow: cfg.textShadow }}
          >
            {cfg.label}
          </span>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {state.targetLabel} <span className="text-foreground font-medium">{state.targetTime}</span>
          </div>
          <div className={`text-sm font-mono font-bold tracking-wider ${cfg.countdownClass}`}>
            {state.countdown}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketStatusSign;
