import { useState, useEffect } from "react";
import { Globe, Building2, Landmark } from "lucide-react";
import { useWeather } from "@/hooks/useWeather";

function getETNow() {
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
  const futuresSundaySec = 18 * 3600;
  const premarketSec = 4 * 3600;
  const openSec = 9 * 3600 + 30 * 60;
  const closeSec = 16 * 3600;
  const afterHoursEnd = 20 * 3600;

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const isWeekday = weekdays.includes(weekday);
  const isSunday = weekday === "Sun";
  const isSundayFutures = isSunday && totalSec >= futuresSundaySec;

  const isPremarket = isWeekday && totalSec >= premarketSec && totalSec < openSec;
  const isOpen = isWeekday && totalSec >= openSec && totalSec < closeSec;
  const isAfterHours = isWeekday && totalSec >= closeSec && totalSec < afterHoursEnd;

  let status: "open" | "premarket" | "afterhours" | "closed" | "futures";
  let targetLabel = "";
  let targetTime = "";
  let remainingSec = 0;

  if (isOpen) {
    status = "open";
    targetLabel = "MARKET CLOSES AT";
    targetTime = "4:00 PM ET";
    remainingSec = closeSec - totalSec;
  } else if (isPremarket) {
    status = "premarket";
    targetLabel = "MARKET OPENS AT";
    targetTime = "9:30 AM ET";
    remainingSec = openSec - totalSec;
  } else if (isSundayFutures) {
    status = "futures";
    targetLabel = "PRE-MARKET OPENS AT";
    targetTime = "4:00 AM ET";
    remainingSec = (86400 - totalSec) + premarketSec;
  } else if (isAfterHours) {
    status = "afterhours";
    targetLabel = "AFTER-HOURS END AT";
    targetTime = "8:00 PM ET";
    remainingSec = afterHoursEnd - totalSec;
  } else {
    status = "closed";
    const secLeftToday = 86400 - totalSec;

    if (isSunday && totalSec < futuresSundaySec) {
      targetLabel = "FUTURES OPEN AT";
      targetTime = "6:00 PM ET";
      remainingSec = futuresSundaySec - totalSec;
    } else if (isWeekday && totalSec < premarketSec) {
      targetLabel = "PRE-MARKET OPENS AT";
      targetTime = "4:00 AM ET";
      remainingSec = premarketSec - totalSec;
    } else {
      if (weekday === "Fri" && totalSec >= afterHoursEnd) {
        targetLabel = "FUTURES OPEN AT";
        targetTime = "SUN 6:00 PM ET";
        remainingSec = secLeftToday + 86400 + futuresSundaySec;
      } else if (weekday === "Sat") {
        targetLabel = "FUTURES OPEN AT";
        targetTime = "SUN 6:00 PM ET";
        remainingSec = secLeftToday + futuresSundaySec;
      } else {
        targetLabel = "PRE-MARKET OPENS AT";
        targetTime = "4:00 AM ET";
        remainingSec = secLeftToday + premarketSec;
      }
    }
  }

  remainingSec = Math.max(0, remainingSec);
  const h = Math.floor(remainingSec / 3600);
  const m = Math.floor((remainingSec % 3600) / 60);
  const s = remainingSec % 60;
  const countdown = `${h}h  ${String(m).padStart(2, "0")}m  ${String(s).padStart(2, "0")}s`;

  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  const currentTime = `${h12}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ${ampm} ET`;

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const dateStr = dateFormatter.format(now);

  const etMins = hour * 60 + minute;

  const isSat = weekday === "Sat";
  const isFri = weekday === "Fri";

  const asiaActive = (() => {
    if (isSat) return false;
    if (isSunday && etMins < 18 * 60) return false;
    if (isSunday && etMins >= 19 * 60) return true;
    if (isWeekday && etMins < 4 * 60) return true;
    if (isFri && etMins >= 19 * 60) return false;
    if (isWeekday && etMins >= 19 * 60) return true;
    return false;
  })();

  const londonActive = (() => {
    if (isSat || isSunday) return false;
    return isWeekday && etMins >= 3 * 60 && etMins < 12 * 60;
  })();

  const nyActive = isWeekday && totalSec >= openSec && totalSec < closeSec;

  return { status, isOpen: status === "open", countdown, currentTime, dateStr, targetLabel, targetTime, asiaActive, londonActive, nyActive };
}

const statusConfig = {
  open: {
    label: "MARKET OPEN",
    dotClass: "bg-green-500",
    pingClass: "bg-green-500/60",
    textClass: "text-green-400",
    textShadow: "0 0 7px hsl(142 71% 45% / 0.8), 0 0 20px hsl(142 71% 45% / 0.4), 0 0 40px hsl(142 71% 45% / 0.2)",
    bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(142_71%_45%/0.12),transparent_70%)]",
    borderGlow: "border-emerald-500/30 shadow-[0_0_20px_hsl(142,71%,45%,0.1),inset_0_0_20px_hsl(142,71%,45%,0.03)]",
  },
  premarket: {
    label: "PRE-MARKET",
    dotClass: "bg-amber-400",
    pingClass: "bg-amber-400/60",
    textClass: "text-amber-400",
    textShadow: "0 0 7px hsl(45 93% 47% / 0.8), 0 0 20px hsl(45 93% 47% / 0.4)",
    bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(45_93%_47%/0.1),transparent_70%)]",
    borderGlow: "border-amber-500/30 shadow-[0_0_20px_hsl(45,93%,47%,0.1),inset_0_0_20px_hsl(45,93%,47%,0.03)]",
  },
  afterhours: {
    label: "AFTER-HOURS",
    dotClass: "bg-purple-400",
    pingClass: "bg-purple-400/60",
    textClass: "text-purple-400",
    textShadow: "0 0 7px hsl(270 70% 60% / 0.8), 0 0 20px hsl(270 70% 60% / 0.4)",
    bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(270_70%_60%/0.1),transparent_70%)]",
    borderGlow: "border-purple-500/30 shadow-[0_0_20px_hsl(270,70%,60%,0.1),inset_0_0_20px_hsl(270,70%,60%,0.03)]",
  },
  futures: {
    label: "FUTURES OPEN",
    dotClass: "bg-cyan-400",
    pingClass: "bg-cyan-400/60",
    textClass: "text-cyan-400",
    textShadow: "0 0 5px hsl(190 80% 55% / 0.4), 0 0 12px hsl(190 80% 55% / 0.15)",
    bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(190_80%_55%/0.06),transparent_70%)]",
    borderGlow: "border-cyan-500/30 shadow-[0_0_20px_hsl(190,80%,55%,0.1),inset_0_0_20px_hsl(190,80%,55%,0.03)]",
  },
  closed: {
    label: "MARKET CLOSED",
    dotClass: "bg-destructive",
    pingClass: "bg-destructive/40",
    textClass: "text-destructive",
    textShadow: "0 0 7px hsl(0 72% 51% / 0.6), 0 0 20px hsl(0 72% 51% / 0.3)",
    bgGlow: "bg-[radial-gradient(ellipse_at_center,hsl(0_72%_51%/0.08),transparent_70%)]",
    borderGlow: "border-red-500/20 shadow-[0_0_20px_hsl(0,72%,51%,0.08),inset_0_0_20px_hsl(0,72%,51%,0.02)]",
  },
};

const MarketStatusSign = () => {
  const [state, setState] = useState(getMarketState);

  useEffect(() => {
    const interval = setInterval(() => setState(getMarketState()), 1000);
    return () => clearInterval(interval);
  }, []);

  const cfg = statusConfig[state.status];
  const { weather } = useWeather();

  const sessions = [
    {
      name: "Asia",
      hours: "7 PM – 4 AM ET",
      icon: <Globe className="h-4 w-4" />,
      active: state.asiaActive,
      activeColor: "text-cyan-400",
      activeBorder: "border-cyan-400/50",
      activeBg: "bg-cyan-500/[0.07]",
      activeGlow: "shadow-[0_0_15px_hsl(180,80%,50%,0.2),inset_0_0_15px_hsl(180,80%,50%,0.04)]",
      dotColor: "bg-cyan-400",
    },
    {
      name: "London",
      hours: "3 AM – 12 PM ET",
      icon: <Landmark className="h-4 w-4" />,
      active: state.londonActive,
      activeColor: "text-amber-400",
      activeBorder: "border-amber-400/50",
      activeBg: "bg-amber-500/[0.07]",
      activeGlow: "shadow-[0_0_15px_hsl(38,92%,50%,0.2),inset_0_0_15px_hsl(38,92%,50%,0.04)]",
      dotColor: "bg-amber-400",
    },
    {
      name: "New York",
      hours: "9:30 AM – 4 PM ET",
      icon: <Building2 className="h-4 w-4" />,
      active: state.nyActive,
      activeColor: "text-emerald-400",
      activeBorder: "border-emerald-400/50",
      activeBg: "bg-emerald-500/[0.07]",
      activeGlow: "shadow-[0_0_15px_hsl(142,71%,45%,0.2),inset_0_0_15px_hsl(142,71%,45%,0.04)]",
      dotColor: "bg-emerald-400",
    },
  ];

  return (
    <div className={`relative overflow-hidden rounded-xl border ${cfg.borderGlow} bg-[hsl(232,30%,7%,0.95)] backdrop-blur-md`}>
      <div className={`absolute inset-0 rounded-xl transition-all duration-1000 ${cfg.bgGlow}`} />

      <div className="relative p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className={`w-3 h-3 rounded-full ${cfg.dotClass}`} />
              <div className={`absolute inset-0 w-3 h-3 rounded-full animate-ping ${cfg.pingClass}`} />
            </div>
            <div>
              <span
                className={`text-xl sm:text-2xl font-black tracking-[0.2em] uppercase ${cfg.textClass}`}
                style={{ textShadow: cfg.textShadow }}
              >
                {cfg.label}
              </span>
              <div className="text-xs font-semibold text-foreground tracking-wide mt-0.5">
                {state.currentTime}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">
                {state.dateStr} EST
              </div>
            </div>

            {weather && (
              <div className="flex items-center gap-1.5 ml-4 pl-4 border-l border-white/10">
                <span className="text-lg">{weather.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-foreground">{weather.temp}°F</p>
                  <p className="text-[9px] text-muted-foreground">{weather.location}</p>
                </div>
              </div>
            )}
          </div>

          <div className="text-right">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              {state.targetLabel} <span className="text-foreground font-bold">{state.targetTime}</span>
            </div>
            <div className="text-[11px] font-semibold tracking-wider text-muted-foreground mt-0.5">
              {state.countdown}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {sessions.map((s) => (
            <div
              key={s.name}
              className={`relative rounded-xl border px-4 py-3 text-center transition-all duration-500 ${
                s.active
                  ? `${s.activeBorder} ${s.activeBg} ${s.activeGlow}`
                  : "border-white/[0.12] bg-white/[0.03] opacity-40"
              }`}
            >
              <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full border-2 border-[hsl(232,30%,7%)] ${
                s.active ? `${s.dotColor} animate-pulse` : "bg-white/15"
              }`} />

              <div className={`flex items-center justify-center gap-1.5 mb-1 ${s.active ? s.activeColor : "text-muted-foreground/50"}`}>
                {s.icon}
                <span className={`text-sm font-bold ${s.active ? s.activeColor : "text-muted-foreground/50"}`}>
                  {s.name}
                </span>
              </div>
              <div className={`text-[11px] font-medium ${s.active ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                {s.hours}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MarketStatusSign;
