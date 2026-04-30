import { build } from "esbuild";
const result = await build({
  entryPoints: ["src/lib/executionEvaluator.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const code = result.outputFiles[0].text;
const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const mod = await import(dataUrl);
const { evaluateSignal } = mod;

const cases = [
  { label: "Today's actual SPY signal (broken setup, inv > entry for call)", sig: { ticker:"SPY",option_type:"call",strike:695,expiry:"May 1, 2026",entry_trigger:"Near $695.00 (no VWAP data)",target:"$727.81",invalidation:"Below Pivot at $711.27" } },
  { label: "Clean SPY 0DTE call", sig: { ticker:"SPY",option_type:"call",strike:715,expiry:"2026-04-30",entry_trigger:"Above $713.50",target:"$717.00",invalidation:"Below $712.50" } },
  { label: "Clean QQQ put 1DTE", sig: { ticker:"QQQ",option_type:"put",strike:480,expiry:"2026-05-01",entry_trigger:"Below $482.00",target:"Near $478.00",invalidation:"Above $483.50" } },
  { label: "Clean SPXW 0DTE put", sig: { ticker:"SPXW",option_type:"put",strike:7100,expiry:"2026-04-30",entry_trigger:"Below $7125",target:"$7100",invalidation:"Above $7140" } },
  { label: "AAPL call (non-exec, clean)", sig: { ticker:"AAPL",option_type:"call",strike:220,expiry:"2026-05-15",entry_trigger:"Above $218.00",target:"$225.00",invalidation:"Below $216.00" } },
  { label: "TSLA 0DTE call (non-exec + 0DTE)", sig: { ticker:"TSLA",option_type:"call",strike:250,expiry:"2026-04-30",entry_trigger:"$248.50",target:"$252.00",invalidation:"$247.50" } },
  { label: "Expired NVDA put", sig: { ticker:"NVDA",option_type:"put",strike:110,expiry:"2026-04-15",entry_trigger:"$112.00",target:"$108.00",invalidation:"$113.50" } },
  { label: "SPY call poor R:R (0.4:1)", sig: { ticker:"SPY",option_type:"call",strike:715,expiry:"2026-05-02",entry_trigger:"$713.00",target:"$714.00",invalidation:"$710.50" } },
  { label: "SPY call broken (target<entry)", sig: { ticker:"SPY",option_type:"call",strike:715,expiry:"2026-05-02",entry_trigger:"$715.00",target:"$710.00",invalidation:"$712.00" } },
  { label: "SPY call missing entry", sig: { ticker:"SPY",option_type:"call",strike:715,expiry:"2026-05-02",target:"$720.00",invalidation:"$712.00" } },
  { label: "IWM call late move (mfe 82%)", sig: { ticker:"IWM",option_type:"call",strike:245,expiry:"2026-05-09",entry_trigger:"$243.00",target:"$248.00",invalidation:"$241.50",mfePercent:82 } },
  { label: "SPX call mid-move (mfe 60%)", sig: { ticker:"SPX",option_type:"call",strike:7140,expiry:"2026-05-02",entry_trigger:"$7130",target:"$7150",invalidation:"$7115",mfePercent:60 } },
  { label: "AMZN frontend camelCase (non-exec)", sig: { ticker:"AMZN",putCall:"call",strike:200,expiry:"2026-05-08",entryTrigger:"$198.50",targetZone:"$205",invalidation:"$197" } },
];

for (const c of cases) {
  const v = evaluateSignal(c.sig);
  const tag = v.verdict.toUpperCase().padEnd(13);
  console.log(`[${tag}] ${c.label}`);
  console.log(`               → ${v.reason}\n`);
}
