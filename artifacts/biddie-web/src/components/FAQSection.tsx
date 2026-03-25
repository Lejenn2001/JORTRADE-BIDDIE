import { motion } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { useState } from "react";

const faqs = [
  {
    q: "How does JORTRADE find opportunities?",
    a: "Biddie uses AI to scan price action, volume, and liquidity patterns across futures, options, and stocks — then surfaces what's worth your attention.",
  },
  {
    q: "Does it tell me exactly what to trade?",
    a: "No — Biddie gives you the context and analysis. You always make the final call. Think of it as a smarter second opinion.",
  },
  {
    q: "Do I need trading experience?",
    a: "Not at all. Biddie simplifies complex data into plain-language guidance that anyone can act on.",
  },
  {
    q: "What markets are covered?",
    a: "NQ and ES futures, individual stocks, and options — with a focus on the highest-conviction setups.",
  },
  {
    q: "Can I chat with Biddie?",
    a: "Yes! Ask about any ticker, strategy, or setup and get a clear, conversational response in seconds.",
  },
];

const FAQSection = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="relative py-28">
      <div className="container mx-auto px-6 max-w-3xl">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-foreground text-center mb-12"
        >
          Frequently Asked Questions
        </motion.h2>

        <div className="space-y-0">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="border-b border-border"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between py-6 text-left group"
              >
                <span className="text-base md:text-lg font-semibold text-muted-foreground group-hover:text-foreground transition-colors pr-8">
                  {faq.q}
                </span>
                {openIndex === i ? (
                  <Minus className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                ) : (
                  <Plus className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                )}
              </button>
              {openIndex === i && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.3 }}
                  className="pb-6"
                >
                  <p className="text-muted-foreground text-sm leading-relaxed">{faq.a}</p>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQSection;
