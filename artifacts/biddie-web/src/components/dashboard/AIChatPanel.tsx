import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Trash2, Lock, ArrowUpRight, Zap, Coins } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useQuestionLimit, CREDIT_PACKS } from "@/hooks/useQuestionLimit";
import ReactMarkdown from "react-markdown";
import biddieRobot from "@/assets/biddie-robot.png";
import { Link } from "react-router-dom";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const quickPrompts = [
  "What's the best setup for today?",
  "Any unusual options flow today?",
  "Show me high-confidence plays",
];

const greetings = [
  (name: string) => `Hey ${name}! Biddie is watching the flow. Things are heating up.`,
  (name: string) => `Markets are moving ${name}. Let's find the edge.`,
  (name: string) => `Hey ${name}! Let's scan the markets and see what's cooking.`,
  (name: string) => `What's good ${name}? The whales are active today.`,
];

const AIChatPanel = () => {
  const { profile } = useAuth();
  const { canAsk, hasAccess, remaining, limit, increment, plan, credits, usingCredits, dailyLimitHit, addCredits } = useQuestionLimit();
  const [showCreditStore, setShowCreditStore] = useState(false);
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [greeting] = useState(() => greetings[Math.floor(Math.random() * greetings.length)](firstName));
  const userId = profile?.id || 'anon';
  const storageKey = `biddie-chat-messages-${userId}`;

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved) as Message[];
      }
    } catch {}
    return [];
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      const toSave = messages.slice(-500);
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    }
  }, [messages, storageKey]);

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(storageKey);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    if (!canAsk) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: timeStr,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);

    try {
      const lower = text.trim().toLowerCase();
      const isTradeEntry = /\b(i just (entered|bought|sold|opened|took)|i('m| am) (in|holding|long|short)|my position|i have a)\b/.test(lower);
      
      let instruction: string;
      if (isTradeEntry) {
        instruction = `[TRADE ADVISOR MODE] The user just told you about a trade they entered. Give a detailed analysis: check gamma levels, support/resistance alignment, VWAP positioning, and whether their direction is correct. Recommend entry/exit adjustments, stop loss, and profit targets. Be thorough here — this is their money.\n\nUser says: ${text.trim()}`;
      } else {
        instruction = `[DASHBOARD CHAT MODE] Keep your response to 3-4 sentences max. Be conversational and helpful but concise. No long breakdowns unless the user specifically asks for detail.\n\nUser says: ${text.trim()}`;
      }

      const history = updatedMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/whale/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: instruction, history, userName: firstName }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      increment();

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: "assistant",
        content: data?.analysis || data?.reply || "I couldn't generate a response. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      console.error('AI chat error:', e);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (!hasAccess) {
    return (
      <div className="glass-panel rounded-xl border-glow-purple flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Biddie AI</span>
          </div>
          <span className="text-xs bg-muted/50 text-muted-foreground px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Locked
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full border-2 border-muted/30 overflow-hidden mb-4 opacity-40 grayscale">
            <img src={biddieRobot} alt="Biddie" className="w-full h-full object-cover object-top scale-150" />
          </div>
          <h3 className="text-foreground font-semibold text-sm mb-2">Upgrade to talk to Biddie</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-[220px]">
            Active Trader and above get live access to Biddie AI and the JORTRADE chat room.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/20 text-primary px-4 py-2 rounded-lg hover:bg-primary/30 transition-colors"
          >
            Upgrade Plan
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl border-glow-purple flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Biddie AI</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {usingCredits ? (
              <span className="flex items-center gap-1"><Coins className="h-2.5 w-2.5 text-amber-400" />{credits} credits</span>
            ) : (
              <>{remaining}/{limit} left today{credits > 0 && <span className="text-amber-400 ml-1">+{credits}</span>}</>
            )}
          </span>
          <span className="text-xs bg-primary/20 text-primary px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Online
          </span>
          {messages.length > 0 && (
            <button onClick={clearChat} className="p-1 rounded hover:bg-destructive/20 transition-colors" title="Clear chat">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full border-2 border-indigo-500/30 overflow-hidden mx-auto mb-3 shadow-[0_0_15px_hsl(230_85%_60%_/_0.3)]">
              <img src={biddieRobot} alt="Biddie" className="w-full h-full object-cover object-top scale-150" />
            </div>
            <p className="text-sm text-foreground font-medium">{greeting}</p>
            <p className="text-xs text-muted-foreground mt-2">Powered by JORTRADE</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded-lg p-3 ${
              msg.role === "assistant"
                ? "bg-primary/5 border border-primary/10"
                : "bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {msg.role === "assistant" ? (
                <Bot className="h-3 w-3 text-primary" />
              ) : (
                <User className="h-3 w-3 text-accent" />
              )}
              <span className={`text-xs font-bold ${msg.role === "assistant" ? "text-primary" : "text-accent"}`}>
                {msg.role === "assistant" ? "Biddie" : "You"}
              </span>
              <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
            </div>
            {msg.role === "assistant" ? (
              <div className="prose prose-sm prose-invert max-w-none text-foreground [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-2 [&_li]:text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_strong]:text-primary [&_h1]:text-primary [&_h2]:text-primary [&_h3]:text-foreground [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mb-2 [&_h2]:mb-1 [&_h3]:mb-1 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:mb-0.5">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-foreground whitespace-pre-line">{msg.content}</p>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Biddie is analyzing...
          </div>
        )}
      </div>

      {messages.length === 0 && canAsk && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {quickPrompts.map((q) => (
              <button
                key={q}
                className="text-[10px] bg-muted/50 text-muted-foreground px-2.5 py-1 rounded-full border border-border hover:border-primary/40 transition-colors"
                onClick={() => sendMessage(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {!canAsk && hasAccess && (
        <div className="px-4 pb-2">
          {!showCreditStore ? (
            <div className="text-center py-3 bg-muted/30 rounded-lg border border-border/40">
              <p className="text-xs text-muted-foreground mb-2">Daily limit reached ({limit} questions)</p>
              <div className="flex items-center justify-center gap-2">
                {plan !== "pro" && (
                  <Link
                    to="/signup"
                    className="text-[10px] font-medium bg-primary/20 text-primary px-3 py-1.5 rounded-lg hover:bg-primary/30 transition-colors inline-flex items-center gap-1"
                  >
                    <ArrowUpRight className="h-2.5 w-2.5" /> Upgrade Plan
                  </Link>
                )}
                <button
                  onClick={() => setShowCreditStore(true)}
                  className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors inline-flex items-center gap-1"
                >
                  <Coins className="h-2.5 w-2.5" /> Buy Credits
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-2">Daily questions reset at midnight</p>
            </div>
          ) : (
            <div className="bg-muted/30 rounded-lg border border-amber-500/30 p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-foreground">Question Credits</span>
                </div>
                <button
                  onClick={() => setShowCreditStore(false)}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-3">Credits never expire and work after your daily limit runs out.</p>
              <div className="space-y-1.5">
                {CREDIT_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => {
                      addCredits(pack.credits);
                      setShowCreditStore(false);
                    }}
                    className="w-full flex items-center justify-between bg-background/50 border border-border/40 rounded-lg px-3 py-2 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group"
                  >
                    <div className="flex items-center gap-2">
                      <Coins className="h-3 w-3 text-amber-400" />
                      <span className="text-xs font-medium text-foreground">{pack.label}</span>
                    </div>
                    <span className="text-xs font-bold text-amber-400 group-hover:text-amber-300">{pack.price}</span>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground/50 mt-2 text-center">Payment coming soon — credits granted instantly for now</p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-3 border-t border-border/40">
        <div className="flex items-center gap-2">
          <Input
            data-chat-input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canAsk ? "Ask Biddie anything..." : "Daily limit reached"}
            className="bg-muted/30 border-border/50 rounded-lg text-sm flex-1"
            disabled={isLoading || !canAsk}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !canAsk}
            className="bg-primary/20 text-primary rounded-lg p-2.5 hover:bg-primary/30 transition-colors shrink-0 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default AIChatPanel;
