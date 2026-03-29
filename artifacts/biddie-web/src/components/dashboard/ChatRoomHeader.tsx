import { useState, useEffect } from "react";
import { Users, Clock, MapPin } from "lucide-react";
import { useWeather, getBiddieOutfit } from "@/hooks/useWeather";
import { motion } from "framer-motion";
import biddieRobot from "@/assets/biddie-robot.png";

const QUOTES = [
  "The stock market is a device for transferring money from the impatient to the patient.",
  "Risk comes from not knowing what you're doing.",
  "Be fearful when others are greedy, greedy when others are fearful.",
  "The trend is your friend until it bends at the end.",
  "Cut your losses short and let your winners run.",
  "Plan your trade and trade your plan.",
  "In trading, the impossible happens about twice a year.",
  "Markets can stay irrational longer than you can stay solvent.",
  "Don't try to catch a falling knife.",
  "The best trade is the one you don't take.",
  "Discipline is the bridge between goals and accomplishment.",
  "Every master was once a disaster.",
  "Stay hungry. Stay humble. Stay in the game.",
  "The money is made in the waiting.",
];

interface ChatRoomHeaderProps {
  onlineCount: number;
  firstName: string;
}

const ChatRoomHeader = ({ onlineCount, firstName }: ChatRoomHeaderProps) => {
  const { weather } = useWeather();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const biddieOutfit = weather ? getBiddieOutfit(weather.condition) : "looking fresh 🤖";

  return (
    <div className="space-y-2 lg:space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
        <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
          {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
            const heights = [55, 40, 70, 30, 65, 80, 45, 60, 35, 75, 50, 68, 25, 55, 40];
            const tops = [75, 90, 55, 100, 65, 35, 85, 70, 95, 50, 80, 60, 105, 75, 90];
            const green = i % 3 !== 0;
            return (
              <g key={i}>
                <line x1={x} y1={tops[i] - 12} x2={x} y2={tops[i] + heights[i] + 12} stroke={green ? "hsl(230,85%,60%)" : "hsl(270,75%,60%)"} strokeWidth="1" />
                <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "hsl(230,85%,60%)" : "hsl(270,75%,60%)"} rx="1" />
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/15 via-transparent to-purple-900/12" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

        <div className="relative px-6 py-7 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-blue-400 to-purple-500" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                JORTRADE CHAT
              </h1>
              <p className="text-[10px] uppercase tracking-[0.3em] text-blue-400/80 font-semibold mt-0.5">
                Talk Trades · Share Setups · Build Together
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <Users className="h-3 w-3 text-emerald-400" />
              <span className="text-[10px] font-semibold text-emerald-400">{onlineCount} online</span>
            </div>
            <div className="hidden md:block text-right">
              <p className="text-[10px] text-muted-foreground">Welcome back</p>
              <p className="text-xs font-semibold text-foreground">{firstName} 👋</p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-2 lg:p-3 border-glow-blue flex items-center gap-3 lg:gap-4">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="flex-shrink-0"
        >
          <img
            src={biddieRobot}
            alt="Biddie"
            className="w-10 h-10 lg:w-16 lg:h-16 object-contain drop-shadow-[0_0_12px_hsl(230_85%_60%_/_0.4)]"
          />
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[11px] lg:text-xs font-semibold text-primary">Biddie AI</p>
          </div>
          <p className="text-[10px] lg:text-xs text-muted-foreground/80 italic truncate">"{quote}"</p>
        </div>
      </div>
    </div>
  );
};

export default ChatRoomHeader;
