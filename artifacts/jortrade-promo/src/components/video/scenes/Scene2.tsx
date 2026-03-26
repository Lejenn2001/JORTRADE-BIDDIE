import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import biddieRobot from '@assets/biddie-robot.png';

export function Scene2() {
  const [typedText, setTypedText] = useState("");
  const fullText = "NVDA flow is heavily bullish. Spotted aggressive call sweeps at 145C expiring this Friday.\n\nTotal premium: $2.1M\nAsk Aggression: 94%\n\nKey levels:\nEntry trigger: > 142.50\nTarget: 146.00\nStop: 140.00";

  useEffect(() => {
    setTypedText("");
    let i = 0;
    const startDelay = setTimeout(() => {
      const intervalId = setInterval(() => {
        setTypedText(fullText.substring(0, i));
        i++;
        if (i > fullText.length) {
          clearInterval(intervalId);
        }
      }, 30);
      return () => clearInterval(intervalId);
    }, 2000);

    return () => clearTimeout(startDelay);
  }, [fullText]);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-bg-dark"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-bg-dark to-bg-dark pointer-events-none" />

      <div className="w-[60vw] bg-bg-muted/50 rounded-2xl border border-white/10 p-[2vw] flex flex-col gap-[2vw] shadow-2xl relative overflow-hidden bg-glass z-10">
        
        {/* User Message */}
        <motion.div 
          className="flex gap-[1.5vw] items-start self-end max-w-[80%]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, type: "spring" }}
        >
          <div className="bg-primary/20 text-text-primary px-[1.5vw] py-[1vw] rounded-2xl rounded-tr-none border border-primary/30">
            <p className="text-[1.2vw] font-body">What's the flow on NVDA today?</p>
          </div>
          <div className="w-[3vw] h-[3vw] rounded-full bg-primary flex items-center justify-center text-[1.2vw] font-bold shrink-0">
            U
          </div>
        </motion.div>

        {/* AI Message */}
        <motion.div 
          className="flex gap-[1.5vw] items-start self-start max-w-[90%]"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 1.5, type: "spring" }}
        >
          <div className="w-[4vw] h-[4vw] rounded-full bg-bg-light border border-white/10 overflow-hidden shrink-0 flex items-center justify-center glow-primary">
            <img src={biddieRobot} alt="Biddie AI" className="w-[80%] h-[80%] object-contain" />
          </div>
          <div className="bg-bg-light/80 text-text-secondary px-[1.5vw] py-[1vw] rounded-2xl rounded-tl-none border border-white/5 min-w-[20vw] min-h-[5vw]">
            <p className="text-[1.2vw] font-body whitespace-pre-wrap leading-relaxed">
              {typedText}
              <motion.span 
                animate={{ opacity: [0, 1, 0] }} 
                transition={{ repeat: Infinity, duration: 0.8 }}
                className="inline-block w-[0.5vw] h-[1.2vw] bg-primary ml-[0.5vw] align-middle"
              />
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
