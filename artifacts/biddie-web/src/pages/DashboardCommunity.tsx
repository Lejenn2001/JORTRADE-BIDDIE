import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Bot } from "lucide-react";
import biddieRobot from "@/assets/biddie-robot.png";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import ChatRoomHeader from "@/components/dashboard/ChatRoomHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

const BIDDIE_USER_ID = "00000000-0000-0000-0000-000000000000";

const DashboardCommunity = () => {
  const { session, profile, isAdmin } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  };

  // Load initial messages
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) {
        setMessages(data as ChatMessage[]);
        scrollToBottom();
      }
    };
    load();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("community-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          scrollToBottom();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        (payload) => {
          const deletedId = (payload.old as any).id;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && session?.user?.id) {
          await channel.track({ user_id: session.user.id, name: firstName });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, firstName]);

  const triggerBiddie = async (userMessage: string) => {
    try {
      // Prepend instruction for concise community chat responses
      const chatInstruction = `[COMMUNITY CHAT MODE] Keep your response SHORT — 2-3 sentences max. Only give a full detailed breakdown if you see a high-confidence alert (8+/10). For casual greetings, just be friendly and brief. For trading questions, give the #1 best play only with ticker, direction, and confidence. No long lists.\n\nUser says: ${userMessage}`;
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { message: chatInstruction, postToChat: true },
      });
      if (error) {
        console.error("Biddie edge function error:", error);
      }
    } catch (e) {
      console.error("Biddie API error:", e);
    }
  };

  const sendMessage = async () => {
    if (!session?.user?.id) {
      toast({ title: "Please log in", description: "You need to be signed in to send messages.", variant: "destructive" });
      return;
    }
    if (!input.trim() || sending) return;
    const messageText = input.trim();
    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      user_id: session.user.id,
      user_name: profile?.full_name || "Trader",
      content: messageText,
    } as any);
    if (error) {
      toast({ title: "Error sending message", description: error.message, variant: "destructive" });
    } else {
      setInput("");
      const lower = messageText.toLowerCase();
      const hasBiddieMention = lower.includes("biddie") || lower.includes("@biddie");
      const tradingKeywords = [
        "what's the play", "whats the play", "what is the play",
        "best setup", "any plays", "what's pumping", "whats pumping",
        "options flow", "unusual flow", "whale", "signal",
        "calls or puts", "bull or bear", "bullish or bearish",
        "spy", "qqq", "iwm", "nvda", "amd", "tsla", "aapl", "googl", "amzn", "meta",
        "put spread", "call spread", "debit spread", "credit spread",
        "what should i buy", "what should i trade", "any setups",
        "is it bussin", "what's cooking", "whats cooking",
        "momentum", "breakout", "breakdown", "entry", "strike",
        "expir", "premium", "sweep", "gamma", "vwap",
        "support", "resistance", "pivot", "target",
        "what do you think about", "should i", "would you", "is it time",
      ];
      const isTradingQuestion = tradingKeywords.some(kw => lower.includes(kw));
      
      // Only trigger once — Biddie mention OR trading question, not both
      if (hasBiddieMention || isTradingQuestion) {
        const cleanMsg = messageText.replace(/@?biddie[,:]?\s*/i, "").trim() || messageText;
        triggerBiddie(cleanMsg);
      }
    }
    setSending(false);
  };

  const deleteMessage = async (id: string) => {
    await supabase.from("chat_messages").delete().eq("id", id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const userColor = (userId: string) => {
    if (userId === BIDDIE_USER_ID) return "text-primary";
    const colors = [
      "text-blue-400", "text-emerald-400", "text-purple-400",
      "text-amber-400", "text-pink-400", "text-cyan-400",
      "text-orange-400", "text-lime-400",
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 flex flex-col overflow-hidden p-1.5 sm:p-2 lg:p-3 bg-mesh">
          {/* Compact Header — hidden on very small screens */}
          <div className="mb-1.5 sm:mb-2 shrink-0 hidden sm:block">
            <ChatRoomHeader onlineCount={onlineCount} firstName={firstName} />
          </div>

          {/* Messages — full height like Teams/Zoom */}
          <div
            ref={scrollRef}
            className="flex-1 glass-panel rounded-xl border-glow-purple px-2.5 sm:px-4 py-2 sm:py-3 overflow-y-auto space-y-2 mb-1.5 sm:mb-2 min-h-0"
          >
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center h-full">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-3"
                >
                  <img src={biddieRobot} alt="Biddie" className="w-20 h-20 mx-auto animate-float drop-shadow-[0_0_15px_hsl(230_85%_60%_/_0.4)]" />
                  <p className="text-muted-foreground text-sm">Biddie's waiting for the first message...</p>
                  <p className="text-muted-foreground/60 text-xs">Be the one to break the ice!</p>
                </motion.div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                const isOwn = msg.user_id === session?.user?.id;
                const isBiddie = msg.user_id === BIDDIE_USER_ID;
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className={`group flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}
                  >
                    {/* Avatar */}
                    {isBiddie ? (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-primary/20 border border-primary/40">
                        <img src={biddieRobot} alt="Biddie" className="w-full h-full object-contain" />
                      </div>
                    ) : !isOwn ? (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center">
                        <span className="text-xs font-bold text-muted-foreground">
                          {(msg.user_name || "T")[0].toUpperCase()}
                        </span>
                      </div>
                    ) : null}

                    {/* Message Bubble */}
                    <div
                      className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-2.5 sm:px-3 py-1.5 sm:py-2 ${
                        isBiddie
                          ? "bg-primary/10 border border-primary/25 rounded-bl-sm"
                          : isOwn
                          ? "bg-primary/20 border border-primary/30 rounded-br-sm"
                          : "bg-muted/30 border border-border/40 rounded-bl-sm"
                      }`}
                    >
                      {!isOwn && (
                        <p className={`text-[11px] font-semibold mb-0.5 ${userColor(msg.user_id)}`}>
                          {isBiddie ? "Biddie AI" : (msg.user_name || "Trader")}
                        </p>
                      )}
                      {isBiddie ? (
                        <div className="prose prose-sm prose-invert max-w-none text-foreground [&_p]:text-xs [&_p]:leading-relaxed [&_p]:mb-1 [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_strong]:text-primary [&_h1]:text-primary [&_h2]:text-primary [&_h1]:font-bold [&_h2]:font-semibold [&_h1]:mb-1 [&_h2]:mb-0.5 [&_ul]:pl-3 [&_ol]:pl-3 [&_li]:mb-0">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-xs text-foreground break-words leading-relaxed">{msg.content}</p>
                      )}
                      <p className="text-[9px] text-muted-foreground/60 mt-0.5">{formatTime(msg.created_at)}</p>
                    </div>

                    {/* Delete button */}
                    {(isOwn || isAdmin) && (
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity self-center p-1 rounded hover:bg-destructive/20"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Input */}
          <div className="glass-panel rounded-xl p-1.5 sm:p-2.5 flex gap-1.5 sm:gap-2 border-glow-blue shrink-0">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message as ${firstName}...`}
              className="bg-muted/30 border-border/50 flex-1 focus:border-primary/50 transition-colors h-9 text-sm"
              maxLength={500}
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              variant="hero"
              size="icon"
              className="rounded-xl h-9 w-9"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardCommunity;
