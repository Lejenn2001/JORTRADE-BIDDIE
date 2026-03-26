import { motion } from 'framer-motion';
import jortradeLogo from '@assets/jortrade-logo.png';
import jtIcon from '@assets/jt-icon-nobg.png';

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
        className="z-10 flex flex-col items-center"
      >
        <img 
          src={jtIcon} 
          alt="JT Icon" 
          className="w-[8vw] mb-[2vw] filter drop-shadow-[0_0_30px_rgba(88,101,242,0.8)] rounded-full"
        />
        
        <img 
          src={jortradeLogo} 
          alt="JORTRADE" 
          className="h-[8vw] mb-[4vw]"
        />

        <motion.h1 
          className="text-[4vw] font-display font-bold text-white mb-[3vw] tracking-tight leading-none text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.8 }}
        >
          Your Edge. <span className="text-primary">Your AI.</span><br />
          Your Trades.
        </motion.h1>

        <motion.div
          className="text-[2vw] font-mono text-text-primary border border-white/20 px-[3vw] py-[1vw] rounded-full bg-glass backdrop-blur-lg shadow-[0_0_20px_rgba(88,101,242,0.2)]"
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 2.2, type: "spring", stiffness: 300, damping: 20 }}
          whileHover={{ scale: 1.05 }}
        >
          jortrade.com
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
