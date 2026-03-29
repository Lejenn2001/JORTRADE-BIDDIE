import { useState, useRef, useEffect, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  content: ReactNode;
  size?: "sm" | "md";
  maxWidth?: number;
}

const BeginnerTooltip = ({ content, size = "sm", maxWidth = 280 }: Props) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState<"above" | "below">("above");
  const [hAlign, setHAlign] = useState<"center" | "right" | "left">("center");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPosition(rect.top < 200 ? "below" : "above");

      const spaceRight = window.innerWidth - rect.right;
      const spaceLeft = rect.left;
      const half = maxWidth / 2;

      if (spaceRight < half + 16) {
        setHAlign("right");
      } else if (spaceLeft < half + 16) {
        setHAlign("left");
      } else {
        setHAlign("center");
      }
    }
  }, [show, maxWidth]);

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  const hAlignClass =
    hAlign === "right"
      ? "right-0"
      : hAlign === "left"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(!show)}
    >
      <HelpCircle className={`${iconSize} text-indigo-400/60 hover:text-indigo-400 transition-colors cursor-help shrink-0`} />
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: position === "above" ? 4 : -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: position === "above" ? 4 : -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 ${
              position === "above"
                ? "bottom-full mb-2"
                : "top-full mt-2"
            } ${hAlignClass}`}
            style={{ width: maxWidth }}
          >
            <div className="bg-[hsl(232,28%,12%)] border border-indigo-500/20 rounded-lg px-3 py-2 shadow-xl shadow-black/40">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">Beginner Tip</span>
              </div>
              <div className="text-[10px] text-foreground/80 leading-relaxed">{content}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BeginnerTooltip;
