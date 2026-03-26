import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Bot, Lock, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
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
  const [biddieThinking, setBiddieThinking] = useState(false);
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
    setBiddieThinking(true);
    scrollToBottom();
    try {
      const res = await fetch('/api/whale/community-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json().catch(() => null);
      const replyText = data?.content || data?.analysis || "";
      if (replyText && !data?.posted) {
        const ephemeral: ChatMessage = {
          id: `biddie-local-${Date.now()}`,
          user_id: BIDDIE_USER_ID,
          user_name: "Biddie AI",
          content: replyText,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, ephemeral]);
      }
    } catch (e) {
      console.error("Biddie community chat error:", e);
    } finally {
      setBiddieThinking(false);
      scrollToBottom();
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
      const cleanMsg = messageText.replace(/@?biddie[,:]?\s*/i, "").trim() || messageText;
      setTimeout(() => triggerBiddie(cleanMsg), 300);
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
        {profile?.selected_plan === "starter" ? (
          <main className="flex-1 flex items-center justify-center p-6 bg-mesh">
            <div className="glass-panel rounded-xl border-glow-purple p-8 text-center max-w-sm">
              <img src={biddieRobot} alt="Biddie" className="w-20 h-20 mx-auto mb-4 opacity-40 grayscale" />
              <div className="flex items-center justify-center gap-2 mb-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-foreground font-semibold text-sm">Chat Room Locked</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                The JORTRADE chat room is available for Active Trader and above. Upgrade to connect with other traders and get live community insights.
              </p>
              <Link
                to="/signup"
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/20 text-primary px-4 py-2 rounded-lg hover:bg-primary/30 transition-colors"
              >
                Upgrade Plan
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </main>
        ) : (
        <main className="flex-1 flex flex-col overflow-hidden p-1.5 sm:p-2 lg:p-3 bg-mesh">
          <div className="mb-1.5 sm:mb-2 shrink-0 hidden sm:block">
            <ChatRoomHeader onlineCount={onlineCount} firstName={firstName} />
          </div>

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

            {biddieThinking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-2.5"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-primary/20 border border-primary/40">
                  <img src={biddieRobot} alt="Biddie" className="w-full h-full object-contain" />
                </div>
                <div className="bg-primary/10 border border-primary/25 rounded-2xl rounded-bl-sm px-3 py-2">
                  <p className="text-[11px] font-semibold mb-0.5 text-primary">Biddie AI</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Biddie is analyzing</span>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
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
        )}
      </div>
    </div>
  );
};

export default DashboardCommunity;
