import { useState, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  content: ReactNode;
  size?: "sm" | "md";
  maxWidth?: number;
}

const BeginnerTooltip = ({ content, size = "sm", maxWidth = 280 }: Props) => {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, direction: "above" as "above" | "below" });
  const ref = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  const calcPosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceAbove > spaceBelow ? "above" : "below";

    let left = rect.left + rect.width / 2 - maxWidth / 2;
    if (left < 8) left = 8;
    if (left + maxWidth > window.innerWidth - 8) left = window.innerWidth - maxWidth - 8;

    const top = direction === "above" ? rect.top - 8 : rect.bottom + 8;

    setCoords({ top, left, direction });
  }, [maxWidth]);

  const handleShow = () => {
    clearTimeout(hideTimeout.current);
    calcPosition();
    setShow(true);
  };

  const handleHide = () => {
    hideTimeout.current = setTimeout(() => setShow(false), 150);
  };

  const handleClick = () => {
    if (show) {
      setShow(false);
    } else {
      handleShow();
    }
  };

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <>
      <div
        ref={ref}
        className="relative inline-flex"
        onMouseEnter={handleShow}
        onMouseLeave={handleHide}
        onClick={handleClick}
      >
        <HelpCircle className={`${iconSize} text-indigo-400/60 hover:text-indigo-400 transition-colors cursor-help shrink-0`} />
      </div>
      {createPortal(
        <AnimatePresence>
          {show && (
            <motion.div
              initial={{ opacity: 0, y: coords.direction === "above" ? 4 : -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: coords.direction === "above" ? 4 : -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="fixed z-[9999] pointer-events-auto"
              style={{
                top: coords.direction === "above" ? undefined : coords.top,
                bottom: coords.direction === "above" ? window.innerHeight - coords.top : undefined,
                left: coords.left,
                width: maxWidth,
              }}
              onMouseEnter={() => clearTimeout(hideTimeout.current)}
              onMouseLeave={handleHide}
            >
              <div className="bg-[hsl(232,28%,12%)] border border-indigo-500/20 rounded-lg px-3 py-2 shadow-xl shadow-black/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">Beginner Tip</span>
                </div>
                <div className="text-[10px] text-foreground/80 leading-relaxed">{content}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default BeginnerTooltip;
