import { motion } from 'framer-motion';

const signals = [
  { ticker: 'NVDA', type: 'CALL', price: '142.50', target: '146.00', score: 98, tag: 'ACT NOW', color: 'text-success', bg: 'bg-success/20' },
  { ticker: 'TSLA', type: 'PUT', price: '185.20', target: '175.00', score: 85, tag: 'HIGH CONVICTION', color: 'text-warning', bg: 'bg-warning/20' },
  { ticker: 'AAPL', type: 'CALL', price: '172.10', target: '175.50', score: 92, tag: 'PRICE CONFIRMED', color: 'text-success', bg: 'bg-success/20' },
];

export function Scene3() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-bg-dark px-[4vw]"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-bg-dark to-bg-dark pointer-events-none" />
      
      <motion.div 
        className="text-[6vw] font-display font-bold mb-[5vh] text-white z-10 tracking-tight text-center"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Real-Time <span className="text-primary">Actionable</span> Signals
      </motion.div>

      <div className="flex flex-col gap-[3vh] z-10 w-full">
        {signals.map((sig, i) => (
          <motion.div
            key={sig.ticker}
            className="w-full bg-bg-muted/80 border border-white/10 rounded-xl p-[5vw] bg-glass flex flex-col relative overflow-hidden"
            initial={{ opacity: 0, x: 80, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.3, type: "spring", damping: 20 }}
          >
            <div className={`absolute top-0 left-0 w-full h-[0.8vw] ${sig.bg.replace('/20', '')}`} />
            
            <div className="flex justify-between items-center mb-[2vw]">
              <h3 className="text-[7vw] font-bold font-mono text-white tracking-tight">{sig.ticker}</h3>
              <motion.span 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1 + i * 0.3, type: "spring" }}
                className={`px-[2.5vw] py-[1vw] text-[2.5vw] font-bold rounded-md border border-current ${sig.color} ${sig.bg} uppercase tracking-wider`}
              >
                {sig.tag}
              </motion.span>
            </div>
            
            <div className="flex items-end gap-[2vw] mb-[3vw]">
              <div className="text-[10vw] font-bold text-white leading-none tracking-tighter">{sig.score}%</div>
              <div className="text-[3vw] text-text-muted mb-[1vw] font-medium">Win Rate</div>
            </div>

            <div className="grid grid-cols-2 gap-[3vw] border-t border-white/10 pt-[3vw]">
              <div>
                <div className="text-[2.5vw] text-text-muted font-medium mb-[0.5vw]">Entry {sig.type}</div>
                <div className="text-[4vw] font-mono text-white font-bold">${sig.price}</div>
              </div>
              <div>
                <div className="text-[2.5vw] text-text-muted font-medium mb-[0.5vw]">Target</div>
                <div className="text-[4vw] font-mono text-success font-bold">${sig.target}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
