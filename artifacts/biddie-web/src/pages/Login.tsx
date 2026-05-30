import { motion } from "framer-motion";
import Disclaimer from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import jortradeLogo from "@/assets/jortrade-logo.png";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/dashboard");
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Enter your email above first");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setResetSent(true);
    }
  };

  const exitResetMode = () => {
    setResetMode(false);
    setResetSent(false);
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
            <h1 className="text-3xl font-extrabold text-foreground mb-2">Welcome Back</h1>
            <p className="text-muted-foreground text-sm">Sign in to access your dashboard</p>
          </div>

          {resetMode ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={resetSent}
                  className="bg-muted/30 border-border/50 rounded-lg"
                />
              </div>
              {resetSent ? (
                <p className="text-sm text-center text-muted-foreground py-3 px-2 leading-relaxed">
                  If an account exists for <span className="text-foreground font-medium">{email}</span>, a password reset link is on its way. Check your inbox (and spam folder).
                </p>
              ) : (
                <Button
                  onClick={handleResetRequest}
                  disabled={loading}
                  className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold"
                >
                  {loading ? "Sending..." : "Send reset email"}
                </Button>
              )}
              <button
                type="button"
                onClick={exitResetMode}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-muted/30 border-border/50 rounded-lg"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Password</label>
                    <button
                      type="button"
                      onClick={() => setResetMode(true)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-muted/30 border-border/50 rounded-lg"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold mt-2"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary hover:underline font-medium">Sign up</Link>
          </p>

          <Link to="/" className="block text-center text-xs text-muted-foreground mt-4 hover:text-foreground transition-colors">
            ← Back to Home
          </Link>
        </div>
      </motion.div>
      <div className="absolute bottom-0 left-0 right-0">
        <Disclaimer />
      </div>
    </div>
  );
};

export default Login;
