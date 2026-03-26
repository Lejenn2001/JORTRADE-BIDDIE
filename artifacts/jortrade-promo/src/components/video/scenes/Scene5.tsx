import { motion } from 'framer-motion';
import jortradeLogo from '@assets/jortrade-logo.png';

export function Scene5() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-bg-dark overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div 
        className="absolute inset-0 bg-primary/10 pointer-events-none mix-blend-screen"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 2, opacity: 1 }}
        transition={{ duration: 3, ease: "easeOut" }}
      />
      
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/20 via-bg-dark to-bg-dark pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.5, duration: 1, type: "spring", bounce: 0.4 }}
        className="z-10 flex flex-col items-center px-[6vw]"
      >
        <img 
          src={jortradeLogo} 
          alt="JORTRADE" 
          className="h-[30vh] mb-[5vh] drop-shadow-[0_0_60px_rgba(88,101,242,0.6)]"
        />

        <motion.h1 
          className="text-[7vw] font-display font-bold text-white mb-[4vh] tracking-tight leading-tight text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.8 }}
        >
          Your Edge. <span className="text-primary">Your AI.</span><br />
          Your Trades.
        </motion.h1>

        <motion.div
          className="text-[5vw] font-mono text-text-primary border border-white/20 px-[8vw] py-[2.5vw] rounded-full bg-glass backdrop-blur-lg shadow-[0_0_20px_rgba(88,101,242,0.2)]"
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 2.2, type: "spring", stiffness: 300, damping: 20 }}
        >
          jortrade.com
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
