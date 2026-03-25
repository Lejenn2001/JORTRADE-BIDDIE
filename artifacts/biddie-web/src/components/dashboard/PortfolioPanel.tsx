import { useState } from "react";
import { Fish, ArrowUpRight, ArrowDownRight, Clock, ChevronDown, ChevronUp, Info, Copy, Repeat2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { FlowAlert } from "@/hooks/useMarketData";
import { toast } from "sonner";

interface Props {
  whaleAlerts: FlowAlert[];
  loading: boolean;
  limit?: number;
}

function getActionLabel(alert: FlowAlert): string {
  return alert.sentiment === "bullish"
    ? `Buy ${alert.strike} Calls`
    : `Buy ${alert.strike} Puts`;
}

function getScoreColor(score: number): string {
  if (score >= 90) return "text-destructive";
  if (score >= 75) return "text-accent";
  if (score >= 60) return "text-primary";
  if (score >= 40) return "text-muted-foreground";
  return "text-muted-foreground/60";
}

function getScoreBorderColor(score: number): string {
  if (score >= 90) return "border-destructive";
  if (score >= 75) return "border-accent";
  if (score >= 60) return "border-primary";
  return "border-muted-foreground/40";
}

function getScoreBadge(score: number): string {
  if (score >= 90) return "🔥 EXTREME";
  if (score >= 75) return "⚡ VERY HIGH";
  if (score >= 60) return "📊 HIGH";
  if (score >= 40) return "MODERATE";
  return "LOW";
}

const PortfolioPanel = ({ whaleAlerts, loading, limit }: Props) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const allAlerts = whaleAlerts.slice(0, 8);
  const displayAlerts = limit ? allAlerts.slice(0, limit) : allAlerts;

  const bullishPremium = allAlerts
    .filter((a) => a.sentiment === "bullish")
    .reduce((sum, a) => sum + parsePremium(a.premium), 0);
  const bearishPremium = allAlerts
    .filter((a) => a.sentiment === "bearish")
    .reduce((sum, a) => sum + parsePremium(a.premium), 0);

  const avgConviction = allAlerts.length > 0
    ? Math.round(allAlerts.reduce((sum, a) => sum + (a.convictionScore || 50), 0) / allAlerts.length)
    : 0;

  return (
    <div className="glass-panel rounded-xl p-5 border-glow-blue">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Fish className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Whale Activity</span>
        </div>
        <span className="text-xs bg-primary/20 text-primary px-2.5 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Live
        </span>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Bullish Flow", value: `$${formatMoney(bullishPremium)}`, color: "text-primary" },
          { label: "Bearish Flow", value: `$${formatMoney(bearishPremium)}`, color: "text-destructive" },
          { label: "Avg Conviction", value: `${avgConviction}/100`, color: getScoreColor(avgConviction) },
        ].map((s) => (
          <div key={s.label} className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
            <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {loading && whaleAlerts.length === 0 && displayAlerts.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 bg-muted/20 rounded-lg animate-pulse h-14" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {displayAlerts.map((alert, i) => {
            const score = alert.convictionScore || 50;
            const isHighConviction = score >= 60;
            const isExpanded = expandedIdx === i;
            const explanation = alert.explanation || '';

            return (
              <div
                key={`${alert.ticker}-${i}`}
                className={`rounded-lg border transition-all ${
                  score >= 75
                    ? alert.sentiment === "bullish"
                      ? "bg-primary/5 border-primary/30"
                      : "bg-destructive/5 border-destructive/30"
                    : "bg-muted/20 border-transparent"
                }`}
              >
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      {/* Conviction score circle */}
                      <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center ${getScoreBorderColor(score)}`}>
                        <span className={`text-xs font-bold ${getScoreColor(score)}`}>{score}</span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          {alert.ticker}
                          {score >= 75 && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold animate-pulse ${
                              score >= 90
                                ? "bg-destructive/20 text-destructive"
                                : "bg-accent/20 text-accent"
                            }`}>
                              {getScoreBadge(score)}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{alert.type}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold flex items-center gap-1 ${
                        alert.sentiment === "bullish" ? "text-primary" : "text-destructive"
                      }`}>
                        {alert.sentiment === "bullish"
                          ? <ArrowUpRight className="h-3 w-3" />
                          : <ArrowDownRight className="h-3 w-3" />}
                        {alert.premium}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span>{alert.strike} strike • {alert.expiry}</span>
                      {alert.gammaLevelLabel && (
                        <span className="text-accent font-semibold">• {alert.gammaLevelLabel}</span>
                      )}
                    </div>
                    <button
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors cursor-pointer ${
                        alert.sentiment === "bullish"
                          ? "bg-primary/15 text-primary hover:bg-primary/25"
                          : "bg-destructive/15 text-destructive hover:bg-destructive/25"
                      }`}
                    >
                      {getActionLabel(alert)}
                      {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                    </button>
                  </div>

                  <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-2.5 w-2.5" />
                    {alert.time}
                  </div>
                </div>

                {/* Expandable explanation */}
                {isExpanded && (
                  <div className={`px-3 pb-3 border-t ${
                    alert.sentiment === "bullish" ? "border-primary/20" : "border-destructive/20"
                  }`}>
                    <div className="flex items-start gap-2 mt-2.5">
                      <Info className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                        alert.sentiment === "bullish" ? "text-primary" : "text-destructive"
                      }`} />
                      <div className="flex-1">
                        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
                          alert.sentiment === "bullish" ? "text-primary" : "text-destructive"
                        }`}>
                          Why this trade? — {alert.convictionLabel || getScoreBadge(score)}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          {explanation}
                        </p>

                        {/* Budget-friendly alternative */}
                        {getAlternative(alert) && (
                          <div className="bg-muted/30 rounded-lg p-2.5 mb-3 border border-border/30">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Repeat2 className="h-3 w-3 text-accent" />
                              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
                                Budget-Friendly Alternative
                              </span>
                            </div>
                            <p className="text-xs text-foreground font-semibold">
                              {getAlternative(alert)}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Same directional exposure at a fraction of the cost
                            </p>
                          </div>
                        )}

                        {/* Copy Trade button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const tradeText = `${getActionLabel(alert)} — ${alert.ticker} ${alert.strike} ${alert.sentiment === "bullish" ? "Calls" : "Puts"} exp ${alert.expiry} | Conviction: ${score}/100${getAlternative(alert) ? ` | Alt: ${getAlternative(alert)}` : ""}`;
                            navigator.clipboard.writeText(tradeText);
                            toast.success("Trade copied to clipboard!");
                          }}
                          className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-colors ${
                            alert.sentiment === "bullish"
                              ? "bg-primary/20 text-primary hover:bg-primary/30"
                              : "bg-destructive/20 text-destructive hover:bg-destructive/30"
                          }`}
                        >
                          <Copy className="h-3 w-3" />
                          Copy Trade
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {limit && allAlerts.length > limit && (
        <Link to="/dashboard/signals" className="block mt-3 text-center text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
          View All {allAlerts.length} Whale Alerts →
        </Link>
      )}
    </div>
  );
};

// Map expensive tickers to budget-friendly alternatives
const alternativesMap: Record<string, (strike: string, sentiment: string) => string | null> = {
  SPX: (strike, sentiment) => {
    const spxPrice = parseFloat(strike.replace('$', ''));
    const spyEquiv = Math.round(spxPrice / 10);
    return `Buy SPY $${spyEquiv} ${sentiment === "bullish" ? "Calls" : "Puts"} — SPY tracks SPX at ~1/10th the price`;
  },
  SPXW: (strike, sentiment) => alternativesMap.SPX(strike, sentiment),
  NDX: (strike, sentiment) => {
    const ndxPrice = parseFloat(strike.replace('$', ''));
    const qqqEquiv = Math.round(ndxPrice / 40);
    return `Buy QQQ $${qqqEquiv} ${sentiment === "bullish" ? "Calls" : "Puts"} — QQQ tracks Nasdaq-100 at ~1/40th the price`;
  },
  NQ: (strike, sentiment) => alternativesMap.NDX(strike, sentiment),
};

function getAlternative(alert: FlowAlert): string | null {
  const ticker = alert.ticker.replace(/W$/, '');
  const mapFn = alternativesMap[alert.ticker] || alternativesMap[ticker];
  if (mapFn) return mapFn(alert.strike, alert.sentiment);
  return null;
}

function parsePremium(str: string): number {
  const clean = str.replace(/[$,]/g, '');
  if (clean.endsWith('M')) return parseFloat(clean) * 1_000_000;
  if (clean.endsWith('K')) return parseFloat(clean) * 1_000;
  return parseFloat(clean) || 0;
}

function formatMoney(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
}

export default PortfolioPanel;
