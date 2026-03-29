import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotificationSettings from "@/components/dashboard/NotificationSettings";

const DashboardSettings = () => {
  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
            <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
              {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
                const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
                const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
                const green = i % 3 !== 0;
                return (
                  <g key={i}>
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#94a3b8" : "#64748b"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#94a3b8" : "#64748b"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/15 via-transparent to-slate-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

            <div className="relative px-6 py-7">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-slate-400 to-slate-600" />
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                    SETTINGS
                  </h1>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400/80 font-semibold mt-0.5">
                    Preferences & Configuration
                  </p>
                </div>
              </div>
            </div>
          </div>
          <NotificationSettings />
        </main>
      </div>
    </div>
  );
};

export default DashboardSettings;
