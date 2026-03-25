import { useState } from "react";
import { motion } from "framer-motion";
import type { WhaleScoreResult } from "@/hooks/useMarketData";

interface Props {
  score: number;
  label: string;
  breakdown?: WhaleScoreResult["breakdown"];
  size?: "sm" | "md";
}

const getScoreColor = (score: number) => {
  if (score >= 90) return { stroke: "hsl(0 72% 51%)", glow: "hsl(0 72% 51% / 0.5)", text: "text-destructive", label: "Ultra" };
  if (score >= 75) return { stroke: "hsl(270 75% 60%)", glow: "hsl(270 75% 60% / 0.4)", text: "text-accent", label: "Very High" };
  if (score >= 60) return { stroke: "hsl(230 85% 60%)", glow: "hsl(230 85% 60% / 0.3)", text: "text-primary", label: "High" };
  return { stroke: "hsl(225 15% 50%)", glow: "hsl(225 15% 50% / 0.2)", text: "text-muted-foreground", label: "Moderate" };
};

const breakdownLabels: Record<string, string> = {
  size: "Size",
  aggression: "Aggression",
  urgency: "Urgency",
  strikeQuality: "Strike",
  newPositioning: "New Pos.",
  stacking: "Stacking",
  levelAlignment: "Level",
  penalties: "Penalties",
};

const breakdownMax: Record<string, number> = {
  size: 20,
  aggression: 15,
  urgency: 15,
  strikeQuality: 10,
  newPositioning: 15,
  stacking: 10,
  levelAlignment: 15,
  penalties: 20,
};

const ConvictionScoreRing = ({ score, label, breakdown, size = "sm" }: Props) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const colors = getScoreColor(score);
  const isSmall = size === "sm";
  const ringSize = isSmall ? 44 : 56;
  const strokeWidth = isSmall ? 3 : 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const isExtreme = score >= 90;

  const convictionLabel = score >= 95 ? "Ultra"
    : score >= 90 ? "Extreme"
    : score >= 80 ? "Very High"
    : score >= 70 ? "High"
    : score >= 60 ? "Elevated"
    : "Moderate";

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onMouseEnter={() => breakdown && setShowBreakdown(true)}
        onMouseLeave={() => setShowBreakdown(false)}
        onClick={() => breakdown && setShowBreakdown(!showBreakdown)}
      >
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          {/* Glow for extreme scores */}
          {isExtreme && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: `0 0 12px ${colors.glow}, 0 0 24px ${colors.glow}` }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <svg width={ringSize} height={ringSize} className="rotate-[-90deg]">
            {/* Background track */}
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke="hsl(232 25% 14%)"
              strokeWidth={strokeWidth}
            />
            {/* Score arc */}
            <motion.circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={colors.stroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: circumference - progress }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
              style={{ filter: isExtreme ? `drop-shadow(0 0 4px ${colors.glow})` : undefined }}
            />
          </svg>
          {/* Center score */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-bold ${isSmall ? "text-[11px]" : "text-sm"} ${colors.text}`}>{score}</span>
          </div>
        </div>
        <span className={`${isSmall ? "text-[9px]" : "text-[10px]"} font-semibold ${colors.text} whitespace-nowrap`}>
          {convictionLabel}
        </span>
      </div>

      {/* Breakdown tooltip */}
      {showBreakdown && breakdown && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="absolute right-0 top-full mt-2 z-50 glass-panel rounded-xl p-3 border border-border/60 min-w-[200px] shadow-xl"
        >
          <div className="text-[10px] font-bold text-foreground mb-2">Score Breakdown</div>
          <div className="space-y-1.5">
            {Object.entries(breakdown).map(([key, value]) => {
              const max = breakdownMax[key] || 20;
              const isPenalty = key === "penalties";
              const pct = isPenalty ? 0 : (value / max) * 100;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground w-14 shrink-0">{breakdownLabels[key]}</span>
                  <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                    {!isPenalty && (
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: colors.stroke }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                      />
                    )}
                  </div>
                  <span className={`text-[9px] font-bold w-8 text-right ${isPenalty && value > 0 ? "text-destructive" : colors.text}`}>
                    {isPenalty && value > 0 ? `-${value}` : value}/{max}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ConvictionScoreRing;
