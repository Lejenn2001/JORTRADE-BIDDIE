import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Bot, Users, GraduationCap, UserCheck, ArrowRight, BarChart3, Brain, Globe, Shield } from "lucide-react";

const products = [
  {
    icon: Bot,
    title: "BIDDIE AI",
    subtitle: "AI Trading Intelligence",
    description: "Institutional-grade AI assistant that scans 1,000+ setups daily, surfaces high-conviction flow, and translates complex market data into clear, actionable guidance.",
    link: "/biddieai",
    cta: "Get Started",
    accent: "from-[hsl(var(--glow-blue))] to-[hsl(var(--glow-purple))]",
    glowColor: "hsl(var(--glow-blue) / 0.15)",
  },
  {
    icon: Users,
    title: "JORTRADE Community",
    subtitle: "Live Trading Network",
    description: "Connect with active traders in real-time. Share setups, discuss flow, and collaborate on market analysis in a focused, signal-driven environment.",
    link: "#",
    cta: "Coming Soon",
    accent: "from-[hsl(var(--glow-purple))] to-[hsl(var(--accent))]",
    glowColor: "hsl(var(--glow-purple) / 0.15)",
    disabled: true,
  },
  {
    icon: GraduationCap,
    title: "JORTRADE Academy",
    subtitle: "Structured Education",
    description: "Master market structure, options flow, and institutional trading concepts through structured courses designed for serious traders.",
    link: "#",
    cta: "Coming Soon",
    accent: "from-[hsl(var(--glow-cyan))] to-[hsl(var(--glow-blue))]",
    glowColor: "hsl(var(--glow-cyan) / 0.15)",
    disabled: true,
  },
  {
    icon: UserCheck,
    title: "Mentorship",
    subtitle: "Live Coaching & Strategy",
    description: "One-on-one and group coaching sessions with experienced traders. Get personalized strategy development and real-time trade review.",
    link: "#",
    cta: "Coming Soon",
    accent: "from-[hsl(var(--warning))] to-[hsl(var(--glow-purple))]",
    glowColor: "hsl(38 92% 50% / 0.15)",
    disabled: true,
  },
];

const pillars = [
  { icon: BarChart3, label: "Liquidity Analysis" },
  { icon: Brain, label: "Sentiment & Positioning" },
  { icon: Globe, label: "Market Intelligence" },
  { icon: Shield, label: "Probability Edge" },
];

const Ecosystem = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 md:py-5 glass-panel border-b border-border/40"
      >
        <span className="font-display text-lg font-bold text-foreground tracking-[0.2em]">JORTRADE</span>
        <div className="flex items-center gap-4 md:gap-6 text-sm">
          <Link to="/biddieai" className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline">Biddie AI</Link>
          <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline">Contact</Link>
          <Link to="/login">
            <Button size="sm" variant="ghost" className="rounded-full px-4 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Log In
            </Button>
          </Link>
          <Link to="/signup">
            <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 text-xs font-semibold">
              Sign Up
            </Button>
          </Link>
        </div>
      </motion.nav>

      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden pt-20">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px]">
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(230_85%_40%_/_0.2)_0%,transparent_50%)]" />
          <div className="absolute inset-[100px] rounded-full bg-[radial-gradient(circle,hsl(270_75%_40%_/_0.15)_0%,transparent_50%)]" />
        </div>

        <div className="relative z-10 text-center px-6 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 border border-border/60 rounded-full px-5 py-2 mb-10"
          >
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--success))] animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground tracking-wide">THE ECOSYSTEM IS LIVE</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-5xl md:text-7xl lg:text-8xl font-extrabold leading-[1.02] tracking-tight text-foreground mb-8"
          >
            JORTRADE
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-muted-foreground text-lg md:text-xl max-w-3xl mx-auto leading-relaxed mb-12"
          >
            An institutional-style market intelligence ecosystem built to help traders
            understand <span className="text-foreground font-medium">liquidity</span>, <span className="text-foreground font-medium">positioning</span>, <span className="text-foreground font-medium">sentiment</span>, and <span className="text-foreground font-medium">probability</span>.
          </motion.p>

          {/* Pillar badges */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="flex flex-wrap justify-center gap-3 mb-14"
          >
            {pillars.map((p, i) => (
              <div key={i} className="flex items-center gap-2 bg-secondary/60 border border-border/40 rounded-full px-4 py-2">
                <p.icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-secondary-foreground">{p.label}</span>
              </div>
            ))}
          </motion.div>

        </div>
      </section>

      {/* Products Section */}
      <section className="py-28 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <span className="inline-block text-xs font-semibold text-foreground border border-muted-foreground/30 rounded-full px-4 py-1.5 mb-6">
              The Ecosystem
            </span>
            <h2 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4">
              Built for Serious Traders
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-base">
              Every product in the JORTRADE ecosystem is designed to give you an edge — from AI-driven signals to live mentorship.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {products.map((product, i) => (
              <motion.div
                key={product.title}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                {product.disabled ? (
                  <div className="group relative h-full rounded-2xl border border-border/40 bg-card p-8 overflow-hidden opacity-70">
                    <div className="absolute inset-0 rounded-2xl" style={{ background: `radial-gradient(ellipse at top left, ${product.glowColor}, transparent 60%)` }} />
                    <div className="relative">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${product.accent} flex items-center justify-center mb-5 opacity-50`}>
                        <product.icon className="h-6 w-6 text-foreground" />
                      </div>
                      <h3 className="font-display text-xl font-bold text-foreground tracking-wide mb-1">{product.title}</h3>
                      <p className="text-sm text-primary font-medium mb-3">{product.subtitle}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-6">{product.description}</p>
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                        {product.cta}
                      </span>
                    </div>
                  </div>
                ) : (
                  <Link to={product.link} className="group relative h-full rounded-2xl border border-border/40 bg-card p-8 overflow-hidden block hover:border-primary/30 transition-colors">
                    <div className="absolute inset-0 rounded-2xl" style={{ background: `radial-gradient(ellipse at top left, ${product.glowColor}, transparent 60%)` }} />
                    <div className="relative">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${product.accent} flex items-center justify-center mb-5`}>
                        <product.icon className="h-6 w-6 text-foreground" />
                      </div>
                      <h3 className="font-display text-xl font-bold text-foreground tracking-wide mb-1">{product.title}</h3>
                      <p className="text-sm text-primary font-medium mb-3">{product.subtitle}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-6">{product.description}</p>
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground group-hover:gap-3 transition-all">
                        {product.cta}
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 py-12">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-display text-sm font-bold text-foreground tracking-[0.15em]">JORTRADE</span>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <Link to="/biddieai" className="hover:text-foreground transition-colors">Biddie AI</Link>
            <Link to="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link to="/login" className="hover:text-foreground transition-colors">Login</Link>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} JORTRADE. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Ecosystem;
