import { motion } from 'framer-motion';
import biddieLeaning from '@assets/biddie-leaning.png';

const messages = [
  { user: "TraderDan", time: "10:23 AM", text: "SPY holding that 510 support perfectly." },
  { user: "AlphaSeeker", time: "10:24 AM", text: "Looking for an entry on META here." },
  { user: "Biddie AI", time: "10:24 AM", text: "🚨 ALERT: Just spotted $NVDA 145C sweep, $380K premium, 92% ask aggression. Negative gamma zone — this could run. Entry > 142.50.", isAlert: true },
  { user: "OptionsWhale", time: "10:25 AM", text: "Followed the AI on that NVDA play, already up 15%!" },
];

export function Scene4() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-end bg-bg-dark overflow-hidden px-[4vw] pb-[6vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.img 
          src={biddieLeaning} 
          alt="Biddie" 
          className="absolute left-[-5vw] top-[2vh] w-[50vw] h-[40vh] object-contain object-left-top filter drop-shadow-[0_0_30px_rgba(88,101,242,0.6)]"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 1, type: "spring", bounce: 0.3 }}
        />
      </div>

      <motion.h2 
        className="text-[3.5vw] font-display font-bold text-white mb-[2vh] tracking-tight text-center z-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        Live Community & <span className="text-primary">Alerts</span>
      </motion.h2>

      <div className="w-full flex flex-col gap-[1.5vh] z-10">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            className={`p-[2.5vw] rounded-xl border relative overflow-hidden bg-glass backdrop-blur-md ${msg.isAlert ? 'border-primary/50 shadow-[0_0_30px_rgba(88,101,242,0.3)]' : 'border-white/5'}`}
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.8 + i * 0.6, type: "spring", stiffness: 200, damping: 20 }}
          >
            {msg.isAlert && (
              <div className="absolute inset-0 bg-primary/10 animate-pulse pointer-events-none" />
            )}
            <div className="flex items-center gap-[1.5vw] mb-[1vw] relative z-10">
              <span className={`font-bold text-[1.8vw] ${msg.isAlert ? 'text-primary' : 'text-text-secondary'}`}>
                {msg.user}
              </span>
              <span className="text-[1.3vw] text-text-muted">{msg.time}</span>
              {msg.isAlert && (
                <span className="ml-auto px-[1.2vw] py-[0.5vw] bg-error/20 text-error text-[1.1vw] rounded-md font-bold uppercase tracking-wider border border-error/30">
                  AI Alert
                </span>
              )}
            </div>
            <p className={`text-[1.6vw] font-body ${msg.isAlert ? 'text-white font-medium' : 'text-text-primary/80'} leading-relaxed relative z-10`}>
              {msg.text}
            </p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
