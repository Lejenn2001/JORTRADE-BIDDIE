import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t border-border py-10 bg-background">
      <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <Link to="/" className="font-display text-sm font-bold tracking-wider text-foreground hover:text-primary transition-colors">JORTRADE</Link>
        <p className="text-xs text-muted-foreground">© 2026 JORTRADE. All rights reserved.</p>
        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors">Privacy</span>
          <span className="hover:text-foreground cursor-pointer transition-colors">Terms</span>
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
