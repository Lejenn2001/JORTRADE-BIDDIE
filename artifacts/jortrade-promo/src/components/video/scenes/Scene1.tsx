import { motion } from 'framer-motion';
import jortradeLogo from '@assets/jortrade-logo.png';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.3 }
  },
  exit: { opacity: 0, transition: { duration: 0.5 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
};

export function Scene1() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-bg-dark"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[40vw] h-[40vw] bg-primary/20 rounded-full blur-[100px] opacity-50 mix-blend-screen" />
        <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] bg-secondary/20 rounded-full blur-[100px] opacity-50 mix-blend-screen" />
      </div>

      <motion.div variants={itemVariants} className="relative z-10 mb-[4vw]">
        <img 
          src={jortradeLogo} 
          alt="JORTRADE Logo" 
          className="h-[45vh] object-contain drop-shadow-[0_0_50px_rgba(88,101,242,0.6)]" 
        />
      </motion.div>

      <motion.h1 
        variants={itemVariants}
        className="text-[4vw] font-display font-bold text-center text-text-primary max-w-[80vw] tracking-tight leading-tight z-10"
      >
        Trade With <span className="text-primary">Confidence</span><br />
        Using Your AI Assistant
      </motion.h1>
    </motion.div>
  );
}
