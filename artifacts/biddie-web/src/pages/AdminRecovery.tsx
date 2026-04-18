import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import jortradeLogo from "@/assets/jortrade-logo.png";

const AdminRecovery = () => {
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !secret) {
      toast.error("Both fields are required");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/whale/admin-self-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), secret: secret.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || "Recovery request failed");
      } else {
        setSent(true);
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(0_70%_45%_/_0.18)_0%,transparent_60%)]" />
        <div className="absolute inset-[80px] rounded-full bg-[radial-gradient(circle,hsl(15_60%_40%_/_0.13)_0%,transparent_55%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="glass-panel rounded-2xl p-8 border border-red-500/20">
          <div className="text-center mb-6">
            <img src={jortradeLogo} alt="JORTRADE" className="h-20 w-auto mx-auto mb-3" />
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 mb-4">
              <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[10px] font-semibold tracking-widest text-red-300 uppercase">Break-Glass Recovery</span>
            </div>
            <h1 className="text-2xl font-extrabold text-foreground mb-2">Admin Self-Recovery</h1>
            <p className="text-sm text-muted-foreground">
              For locked-out admins only. Standard users should use{" "}
              <a href="/login" className="text-primary underline">Forgot Password</a> instead.
            </p>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30">
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
              <p className="text-sm text-foreground font-medium">Recovery link sent to Discord.</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Open your Discord channel, find the most recent message with a recovery link,
                click it, and set a new password. The link expires in ~1 hour and is single-use.
              </p>
              <Button
                onClick={() => { setSent(false); setEmail(""); setSecret(""); }}
                variant="outline"
                className="rounded-full border-border/50 text-xs"
              >
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/30 border border-border/40 p-4 mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Steps
                </p>
                <ol className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-decimal list-inside">
                  <li>Enter your admin email</li>
                  <li>Enter your recovery secret (saved during setup)</li>
                  <li>Click <span className="text-foreground font-medium">Send recovery link</span></li>
                  <li>Open Discord — your recovery link will be there</li>
                  <li>Click the link, set a new password, sign back in</li>
                </ol>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Admin email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                    placeholder="you@example.com"
                    className="bg-muted/30 border-border/50 rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Recovery secret</label>
                  <Input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    required
                    autoComplete="off"
                    placeholder="Long random string from setup"
                    className="bg-muted/30 border-border/50 rounded-lg font-mono text-xs"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-sm font-semibold"
                >
                  {submitting ? "Sending..." : "Send recovery link"}
                </Button>
              </form>

              <p className="text-[10px] text-center text-muted-foreground/70 mt-5 leading-relaxed">
                All attempts (success or failure) are logged to Discord.
                If you receive a Discord notification you didn't trigger, rotate your recovery secret immediately.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default AdminRecovery;
