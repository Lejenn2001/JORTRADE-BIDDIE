import { AlertTriangle } from "lucide-react";

const Disclaimer = () => (
  <section className="py-10 px-6 border-t border-border/30 bg-muted/5">
    <div className="container mx-auto max-w-3xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            JORTRADE is an AI-powered market insight engine designed to help traders identify potential opportunities using data analysis and probabilistic models. All information provided is for educational and informational purposes only and should not be considered financial, investment, or trading advice.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Trading options and financial instruments involves significant risk and may not be suitable for all investors. You are solely responsible for your trading decisions and any resulting profits or losses. Always conduct your own research and consult with a licensed financial professional before making investment decisions.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            By using JORTRADE, you acknowledge that all tools, alerts, signals, and analysis are provided "as-is" and are used entirely at your own risk.
          </p>
        </div>
      </div>
    </div>
  </section>
);

export default Disclaimer;
