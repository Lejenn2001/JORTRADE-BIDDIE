import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

const terms = [
  { label: "S1 / S2", desc: "Support floors — think of these like trampolines for the price. When price falls to these levels, it often bounces back up!" },
  { label: "R1 / R2", desc: "Resistance ceilings — like a ceiling the price keeps bumping its head on. Price often slows down or turns around here." },
  { label: "VWAP", desc: "The \"fair price\" for the day — it's the average price weighted by how much was traded. If price is above VWAP, buyers are winning. Below? Sellers are winning." },
  { label: "Pivot", desc: "The middle point — calculated from yesterday's high, low, and close. Think of it like the center of a seesaw. Price above = bullish, below = bearish." },
  { label: "Conviction Score", desc: "A score from 0–100 that tells you how strong a signal is. Like a report card for the trade — the higher the grade, the more confident we are!" },
  { label: "Sweep", desc: "When a big trader is in such a hurry they buy from every store at once! It means someone with a LOT of money wants in (or out) RIGHT NOW." },
  { label: "Vol/OI", desc: "Compares today's trading to existing bets. A high number means fresh new bets are being placed — not just old ones closing. New bets = someone knows something!" },
  { label: "ATM", desc: "At-The-Money — the option's strike price is right near where the stock is trading now. These are the most popular and active options." },
];

const mfeColors = [
  { color: "bg-emerald-400", text: "text-emerald-400", label: "MFE 100%+", desc: "The price made it all the way to the target — home run!" },
  { color: "bg-blue-400", text: "text-blue-400", label: "MFE 50–99%", desc: "More than halfway to the target — solid move!" },
  { color: "bg-yellow-400", text: "text-yellow-400", label: "MFE 1–49%", desc: "Moved in the right direction but didn't get far" },
  { color: "bg-red-400", text: "text-red-400", label: "MFE 0%", desc: "Went the wrong way — the trade moved against us" },
];

const SignalLegend = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-muted/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5" />
          Signal Terms Guide
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {terms.map((t) => (
              <div key={t.label} className="text-[11px] leading-snug">
                <span className="font-semibold text-primary">{t.label}</span>
                <span className="text-muted-foreground"> — {t.desc}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-muted/30 pt-2.5">
            <p className="text-[11px] font-semibold text-foreground mb-1.5">MFE (Max Favorable Excursion)</p>
            <p className="text-[10px] text-muted-foreground mb-2">After we spot a signal, how far did the price actually move toward the target? Think of it like measuring how close a ball got to the goal.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {mfeColors.map((m) => (
                <div key={m.label} className="flex items-center gap-1.5 text-[10px]">
                  <span className={`w-2 h-2 rounded-full ${m.color} shrink-0`} />
                  <span>
                    <span className={`font-semibold ${m.text}`}>{m.label}</span>
                    <span className="text-muted-foreground block leading-tight">{m.desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignalLegend;
