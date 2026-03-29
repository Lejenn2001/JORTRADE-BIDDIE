import { useEffect, useState } from "react";
import { Clock, Sun, Moon, Sunrise } from "lucide-react";

interface SessionInfo {
  name: string;
  icon: typeof Clock;
  color: string;
  bgColor: string;
  borderColor: string;
  hours: string;
  active: boolean;
}

function getActiveSessions(): SessionInfo[] {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const t = utcH * 60 + utcM;

  const asia: SessionInfo = {
    name: "Asia",
    icon: Moon,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    hours: "7 PM – 4 AM ET",
    active: t >= 0 && t < 480 || t >= 1380,
  };

  const london: SessionInfo = {
    name: "London",
    icon: Sunrise,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    hours: "3 AM – 12 PM ET",
    active: t >= 480 && t < 1020,
  };

  const ny: SessionInfo = {
    name: "New York",
    icon: Sun,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    hours: "9:30 AM – 4 PM ET",
    active: t >= 810 && t < 1260,
  };

  return [asia, london, ny];
}

function getETTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const SessionBanner = () => {
  const [sessions, setSessions] = useState(getActiveSessions);
  const [etTime, setEtTime] = useState(getETTime);

  useEffect(() => {
    const interval = setInterval(() => {
      setSessions(getActiveSessions());
      setEtTime(getETTime());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const activeSessions = sessions.filter(s => s.active);
  const inactiveSessions = sessions.filter(s => !s.active);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
        <Clock className="h-3.5 w-3.5" />
        <span className="font-medium">{etTime} ET</span>
      </div>

      {activeSessions.map(s => {
        const Icon = s.icon;
        return (
          <div
            key={s.name}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${s.bgColor} ${s.borderColor}`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${s.color.replace("text-", "bg-")}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${s.color.replace("text-", "bg-")}`} />
            </span>
            <Icon className={`h-3.5 w-3.5 ${s.color}`} />
            <span className={`text-xs font-semibold ${s.color}`}>{s.name}</span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">({s.hours})</span>
          </div>
        );
      })}

      {inactiveSessions.map(s => {
        const Icon = s.icon;
        return (
          <div
            key={s.name}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/40 opacity-40"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{s.name}</span>
          </div>
        );
      })}
    </div>
  );
};

export default SessionBanner;
