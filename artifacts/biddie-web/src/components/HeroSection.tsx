import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import biddieRobot from "@/assets/biddie-robot.png";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Radial glow background */}
      <div className="absolute inset-0 bg-background" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px]">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(270_75%_40%_/_0.4)_0%,transparent_60%)]" />
        <div className="absolute inset-[60px] rounded-full bg-[radial-gradient(circle,hsl(30_80%_40%_/_0.35)_0%,transparent_55%)]" />
        <div className="absolute inset-[140px] rounded-full bg-[radial-gradient(circle,hsl(300_60%_50%_/_0.25)_0%,transparent_50%)]" />
        <div className="absolute inset-[200px] rounded-full bg-[radial-gradient(circle,hsl(40_70%_45%_/_0.2)_0%,transparent_45%)]" />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(230_25%_5%_/_0.7)_0%,transparent_35%)]" />
      </div>

      {/* Nav */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-end px-6 md:px-8 py-4 md:py-6 gap-3 glass-panel border-b border-border/40 border-t-0 border-l-0 border-r-0"
      >
        {/* Mobile: just Log In + Sign Up */}
        <div className="flex md:hidden items-center gap-3">
          <Link to="/login">
            <Button size="sm" variant="ghost" className="rounded-full px-4 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Log In
            </Button>
          </Link>
          <Link to="/signup">
            <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-4 text-xs font-semibold">
              Sign Up
            </Button>
          </Link>
        </div>

        {/* Desktop: full nav */}
        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors">Features</span>
          <Link to="/dashboard" className="hover:text-foreground cursor-pointer transition-colors">Dashboard</Link>
          <Link to="/signup" className="hover:text-foreground cursor-pointer transition-colors">Pricing</Link>
          <Link to="/contact" className="hover:text-foreground cursor-pointer transition-colors">Contact</Link>
          <Link to="/login">
            <Button size="sm" variant="ghost" className="rounded-full px-5 text-xs font-semibold text-muted-foreground hover:text-foreground">
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

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto pt-28 md:pt-24">


        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight text-foreground"
        >
          Trade With Confidence
          <br />
          Using Your AI Assistant
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-muted-foreground mt-6 max-w-2xl mx-auto text-base md:text-lg leading-relaxed"
        >
          JORTRADE helps traders spot opportunities, understand market conditions, and
          make more structured trading decisions with AI guidance.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="flex justify-center mt-10"
        >
          <Link to="/dashboard">
            <Button variant="outline" className="rounded-full px-8 py-6 text-base font-semibold border-muted-foreground/30 hover:bg-muted/30">
              Go to Dashboard
            </Button>
          </Link>
        </motion.div>

        {/* Biddie Robot */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
          className="mt-12"
        >
          <img
            src={biddieRobot}
            alt="Biddie - AI Trading Assistant"
            className="w-40 h-40 md:w-56 md:h-56 mx-auto drop-shadow-[0_0_30px_hsl(230_85%_60%_/_0.4)]"
          />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3 }}
            className="mt-3 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-xs text-primary font-medium inline-block"
          >
            👋 Meet Biddie, your AI trading assistant
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
