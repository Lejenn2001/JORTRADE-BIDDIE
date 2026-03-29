import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import SignalAlerts from "./SignalAlerts";
import { Globe, Building2, Landmark } from "lucide-react";

interface SessionInfo {
  name: string;
  hours: string;
  icon: React.ReactNode;
  isActive: boolean;
  color: string;
  borderColor: string;
  glowColor: string;
  dotColor: string;
}

function getETDate(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function getMarketStatus(now: Date): { isOpen: boolean; label: string; nextEvent: string; nextTime: string } {
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  const day = now.getDay();
  const weekday = day >= 1 && day <= 5;

  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  const futuresOpen = 18 * 60;

  if (weekday && mins >= marketOpen && mins < marketClose) {
    return { isOpen: true, label: "MARKET OPEN", nextEvent: "MARKET CLOSES AT", nextTime: "4:00 PM ET" };
  }

  if (weekday && mins >= marketClose && mins < futuresOpen) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "FUTURES OPEN AT", nextTime: "6:00 PM ET" };
  }

  if ((weekday && mins >= futuresOpen) || (day >= 1 && day <= 4 && mins < marketOpen) || (day === 1 && mins < marketOpen)) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "MARKET OPENS AT", nextTime: "9:30 AM ET" };
  }

  if (day === 5 && mins >= marketClose) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "FUTURES OPEN", nextTime: "SUN 6:00 PM ET" };
  }

  if (day === 6) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "FUTURES OPEN", nextTime: "SUN 6:00 PM ET" };
  }

  if (day === 0 && mins < futuresOpen) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "FUTURES OPEN AT", nextTime: "6:00 PM ET" };
  }

  if (day === 0 && mins >= futuresOpen) {
    return { isOpen: false, label: "MARKET CLOSED", nextEvent: "MARKET OPENS AT", nextTime: "MON 9:30 AM ET" };
  }

  return { isOpen: false, label: "MARKET CLOSED", nextEvent: "FUTURES OPEN AT", nextTime: "6:00 PM ET" };
}

function getCountdown(now: Date): string {
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const mins = h * 60 + m;
  const day = now.getDay();
  const weekday = day >= 1 && day <= 5;

  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  const futuresOpen = 18 * 60;

  let targetMins = 0;

  if (weekday && mins >= marketOpen && mins < marketClose) {
    targetMins = marketClose;
  } else if (weekday && mins < marketOpen && mins >= 0) {
    targetMins = marketOpen;
  } else if (weekday && mins >= marketClose && mins < futuresOpen) {
    targetMins = futuresOpen;
  } else if (weekday && mins >= futuresOpen) {
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(9, 30, 0, 0);
    const diff = Math.max(0, Math.floor((nextDay.getTime() - now.getTime()) / 1000));
    const hh = Math.floor(diff / 3600);
    const mm = Math.floor((diff % 3600) / 60);
    const ss = diff % 60;
    return `${hh}h  ${String(mm).padStart(2, "0")}m  ${String(ss).padStart(2, "0")}s`;
  } else if (day === 0 && mins < futuresOpen) {
    targetMins = futuresOpen;
  } else if (day === 0 && mins >= futuresOpen) {
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(9, 30, 0, 0);
    const diff = Math.max(0, Math.floor((nextDay.getTime() - now.getTime()) / 1000));
    const hh = Math.floor(diff / 3600);
    const mm = Math.floor((diff % 3600) / 60);
    const ss = diff % 60;
    return `${hh}h  ${String(mm).padStart(2, "0")}m  ${String(ss).padStart(2, "0")}s`;
  } else {
    const nextSunday = new Date(now);
    const daysUntilSunday = (7 - day) % 7 || 7;
    nextSunday.setDate(nextSunday.getDate() + daysUntilSunday);
    nextSunday.setHours(18, 0, 0, 0);
    const diff = Math.max(0, Math.floor((nextSunday.getTime() - now.getTime()) / 1000));
    const hh = Math.floor(diff / 3600);
    const mm = Math.floor((diff % 3600) / 60);
    const ss = diff % 60;
    return `${hh}h  ${String(mm).padStart(2, "0")}m  ${String(ss).padStart(2, "0")}s`;
  }

  const totalSec = Math.max(0, (targetMins - mins) * 60 - s);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${hh}h  ${String(mm).padStart(2, "0")}m  ${String(ss).padStart(2, "0")}s`;
}

function getSessions(now: Date): SessionInfo[] {
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  const weekday = isWeekday(now);

  const asiaStart = 19 * 60;
  const asiaEnd = 4 * 60;
  const asiaActive = (mins >= asiaStart) || (mins < asiaEnd);

  const londonStart = 3 * 60;
  const londonEnd = 12 * 60;
  const londonActive = weekday && mins >= londonStart && mins < londonEnd;

  const nyStart = 9 * 60 + 30;
  const nyEnd = 16 * 60;
  const nyActive = weekday && mins >= nyStart && mins < nyEnd;

  return [
    {
      name: "Asia",
      hours: "7 PM – 4 AM ET",
      icon: <Globe className="h-3.5 w-3.5" />,
      isActive: asiaActive,
      color: "text-cyan-400",
      borderColor: asiaActive ? "border-cyan-400/60" : "border-white/10",
      glowColor: asiaActive ? "shadow-[0_0_15px_hsl(180,80%,50%,0.25),inset_0_0_15px_hsl(180,80%,50%,0.05)]" : "",
      dotColor: asiaActive ? "bg-cyan-400" : "bg-white/20",
    },
    {
      name: "London",
      hours: "3 AM – 12 PM ET",
      icon: <Landmark className="h-3.5 w-3.5" />,
      isActive: londonActive,
      color: "text-amber-400",
      borderColor: londonActive ? "border-amber-400/60" : "border-white/10",
      glowColor: londonActive ? "shadow-[0_0_15px_hsl(38,92%,50%,0.25),inset_0_0_15px_hsl(38,92%,50%,0.05)]" : "",
      dotColor: londonActive ? "bg-amber-400" : "bg-white/20",
    },
    {
      name: "New York",
      hours: "9:30 AM – 4 PM ET",
      icon: <Building2 className="h-3.5 w-3.5" />,
      isActive: nyActive,
      color: "text-emerald-400",
      borderColor: nyActive ? "border-emerald-400/60" : "border-white/10",
      glowColor: nyActive ? "shadow-[0_0_15px_hsl(142,71%,45%,0.25),inset_0_0_15px_hsl(142,71%,45%,0.05)]" : "",
      dotColor: nyActive ? "bg-emerald-400" : "bg-white/20",
    },
  ];
}

const DashboardHeader = () => {
  const { profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const initial = firstName.charAt(0).toUpperCase();
  const [now, setNow] = useState(getETDate());

  useEffect(() => {
    const interval = setInterval(() => setNow(getETDate()), 1000);
    return () => clearInterval(interval);
  }, []);

  const market = useMemo(() => getMarketStatus(now), [now]);
  const countdown = useMemo(() => getCountdown(now), [now]);
  const sessions = useMemo(() => getSessions(now), [now]);
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

  return (
    <header className="shrink-0 overflow-visible relative z-20">
      <div className="h-14 glass-panel border-b border-border/60 flex items-center justify-between px-6 pl-14 lg:pl-6">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 ${market.isOpen ? "text-emerald-400" : "text-red-400"}`}>
            <span className={`relative flex h-2.5 w-2.5`}>
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${market.isOpen ? "bg-emerald-400" : "bg-red-500"}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${market.isOpen ? "bg-emerald-400" : "bg-red-500"}`} />
            </span>
            <span className="text-xs font-black tracking-[0.15em] uppercase">{market.label}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">{timeStr} ET</span>
        </div>

        <div className="flex items-center gap-4">
          <SignalAlerts />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">{initial}</span>
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-medium text-foreground">{firstName}</div>
              <div className="text-xs text-muted-foreground">Pro Member</div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative border-b border-border/40 bg-[hsl(232,30%,6%,0.9)] backdrop-blur-md">
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(270,60%,40%,0.04)] via-transparent to-[hsl(230,85%,60%,0.04)] pointer-events-none" />
        <div className="relative flex items-center justify-between px-6 pl-14 lg:pl-6 py-2.5">
          <div className="hidden md:flex items-center gap-1.5 text-right">
            <span className="text-[10px] text-muted-foreground font-medium">{market.nextEvent}</span>
            <span className="text-[10px] text-foreground font-bold">{market.nextTime}</span>
            <span className="text-[10px] text-muted-foreground ml-1 font-mono tabular-nums">{countdown}</span>
          </div>

          <div className="flex items-center gap-2.5 mx-auto md:mx-0">
            {sessions.map((s) => (
              <div
                key={s.name}
                className={`relative flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-all duration-500 ${s.borderColor} ${s.glowColor} ${
                  s.isActive ? "bg-white/[0.03]" : "bg-transparent"
                }`}
              >
                <div className={`flex items-center gap-1.5 ${s.isActive ? s.color : "text-muted-foreground"}`}>
                  {s.icon}
                  <span className={`text-[11px] font-bold ${s.isActive ? s.color : "text-muted-foreground"}`}>{s.name}</span>
                </div>
                <span className="text-[9px] text-muted-foreground font-medium hidden sm:inline">{s.hours}</span>
                <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${s.dotColor} ${s.isActive ? "animate-pulse" : ""}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
