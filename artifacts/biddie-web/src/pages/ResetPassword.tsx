import { motion } from "framer-motion";
import Disclaimer from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import jortradeLogo from "@/assets/jortrade-logo.png";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let resolved = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        resolved = true;
        setHasRecoverySession(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !resolved) {
        resolved = true;
        setHasRecoverySession(true);
      }
    });

    const timeout = setTimeout(() => {
      if (!resolved) setHasRecoverySession(false);
    }, 2500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated. Please sign in with your new password.");
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(230_70%_45%_/_0.2)_0%,transparent_60%)]" />
        <div className="absolute inset-[80px] rounded-full bg-[radial-gradient(circle,hsl(270_60%_40%_/_0.15)_0%,transparent_55%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="glass-panel rounded-2xl p-8 border-glow-blue">
          <div className="text-center mb-8">
            <img src={jortradeLogo} alt="JORTRADE" className="h-24 w-auto mx-auto mb-4" />
            <h1 className="text-3xl font-extrabold text-foreground mb-2">Set a new password</h1>
            <p className="text-muted-foreground text-sm">Enter your new password below.</p>
          </div>

          {hasRecoverySession === null && (
            <p className="text-sm text-center text-muted-foreground py-6">Verifying recovery link...</p>
          )}

          {hasRecoverySession === false && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This recovery link is invalid or has expired. Please request a new password reset email.
              </p>
              <Button
                onClick={() => navigate("/login")}
                className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold"
              >
                Back to sign in
              </Button>
            </div>
          )}

          {hasRecoverySession === true && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">New password</label>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  className="bg-muted/30 border-border/50 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm new password</label>
                <Input
                  type="password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="bg-muted/30 border-border/50 rounded-lg"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold mt-2"
              >
                {loading ? "Updating..." : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </motion.div>
      <div className="absolute bottom-0 left-0 right-0">
        <Disclaimer />
      </div>
    </div>
  );
};

export default ResetPassword;
