import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const MentorshipSection = () => {
  return (
    <section className="relative py-28 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse,hsl(270_60%_35%_/_0.15)_0%,transparent_60%)]" />
        <div className="absolute inset-[80px] bg-[radial-gradient(ellipse,hsl(230_70%_45%_/_0.1)_0%,transparent_55%)]" />
      </div>

      <div className="container mx-auto px-6 relative z-10 text-center max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <span className="inline-block text-xs font-semibold text-foreground border border-muted-foreground/30 rounded-full px-4 py-1.5 mb-8">
            Mentorship
          </span>

          <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-[1.1] mb-6">
            Need a Human Edge?
            <br />
            <span className="text-primary">We've Got You.</span>
          </h2>

          <p className="text-muted-foreground text-base leading-relaxed mb-8 max-w-lg mx-auto">
            Biddie handles the data — but sometimes you need a real mentor in your corner.
            Get direct access to experienced traders who'll help you level up faster.
          </p>

          <Link to="/contact">
            <Button className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-6 text-base font-semibold">
              Inquire About Mentorship
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
};

export default MentorshipSection;
