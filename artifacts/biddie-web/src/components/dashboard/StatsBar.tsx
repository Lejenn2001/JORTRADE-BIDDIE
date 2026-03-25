import { TrendingUp, Activity, Target, BarChart3 } from "lucide-react";
import type { MarketSignal } from "@/hooks/useMarketData";

interface Props {
  signals: MarketSignal[];
  marketOverview: any;
}

const StatsBar = ({ signals, marketOverview }: Props) => {
  const avgConfidence = signals.length > 0
    ? (signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length).toFixed(1)
    : "—";

  const bullishCount = signals.filter((s) => s.type === "bullish").length;
  const bearishCount = signals.filter((s) => s.type === "bearish").length;
  const sentiment = bullishCount > bearishCount ? "Bullish" : bearishCount > bullishCount ? "Bearish" : "Neutral";

  const stats = [
    { label: "Market Sentiment", value: sentiment, icon: TrendingUp, color: sentiment === "Bullish" ? "text-primary" : sentiment === "Bearish" ? "text-destructive" : "text-muted-foreground" },
    { label: "Active Signals", value: String(signals.length), icon: Activity, color: "text-primary" },
    { label: "Avg Confidence", value: avgConfidence, icon: Target, color: "text-accent" },
    { label: "Whale Alerts", value: marketOverview ? "Live" : "—", icon: BarChart3, color: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="glass-panel rounded-xl p-4 border-glow-blue flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <stat.icon className={`h-5 w-5 ${stat.color}`} />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</div>
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatsBar;
