import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";

import { useAuth } from "@/hooks/useAuth";
import MarketPulse from "@/components/dashboard/MarketPulse";
import { HelpCircle, X, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import biddieRobot from "@/assets/biddie-robot.png";

const Dashboard = () => {
  const { user, profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";

  const welcomeKey = user?.id ? `biddie_welcomed_${user.id}` : null;
  const isFirstTime = welcomeKey ? !localStorage.getItem(welcomeKey) : false;
  const sessionDismissKey = user?.id ? `biddie_session_${user.id}` : null;
  const [showWelcome, setShowWelcome] = useState(() => {
    if (!welcomeKey) return false;
    if (isFirstTime) return true;
    if (sessionDismissKey && sessionStorage.getItem(sessionDismissKey)) return false;
    return true;
  });
  const dismissWelcome = () => {
    setShowWelcome(false);
    if (isFirstTime && welcomeKey) localStorage.setItem(welcomeKey, "true");
    if (sessionDismissKey) sessionStorage.setItem(sessionDismissKey, "true");
  };

  useEffect(() => {
    if (showWelcome && !isFirstTime) {
      const timer = setTimeout(() => {
        dismissWelcome();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showWelcome, isFirstTime]);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <TickerTape />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
            <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 1000 200" preserveAspectRatio="none">
              {[40, 95, 150, 205, 260, 315, 370, 425, 480, 535, 590, 645, 700, 755, 810, 865, 920].map((x, i) => {
                const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45, 70, 55];
                const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85, 50, 75];
                const green = i % 3 !== 0;
                return (
                  <g key={i}>
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#818cf8" : "#a78bfa"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#818cf8" : "#a78bfa"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-900/15 via-purple-900/8 to-cyan-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-[hsl(232,30%,7%)]/30 to-transparent" />

            <div className="relative px-6 py-7 lg:py-8">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-10 rounded-full bg-gradient-to-b from-[hsl(var(--glow-blue))] via-[hsl(var(--glow-purple))] to-[hsl(var(--glow-cyan))]" />
                  <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
                      DASHBOARD
                    </h1>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--glow-blue))]/80 font-semibold mt-0.5">
                      Flow · Insight · Execution
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <MarketStatusSign />

          <AnimatePresence>
            {showWelcome && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/60 via-[hsl(232,30%,10%)] to-purple-950/40"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent" />
                <button
                  onClick={dismissWelcome}
                  className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/10 transition-colors z-10"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
                {isFirstTime ? (
                  <div className="relative flex flex-col items-center text-center px-5 py-5 gap-3">
                    <img src={biddieRobot} alt="Biddie" className="w-14 h-14 rounded-full border-2 border-indigo-500/30 shadow-lg shadow-indigo-500/10" />
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-indigo-400" />
                      <span className="text-sm font-bold text-foreground">Welcome to JORTRADE, {firstName}!</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                      Great to have you! This dashboard is filled with goodies. Real-time whale flow, AI signals, alerts, and so much more.
                      Take your time and look around, there's a lot to explore.
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                      Beginners, hover over the{" "}
                      <span className="inline-flex items-center gap-0.5 align-middle">
                        <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
                      </span>
                      {" "}icons next to signals for quick tips that explain everything in plain English. I'm here to help you learn and grow!
                    </p>
                    <button
                      onClick={dismissWelcome}
                      className="mt-1 px-5 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-sm font-bold text-indigo-300 hover:text-indigo-200 transition-all uppercase tracking-wider"
                    >
                      Got it, let's trade!
                    </button>
                  </div>
                ) : (
                  <div className="relative flex items-center px-5 py-4 gap-4">
                    <img src={biddieRobot} alt="Biddie" className="w-10 h-10 rounded-full border-2 border-indigo-500/30 shadow-lg shadow-indigo-500/10" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        <span className="text-sm font-bold text-foreground">Welcome back, {firstName}!</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Let's get it today. Your signals and plays are ready.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <MarketPulse />

          <div className="grid grid-cols-1 gap-4 lg:gap-6">
            <div className="max-h-[600px]">
              <AIChatPanel />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
