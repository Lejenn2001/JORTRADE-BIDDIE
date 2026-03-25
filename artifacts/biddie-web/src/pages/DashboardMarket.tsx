import { useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MarketChartPanel from "@/components/dashboard/MarketChartPanel";
import { TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

const sectors = [
  { name: "Technology", change: 1.42, tickers: ["AAPL", "MSFT", "NVDA", "META", "GOOGL"] },
  { name: "Financials", change: 0.67, tickers: ["JPM", "BAC", "GS", "MS", "C"] },
  { name: "Healthcare", change: -0.31, tickers: ["UNH", "JNJ", "PFE", "ABBV", "MRK"] },
  { name: "Energy", change: -1.12, tickers: ["XOM", "CVX", "COP", "SLB", "EOG"] },
  { name: "Consumer", change: 0.89, tickers: ["AMZN", "TSLA", "HD", "NKE", "SBUX"] },
  { name: "Industrials", change: 0.23, tickers: ["CAT", "BA", "UPS", "HON", "GE"] },
];

const indices = [
  { name: "SPX", value: "5,967.20", change: "+0.42%", up: true },
  { name: "NDX", value: "21,384.50", change: "+0.68%", up: true },
  { name: "DJI", value: "43,891.30", change: "+0.15%", up: true },
  { name: "RUT", value: "2,284.10", change: "-0.22%", up: false },
  { name: "VIX", value: "14.82", change: "-3.10%", up: false },
];

const DashboardMarket = () => {
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto space-y-5 p-3 sm:p-4 lg:p-6">
          {/* Header */}
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold text-foreground">Market View</h1>
            <p className="text-sm text-muted-foreground">Full market overview with sector breakdown</p>
          </div>

          {/* Indices strip */}
          <div className="flex gap-3 overflow-x-auto pb-1">
            {indices.map((idx) => (
              <div key={idx.name} className="glass-panel min-w-[132px] shrink-0 rounded-xl px-3 py-3 sm:min-w-[140px] sm:px-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{idx.name}</p>
                <p className="text-lg font-extrabold text-foreground">{idx.value}</p>
                <p className={`text-xs font-bold flex items-center gap-1 ${idx.up ? "text-emerald-400" : "text-red-400"}`}>
                  {idx.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {idx.change}
                </p>
              </div>
            ))}
          </div>

          {/* Main Chart */}
          <div className="min-h-[520px] sm:min-h-0 sm:h-[400px]">
            <MarketChartPanel />
          </div>

          {/* Sector Heatmap */}
          <div className="glass-panel rounded-xl border-glow-purple p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">Sector Performance</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {sectors.map((sector) => (
                <button
                  key={sector.name}
                  onClick={() => setSelectedSector(selectedSector === sector.name ? null : sector.name)}
                  className={`rounded-xl border p-3 text-left transition-all sm:p-4 ${
                    selectedSector === sector.name ? "ring-2 ring-primary/50" : ""
                  } ${
                    sector.change >= 1
                      ? "bg-emerald-500/15 border-emerald-500/30"
                      : sector.change >= 0
                      ? "bg-emerald-500/8 border-emerald-500/20"
                      : sector.change >= -0.5
                      ? "bg-red-500/8 border-red-500/20"
                      : "bg-red-500/15 border-red-500/30"
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground mb-1">{sector.name}</p>
                  <p className={`text-lg font-extrabold ${sector.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sector.change >= 0 ? "+" : ""}{sector.change}%
                  </p>
                </button>
              ))}
            </div>

            {/* Selected sector tickers */}
            {selectedSector && (
              <div className="mt-4 pt-4 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2">
                  Top tickers in <span className="text-foreground font-semibold">{selectedSector}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {sectors
                    .find((s) => s.name === selectedSector)
                    ?.tickers.map((t) => {
                      const change = (Math.random() * 4 - 1).toFixed(2);
                      const up = parseFloat(change) >= 0;
                      return (
                        <div key={t} className="glass-panel rounded-lg px-3 py-2 flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground">{t}</span>
                          <span className={`text-[10px] font-bold ${up ? "text-emerald-400" : "text-red-400"}`}>
                            {up ? "+" : ""}{change}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardMarket;
