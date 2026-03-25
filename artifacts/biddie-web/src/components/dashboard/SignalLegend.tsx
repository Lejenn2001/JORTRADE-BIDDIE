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
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {terms.map((t) => (
            <div key={t.label} className="text-[11px] leading-snug">
              <span className="font-semibold text-primary">{t.label}</span>
              <span className="text-muted-foreground"> — {t.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SignalLegend;
