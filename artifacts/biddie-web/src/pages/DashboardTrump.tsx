import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import {
  RefreshCw, Clock, ExternalLink, Heart,
  MessageCircle, Repeat2, Loader2, AlertTriangle,
  TrendingUp, TrendingDown, Minus
} from "lucide-react";
import biddieRobot from "@/assets/biddie-robot.png";

interface TrumpPost {
  id: string;
  created_at: string;
  content: string;
  url: string;
  media: string[];
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
}

interface TrumpFeedResponse {
  posts: TrumpPost[];
  lastFetch: string | null;
  count: number;
}

const CandlestickBg = () => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.06]" viewBox="0 0 800 200" preserveAspectRatio="none">
    {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
      const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
      const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
      const green = i % 3 !== 0;
      return (
        <g key={i}>
          <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#22c55e" : "#ef4444"} strokeWidth="1" />
          <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#22c55e" : "#ef4444"} rx="1" />
        </g>
      );
    })}
  </svg>
);

const DashboardTrump = () => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<TrumpPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPosts = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const resp = await fetch("/api/whale/trump-posts");
      if (!resp.ok) throw new Error("Failed to fetch");
      const data: TrumpFeedResponse = await resp.json();
      setPosts(data.posts);
      setLastFetch(data.lastFetch);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
    const interval = setInterval(() => fetchPosts(), 60_000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatFullTime = (iso: string) => {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const sentimentKeywords = (text: string) => {
    const lower = text.toLowerCase();
    const bullish = ["great", "tremendous", "winning", "deal", "growth", "strong", "tariff", "america first", "tax cut", "boom", "record"];
    const bearish = ["crash", "disaster", "failing", "weak", "fraud", "witch hunt", "hoax", "radical"];
    const bullCount = bullish.filter(w => lower.includes(w)).length;
    const bearCount = bearish.filter(w => lower.includes(w)).length;
    if (bullCount > bearCount) return "bullish";
    if (bearCount > bullCount) return "bearish";
    return "neutral";
  };

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader user={user} />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          <div className="max-w-3xl mx-auto space-y-5">

            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
              <CandlestickBg />
              <div className="absolute inset-0 bg-gradient-to-r from-red-900/20 via-transparent to-blue-900/20" />
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

              <div className="relative px-6 py-8 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-red-500 to-red-700" />
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                        TRUMP FEED
                      </h1>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/80 font-semibold mt-0.5">
                        Truth Social × Market Impact
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-3 max-w-md">
                    Live posts from Truth Social. Biddie analyzes each post for potential market sentiment and DJT stock movement.
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  {lastFetch && (
                    <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      Updated {formatTime(lastFetch)}
                    </span>
                  )}
                  <button
                    onClick={() => fetchPosts(true)}
                    disabled={refreshing}
                    className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 text-white ${refreshing ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 text-red-400 animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <AlertTriangle className="h-8 w-8 text-yellow-400" />
                <p className="text-sm text-muted-foreground">{error}</p>
                <button
                  onClick={() => fetchPosts(true)}
                  className="px-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                >
                  Retry
                </button>
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <img
                  src={biddieRobot}
                  alt="Biddie"
                  className="h-24 w-24 object-contain grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all duration-500"
                />
                <p className="text-sm text-muted-foreground">No posts in the last 24 hours</p>
                <p className="text-xs text-muted-foreground/40">Check back later — Biddie's watching!</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {posts.map((post, i) => {
                  const sentiment = sentimentKeywords(post.content);
                  const sentimentConfig = {
                    bullish: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Bullish" },
                    bearish: { icon: TrendingDown, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Bearish" },
                    neutral: { icon: Minus, color: "text-muted-foreground/50", bg: "bg-white/5", border: "border-white/10", label: "Neutral" },
                  }[sentiment];
                  const SentIcon = sentimentConfig.icon;

                  return (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="glass-panel rounded-xl p-5 hover:border-white/15 transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0 mt-0.5 shadow-lg shadow-red-900/20">
                          <span className="text-white font-black text-sm">DT</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="font-bold text-white text-sm">Donald J. Trump</span>
                            <span className="text-[10px] text-muted-foreground/40">@realDonaldTrump</span>
                            <span className="text-[10px] text-muted-foreground/40">·</span>
                            <span className="text-[10px] text-muted-foreground/50" title={formatFullTime(post.created_at)}>
                              {formatTime(post.created_at)}
                            </span>
                            <span className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${sentimentConfig.bg} ${sentimentConfig.border} border ${sentimentConfig.color}`}>
                              <SentIcon className="h-3 w-3" />
                              {sentimentConfig.label}
                            </span>
                          </div>

                          <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed break-words">
                            {post.content}
                          </p>

                          {post.media && post.media.length > 0 && (
                            <div className="mt-3 flex gap-2 flex-wrap">
                              {post.media.map((url, mi) => (
                                <a
                                  key={mi}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                                >
                                  Media {mi + 1}
                                </a>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-5 mt-3 pt-3 border-t border-white/[0.04] text-muted-foreground/40">
                            <span className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors cursor-default">
                              <MessageCircle className="h-3.5 w-3.5" />
                              {formatCount(post.replies_count)}
                            </span>
                            <span className="flex items-center gap-1.5 text-xs hover:text-emerald-400 transition-colors cursor-default">
                              <Repeat2 className="h-3.5 w-3.5" />
                              {formatCount(post.reblogs_count)}
                            </span>
                            <span className="flex items-center gap-1.5 text-xs hover:text-red-400 transition-colors cursor-default">
                              <Heart className="h-3.5 w-3.5" />
                              {formatCount(post.favourites_count)}
                            </span>
                            <a
                              href={post.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors ml-auto opacity-0 group-hover:opacity-100"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View on Truth Social
                            </a>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardTrump;
