import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ReactMarkdown from "react-markdown";
import biddieRobot from "@/assets/biddie-robot.png";

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
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [greeting] = useState(() => greetings[Math.floor(Math.random() * greetings.length)](firstName));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem('biddie-chat-messages');
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

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
      // Detect if user is telling Biddie about a trade they entered
      const lower = text.trim().toLowerCase();
      const isTradeEntry = /\b(i just (entered|bought|sold|opened|took)|i('m| am) (in|holding|long|short)|my position|i have a)\b/.test(lower);
      
      let instruction: string;
      if (isTradeEntry) {
        instruction = `[TRADE ADVISOR MODE] The user just told you about a trade they entered. Give a detailed analysis: check gamma levels, support/resistance alignment, VWAP positioning, and whether their direction is correct. Recommend entry/exit adjustments, stop loss, and profit targets. Be thorough here — this is their money.\n\nUser says: ${text.trim()}`;
      } else {
        instruction = `[DASHBOARD CHAT MODE] Keep your response to 3-4 sentences max. Be conversational and helpful but concise. No long breakdowns unless the user specifically asks for detail.\n\nUser says: ${text.trim()}`;
      }

      // Build conversation history for context memory
      const history = updatedMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { message: instruction, history },
      });

      if (error) throw error;

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: "assistant",
        content: data?.reply || "I couldn't generate a response. Please try again.",
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

  return (
    <div className="glass-panel rounded-xl border-glow-purple flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Biddie AI</span>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <img src={biddieRobot} alt="Biddie" className="w-24 h-24 mx-auto mb-3 drop-shadow-[0_0_15px_hsl(230_85%_60%_/_0.4)]" />
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

      {/* Quick prompts */}
      {messages.length === 0 && (
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

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border/40">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Biddie anything..."
            className="bg-muted/30 border-border/50 rounded-lg text-sm flex-1"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
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
