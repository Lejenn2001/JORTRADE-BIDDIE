import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

const terms = [
  { label: "S1 / S2", desc: "Support Level 1 & 2 — price levels where buying pressure may hold or reverse a decline" },
  { label: "R1 / R2", desc: "Resistance Level 1 & 2 — price levels where selling pressure may slow or reverse a rally" },
  { label: "VWAP", desc: "Volume-Weighted Average Price — the average price weighted by volume; a key intraday benchmark" },
  { label: "Pivot", desc: "Central pivot point calculated from prior day's high, low, and close" },
  { label: "Conviction Score", desc: "0–100 score measuring signal strength based on flow size, aggression, volume, and technical alignment" },
  { label: "Sweep", desc: "An aggressive order that hits multiple price levels simultaneously — signals urgency" },
  { label: "Vol/OI", desc: "Volume to Open Interest ratio — high values indicate fresh, new positioning rather than closing trades" },
  { label: "ATM", desc: "At-The-Money — the option strike is near the current stock price" },
];

const mfeColors = [
  { color: "bg-emerald-400", text: "text-emerald-400", label: "MFE 100%+", desc: "Price fully reached the target zone" },
  { color: "bg-blue-400", text: "text-blue-400", label: "MFE 50–99%", desc: "Price moved at least halfway to target" },
  { color: "bg-yellow-400", text: "text-yellow-400", label: "MFE 1–49%", desc: "Price moved toward target but less than halfway" },
  { color: "bg-red-400", text: "text-red-400", label: "MFE 0%", desc: "Price moved against the trade direction" },
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
            <p className="text-[10px] text-muted-foreground mb-2">How far the price moved toward the target zone after signal detection.</p>
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
