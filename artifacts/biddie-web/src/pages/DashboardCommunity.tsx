import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Trash2, Bot, Lock, ArrowUpRight, Smile, CheckSquare, X, ShoppingCart, Eye, ListChecks } from "lucide-react";
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
import PaperTradeTicket, { type PaperTradeSignalInput } from "@/components/PaperTradeTicket";
import {
  extractContractsFromText,
  formatChatContract,
  chatContractKey,
  buildPaperTradeFromChat,
  type ChatContract,
} from "@/lib/extractContracts";
import { useMarketStatus } from "@/hooks/useMarketStatus";
import { MARKET_CLOSED_MESSAGE } from "@/lib/marketHours";

interface ChatMessage {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

type ReactionsMap = Record<string, Record<string, string[]>>;

const REACTION_EMOJIS = ["👍","🔥","💯","😂","👀","🚀","💰","❤️"];

const API_BASE = import.meta.env.VITE_API_URL || "";

const BIDDIE_USER_ID = "00000000-0000-0000-0000-000000000000";

const DashboardCommunity = () => {
  const { session, profile, isAdmin } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [biddieThinking, setBiddieThinking] = useState(false);
  const [reactions, setReactions] = useState<ReactionsMap>({});
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [showEmojis, setShowEmojis] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Chat-trade action bar wiring ────────────────────────────────────────
  // When Biddie posts a message containing an option contract like
  // "GOOGL 330C 5/1", we render an inline [Buy Paper] [Monitor] [Review]
  // row beneath that message. Buy/Review open the existing PaperTradeTicket
  // in chat mode (source: "chat") so the modal shows the "Unverified" banner
  // and skips the signal plan card. The execution evaluator is NEVER called
  // from this path. Monitor persists to localStorage only.
  //
  // Phase 1 market-hours gate (Apr 2026): only the "Buy Paper" button is
  // gated outside RTH (it would create a paper_trade row, which the backend
  // also rejects with 409 { code: "market_closed" }). "Monitor" stays
  // enabled because it's local-only (localStorage). "Review" stays enabled
  // because it just opens the contract picker for analysis — submitting
  // from inside that modal IS gated separately by PaperTradeTicket itself.
  // Biddie chat / commentary is NOT gated.
  const { isOpen: marketOpen } = useMarketStatus();
  const userIdForMonitor = session?.user?.id || "anon";
  const monitorStorageKey = `biddie-chat-monitor-${userIdForMonitor}`;
  const [paperTradeSignal, setPaperTradeSignal] = useState<PaperTradeSignalInput | null>(null);
  const [monitoredKeys, setMonitoredKeys] = useState<Set<string>>(new Set());

  // Rehydrate when the user identity becomes known (session loads async).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(monitorStorageKey);
      if (raw) {
        const arr = JSON.parse(raw) as Array<{ ticker: string; strike: number; optionType: string; expiry: string }>;
        setMonitoredKeys(new Set(arr.map((x) => `${x.ticker}|${x.strike}|${x.optionType}|${x.expiry}`)));
      } else {
        setMonitoredKeys(new Set());
      }
    } catch {
      setMonitoredKeys(new Set());
    }
  }, [monitorStorageKey]);

  function handleBuyOrReview(c: ChatContract) {
    setPaperTradeSignal(buildPaperTradeFromChat(c));
  }

  function handleMonitor(c: ChatContract) {
    const key = chatContractKey(c);
    setMonitoredKeys((prev) => {
      if (prev.has(key)) {
        toast({ title: "Already monitoring", description: formatChatContract(c) });
        return prev;
      }
      const next = new Set(prev);
      next.add(key);
      try {
        const arr = Array.from(next).map((k) => {
          const [ticker, strikeS, optionType, expiry] = k.split("|");
          return { ticker, strike: Number(strikeS), optionType, expiry, addedAt: new Date().toISOString() };
        });
        localStorage.setItem(monitorStorageKey, JSON.stringify(arr));
      } catch {}
      toast({ title: "Added to Monitor", description: formatChatContract(c) });
      return next;
    });
  }
  // ──────────────────────────────────────────────────────────────────────────
  const lastTypingBroadcast = useRef<number>(0);
  const ackBlockRef = useRef<boolean>(false);

  const EMOJI_LIST = [
    "🔥","💪","👀","🚀","📈","📉","💰","🤝","😤","😏",
    "🫡","💎","🧠","⚡","🎯","☀️","🍞","😂","💀","🤣",
    "❤️","👏","🙏","😎","🤑","😈","👑","✅","❌","⚠️",
    "🐂","🐻","🦅","🔴","🟢","💸","📊","🏆","😴","🤔",
  ];

  const insertEmoji = useCallback((emoji: string) => {
    setInput((prev) => prev + emoji);
    setShowEmojis(false);
  }, []);

  const fetchReactions = useCallback(async (msgIds: string[]) => {
    if (!msgIds.length) return;
    try {
      const res = await fetch(`${API_BASE}/api/whale/chat/reactions?ids=${msgIds.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        setReactions((prev) => ({ ...prev, ...data }));
      }
    } catch {}
  }, []);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!session?.user?.id) return;
    setReactingTo(null);
    try {
      const res = await fetch(`${API_BASE}/api/whale/chat/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji, userId: session.user.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setReactions((prev) => ({ ...prev, [messageId]: data.reactions }));
      }
    } catch {}
  }, [session?.user?.id]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojis(false);
      }
      const target = e.target as HTMLElement;
      if (!target.closest("[data-reaction-picker]")) {
        setReactingTo(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
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
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) {
        setMessages(data.reverse() as ChatMessage[]);
        scrollToBottom();
        const ids = data.map((m: any) => m.id);
        if (ids.length) fetchReactions(ids);
      }
    };
    load();
  }, [fetchReactions]);

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
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.user_id === session?.user?.id) return;
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(payload.user_id, payload.name);
          return next;
        });
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(payload.user_id);
            return next;
          });
        }, 3000);
      })
      .on("broadcast", { event: "stop_typing" }, ({ payload }) => {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(payload.user_id);
          return next;
        });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && session?.user?.id) {
          await channel.track({ user_id: session.user.id, name: firstName });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [session?.user?.id, firstName]);

  const shouldBiddieRespond = (text: string): boolean => {
    const lower = text.toLowerCase();
    if (/\b(biddie|@biddie)\b/i.test(lower)) return true;
    const safeTerms = [
      "trading", "calls", "puts", "flow", "ticker", "setup", "entry",
      "strike", "sweep", "whale", "breakout", "breakdown", "signal",
      "premarket", "pre-market", "market", "options", "option", "price",
      "stock", "earnings", "volume", "unusual", "dark pool", "premium",
      "support", "resistance", "stop loss", "bullish", "bearish",
      "squeeze", "rally", "reversal", "vwap", "rsi", "macd",
      "sector", "etf", "futures", "contract", "portfolio",
      "what's the move", "any plays", "moon", "drilling", "ripping",
      "tanking", "printing", "pumping", "dumping",
    ];
    if (safeTerms.some(w => lower.includes(w))) return true;
    const boundaryTerms = [
      "play", "trade", "buy", "sell", "dip", "exit", "target", "index", "news",
    ];
    if (boundaryTerms.some(w => new RegExp(`\\b${w}s?\\b`).test(lower))) return true;
    const commonWords = new Set([
      "i", "a", "am", "an", "as", "at", "be", "by", "do", "go", "he", "if",
      "in", "is", "it", "me", "my", "no", "of", "oh", "ok", "on", "or", "so",
      "to", "up", "us", "we", "hi", "ha", "hm", "yo", "ya",
      "all", "and", "any", "are", "but", "can", "day", "did", "for", "get",
      "got", "had", "has", "her", "him", "his", "how", "its", "let", "lot",
      "may", "new", "not", "now", "old", "one", "our", "out", "own", "ran",
      "run", "say", "see", "set", "she", "the", "too", "try", "two", "use",
      "was", "way", "who", "why", "win", "won", "yes", "yet", "you",
      "been", "come", "does", "done", "each", "even", "from", "good", "have",
      "here", "just", "keep", "know", "last", "like", "long", "look", "made",
      "make", "more", "much", "must", "need", "next", "only", "over", "said",
      "same", "some", "sure", "take", "tell", "than", "that", "them", "then",
      "they", "this", "time", "very", "want", "well", "were", "what", "when",
      "will", "with", "work", "your",
      "about", "after", "being", "could", "every", "first", "found", "going",
      "great", "might", "never", "other", "right", "shall", "should", "since",
      "still", "their", "there", "these", "thing", "think", "those", "today",
      "under", "until", "where", "which", "while", "would",
      "lol", "lmao", "omg", "bruh", "bro", "fam", "nah", "yep", "nope",
      "damn", "dude", "nice", "sick", "fire", "based", "chad", "cope",
    ]);
    const words = text.split(/\s+/);
    const hasTicker = words.some(w => {
      const cleaned = w.replace(/^\$/, "").replace(/[?.!,]+$/, "");
      return /^[A-Z]{1,5}$/.test(cleaned) && !commonWords.has(cleaned.toLowerCase());
    });
    if (hasTicker) return true;
    return false;
  };

  const isAcknowledgment = (text: string): boolean => {
    const lower = text.toLowerCase().replace(/[!.,❤️🔥👍💪🙏🫡🤝]+/g, "").trim();
    const ackPhrases = [
      "thanks", "thank you", "thanks biddie", "thank you biddie",
      "got it", "okay", "ok", "cool", "bet", "appreciate it",
      "nice", "perfect", "word", "solid", "good looks", "good look",
      "ty", "thx", "aight", "fasho", "for sure", "yessir", "noted",
    ];
    return ackPhrases.includes(lower);
  };

  const ackResponses = [
    "No problem 👍", "Got you", "Anytime 🔥", "Glad I could help",
    "You got it", "Always 💪", "Say less 🫡", "Bet 🤝",
  ];

  const triggerBiddie = async (userMessage: string, traceId: string) => {
    if (ackBlockRef.current) {
      console.log(`[TRACE][${traceId}] triggerBiddie BLOCKED by ackBlockRef — hard stop`);
      return;
    }
    console.log(`[TRACE][${traceId}] triggerBiddie CALLED with:`, JSON.stringify(userMessage));
    if (isAcknowledgment(userMessage)) {
      console.log(`[TRACE][${traceId}] triggerBiddie: isAcknowledgment=true — hard stop, no action`);
      return;
    }
    if (!shouldBiddieRespond(userMessage)) {
      console.log(`[TRACE][${traceId}] triggerBiddie: shouldBiddieRespond=false, returning`);
      return;
    }
    console.log(`[TRACE][${traceId}] triggerBiddie: CALLING /whale/community-chat`);
    setBiddieThinking(true);
    scrollToBottom();
    try {
      const senderName = profile?.chat_alias || profile?.full_name?.split(" ")[0] || "fam";
      const res = await fetch('/api/whale/community-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, userName: senderName, reqId: traceId }),
      });
      const data = await res.json();
      console.log(`[TRACE][${traceId}] community-chat response:`, JSON.stringify({ ok: data.ok, posted: data.posted, reqId: data.reqId, contentLen: data.content?.length }));
    } catch (e) {
      console.error(`[TRACE][${traceId}] community-chat error:`, e);
    } finally {
      setBiddieThinking(false);
      scrollToBottom();
    }
  };

  const broadcastTyping = useCallback(() => {
    if (!channelRef.current || !session?.user?.id) return;
    const now = Date.now();
    if (now - lastTypingBroadcast.current < 2000) return;
    lastTypingBroadcast.current = now;
    const displayName = profile?.chat_alias || profile?.full_name?.split(" ")[0] || "Someone";
    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: session.user.id, name: displayName },
    });
  }, [session?.user?.id, profile?.chat_alias, profile?.full_name]);

  const broadcastStopTyping = useCallback(() => {
    if (!channelRef.current || !session?.user?.id) return;
    channelRef.current.send({
      type: "broadcast",
      event: "stop_typing",
      payload: { user_id: session.user.id },
    });
  }, [session?.user?.id]);

  const handleInputChange = (val: string) => {
    setInput(val);
    if (val.trim()) {
      broadcastTyping();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(broadcastStopTyping, 3000);
    } else {
      broadcastStopTyping();
    }
  };

  const sendMessage = async () => {
    if (!session?.user?.id) {
      toast({ title: "Please log in", description: "You need to be signed in to send messages.", variant: "destructive" });
      return;
    }
    if (!input.trim() || sending) return;
    broadcastStopTyping();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const messageText = input.trim();
    const traceId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isAck = isAcknowledgment(messageText);
    console.log(`[TRACE][${traceId}] sendMessage FIRED messageText=${JSON.stringify(messageText)} isAck=${isAck}`);

    if (isAck) {
      ackBlockRef.current = true;
    }

    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      user_id: session.user.id,
      user_name: profile?.chat_alias || profile?.full_name || "Trader",
      content: messageText,
    } as any);
    if (error) {
      console.log(`[TRACE][${traceId}] sendMessage INSERT_FAILED: ${error.message}`);
      toast({ title: "Error sending message", description: error.message, variant: "destructive" });
      ackBlockRef.current = false;
      setSending(false);
      return;
    }

    setInput("");

    if (isAck) {
      console.log(`[TRACE][${traceId}] sendMessage: ACK PATH — HARD STOP — no triggerBiddie`);
      const reply = ackResponses[Math.floor(Math.random() * ackResponses.length)];
      try {
        const res = await fetch('/api/whale/community-chat/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply }),
        });
        const data = await res.json();
        console.log(`[TRACE][${traceId}] sendMessage: ACK backend response:`, JSON.stringify(data));
      } catch (e) {
        console.error(`[TRACE][${traceId}] sendMessage: ACK backend error:`, e);
      }
      setSending(false);
      setTimeout(() => { ackBlockRef.current = false; }, 5000);
      return;
    }

    const cleanMsg = messageText.replace(/@?biddie[,:]?\s*/i, "").trim() || messageText;
    console.log(`[TRACE][${traceId}] sendMessage: NORMAL PATH — scheduling triggerBiddie with:`, JSON.stringify(cleanMsg));
    setTimeout(() => triggerBiddie(cleanMsg, traceId), 300);
    setSending(false);
  };

  const deleteMessage = async (id: string) => {
    await supabase.from("chat_messages").delete().eq("id", id);
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const batchSize = 10;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await supabase.from("chat_messages").delete().in("id", batch);
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkDeleting(false);
    toast({ title: `Deleted ${ids.length} message${ids.length > 1 ? "s" : ""}` });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    return `${date} • ${time} ET`;
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
            {isAdmin && !selectMode && (
              <div className="flex justify-end mb-1">
                <button
                  onClick={() => { setSelectMode(true); setSelectedIds(new Set(messages.map(m => m.id))); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <CheckSquare className="h-3 w-3" />
                  Manage
                </button>
              </div>
            )}
            {isAdmin && selectMode && (
              <div className="flex justify-end mb-1">
                <button
                  onClick={exitSelectMode}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
              </div>
            )}
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
                    className={`group flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""} ${selectMode ? "cursor-pointer" : ""} ${selectMode && selectedIds.has(msg.id) ? "bg-primary/5 rounded-lg -mx-1 px-1" : ""}`}
                    onClick={selectMode ? () => toggleSelectId(msg.id) : undefined}
                  >
                    {selectMode && (
                      <div className="flex-shrink-0 self-center">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedIds.has(msg.id) ? "bg-primary border-primary" : "border-muted-foreground/40"
                        }`}>
                          {selectedIds.has(msg.id) && <CheckSquare className="h-3.5 w-3.5 text-primary-foreground" />}
                        </div>
                      </div>
                    )}

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
                        <>
                          <div className="prose prose-sm prose-invert max-w-none text-foreground [&_p]:text-xs [&_p]:leading-relaxed [&_p]:mb-1 [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_strong]:text-primary [&_h1]:text-primary [&_h2]:text-primary [&_h1]:font-bold [&_h2]:font-semibold [&_h1]:mb-1 [&_h2]:mb-0.5 [&_ul]:pl-3 [&_ol]:pl-3 [&_li]:mb-0">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-foreground break-words leading-relaxed">{msg.content}</p>
                      )}
                      <p className="text-[9px] text-muted-foreground/60 mt-0.5">{formatTime(msg.created_at)}</p>

                      {/* Reactions display */}
                      {reactions[msg.id] && Object.keys(reactions[msg.id]).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(reactions[msg.id]).map(([emoji, userIds]) => (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(msg.id, emoji)}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors cursor-pointer ${
                                userIds.includes(session?.user?.id || "")
                                  ? "bg-primary/20 border-primary/40 text-primary"
                                  : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50"
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="text-[10px]">{userIds.length}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Reaction + Delete buttons */}
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-center relative">
                      <div className="relative" data-reaction-picker>
                        <button
                          onClick={() => setReactingTo(reactingTo === msg.id ? null : msg.id)}
                          className="p-1 rounded hover:bg-muted/40"
                          title="React"
                        >
                          <Smile className="h-3 w-3 text-muted-foreground" />
                        </button>
                        {reactingTo === msg.id && (
                          <div className={`absolute bottom-7 ${isOwn ? "right-0" : "left-0"} z-50 glass-panel rounded-lg border border-border/60 p-1 shadow-xl flex gap-0.5`} data-reaction-picker>
                            {REACTION_EMOJIS.map((e) => (
                              <button
                                key={e}
                                onClick={() => toggleReaction(msg.id, e)}
                                className="w-7 h-7 flex items-center justify-center text-sm hover:bg-muted/60 rounded transition-colors cursor-pointer"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {(isOwn || isAdmin) && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          className="p-1 rounded hover:bg-destructive/20"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {typingUsers.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-1"
              >
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {(() => {
                    const names = Array.from(typingUsers.values());
                    if (names.length === 1) return `${names[0]} is typing`;
                    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
                    return `${names.length} people are typing`;
                  })()}
                </span>
              </motion.div>
            )}

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
                    <span className="flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {selectMode && selectedIds.size > 0 && (
            <div className="glass-panel rounded-xl p-2 flex items-center justify-between border border-destructive/30 shrink-0 mb-1.5">
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} message{selectedIds.size > 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (selectedIds.size === messages.length) setSelectedIds(new Set());
                    else setSelectedIds(new Set(messages.map(m => m.id)));
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  {selectedIds.size === messages.length ? "Deselect All" : "Select All"}
                </button>
                <button
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                  className="text-xs px-3 py-1.5 rounded-lg bg-destructive/20 border border-destructive/30 text-destructive hover:bg-destructive/30 transition-colors font-medium flex items-center gap-1.5"
                >
                  <Trash2 className="h-3 w-3" />
                  {bulkDeleting ? "Deleting..." : `Delete ${selectedIds.size}`}
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="glass-panel rounded-xl p-1.5 sm:p-2.5 flex gap-1.5 sm:gap-2 border-glow-blue shrink-0 relative">
            <div className="relative" ref={emojiRef}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => setShowEmojis((v) => !v)}
              >
                <Smile className="h-4 w-4" />
              </Button>
              {showEmojis && (
                <div className="absolute bottom-11 left-0 z-50 glass-panel rounded-xl border border-border/60 p-2 w-[280px] shadow-xl">
                  <div className="grid grid-cols-10 gap-0.5">
                    {EMOJI_LIST.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => insertEmoji(e)}
                        className="w-6 h-6 flex items-center justify-center text-base hover:bg-muted/60 rounded transition-colors cursor-pointer"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Input
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message as ${profile?.chat_alias || firstName}... Try @biddie for tickers, flow, or market questions`}
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

      {paperTradeSignal && (
        <PaperTradeTicket
          signal={paperTradeSignal}
          onClose={() => setPaperTradeSignal(null)}
        />
      )}
    </div>
  );
};

export default DashboardCommunity;
