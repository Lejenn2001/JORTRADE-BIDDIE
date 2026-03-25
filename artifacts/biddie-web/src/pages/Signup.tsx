import { motion } from "framer-motion";
import Disclaimer from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Check, Zap, Crown, Star, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

const plans = [
  {
    id: "starter",
    name: "Starter Trader",
    monthlyPrice: "$49",
    yearlyPrice: "$499",
    yearlySavings: "Save ~$90",
    badge: null,
    desc: "Perfect for new traders ready to gain an edge with AI-powered market intelligence.",
    icon: Star,
    features: [
      "30 AI searches per day",
      "Full AI dashboard access",
      "Real-time trade signals",
      "AI confidence scores",
      "Community access",
      "5-day free trial",
    ],
    highlight: false,
  },
  {
    id: "active",
    name: "Active Trader",
    monthlyPrice: "$89",
    yearlyPrice: "$899",
    yearlySavings: "Save ~$169",
    badge: "Most Popular",
    desc: "Built for serious traders who need deeper flow analysis and more daily insights.",
    icon: Zap,
    features: [
      "60 AI searches per day",
      "Full AI dashboard access",
      "Real-time trade signals",
      "AI confidence scores",
      "Priority signal delivery",
      "Community access",
      "5-day free trial",
    ],
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro Trader",
    monthlyPrice: "$129",
    yearlyPrice: "$1,199",
    yearlySavings: "Save ~$349",
    badge: "Power User",
    desc: "Maximum firepower for heavy flow traders and group leaders who demand the best.",
    icon: Crown,
    features: [
      "100 AI searches per day",
      "Full AI dashboard access",
      "Real-time trade signals",
      "AI confidence scores",
      "Priority signal delivery",
      "Advanced flow analytics",
      "Community access",
      "5-day free trial",
    ],
    highlight: false,
  },
];

const Signup = () => {
  const [selectedPlan, setSelectedPlan] = useState("active");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: window.location.origin,
      },
    });
    // Save selected plan and email to profile
    if (!error && signUpData?.user?.id) {
      await supabase.from("profiles").update({
        selected_plan: selectedPlan,
        email: email,
      }).eq("id", signUpData.user.id);
    }
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Check your email to confirm your account!");
      navigate("/login");
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse,hsl(230_70%_45%_/_0.15)_0%,transparent_60%)]" />
        <div className="absolute inset-[80px] bg-[radial-gradient(ellipse,hsl(270_60%_40%_/_0.12)_0%,transparent_55%)]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto">
        <Link to="/" className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          ← Back to Home
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4">
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground text-base max-w-lg mx-auto">
            Start with a 5-day free trial. No credit card required to explore.
          </p>
        </motion.div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`text-sm font-semibold px-4 py-2 rounded-full transition-all ${billingCycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle("yearly")}
            className={`text-sm font-semibold px-4 py-2 rounded-full transition-all ${billingCycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Yearly
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative glass-panel rounded-2xl p-6 cursor-pointer transition-all ${
                selectedPlan === plan.id
                  ? "border-primary/50 ring-2 ring-primary/20"
                  : "border-glow-blue hover:border-primary/30"
              } ${plan.highlight ? "md:-mt-4 md:mb-[-16px]" : ""}`}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-6 text-[10px] font-bold bg-primary text-primary-foreground px-3 py-1 rounded-full uppercase tracking-wider">
                  {plan.badge}
                </span>
              )}
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <plan.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-foreground font-bold text-lg mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-extrabold text-foreground">
                  {billingCycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}
                </span>
                <span className="text-sm text-muted-foreground">
                  {billingCycle === "monthly" ? "/mo" : "/yr"}
                </span>
              </div>
              {billingCycle === "yearly" && (
                <span className="text-[10px] font-semibold text-primary">{plan.yearlySavings}</span>
              )}
              <p className="text-muted-foreground text-xs mb-5 mt-2">{plan.desc}</p>
              <ul className="space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="max-w-md mx-auto"
        >
          <div className="glass-panel rounded-2xl p-8 border-glow-blue">
            <h2 className="text-xl font-bold text-foreground mb-6 text-center">Create Your Account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Full Name</label>
                <Input
                  placeholder="Jordan Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="bg-muted/30 border-border/50 rounded-lg"
                />
              </div>
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-muted/30 border-border/50 rounded-lg"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold mt-2"
              >
                {loading ? "Creating account..." : "Start 5-Day Free Trial"}
              </Button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/50" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">or sign up with</span></div>
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1 rounded-lg border-border/50" onClick={async () => {
                  const { error } = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
                  if (error) toast.error(error.message);
                }}>
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </Button>
                <Button type="button" variant="outline" className="flex-1 rounded-lg border-border/50" onClick={async () => {
                  const { error } = await lovable.auth.signInWithOAuth("apple", { redirect_uri: window.location.origin });
                  if (error) toast.error(error.message);
                }}>
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                  Apple
                </Button>
              </div>

              <p className="text-center text-[11px] text-muted-foreground mt-3">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
              </p>
            </form>
          </div>
        </motion.div>

        {/* Affiliate Link Button */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center mt-10"
        >
          <Button
            variant="outline"
            className="rounded-full border-border/50 px-6 gap-2 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => toast.info("Affiliate program coming soon!")}
          >
            <Link2 className="h-4 w-4" />
            Create Affiliate Link
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2">Earn commissions by referring traders</p>
        </motion.div>
      </div>
      <div className="mt-8 w-full">
        <Disclaimer />
      </div>
    </div>
  );
};

export default Signup;
