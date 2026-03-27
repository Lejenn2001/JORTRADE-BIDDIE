import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import {
  Megaphone, RefreshCw, Clock, ExternalLink, Heart,
  MessageCircle, Repeat2, Loader2, AlertTriangle
} from "lucide-react";

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

  return (
    <div className="flex min-h-screen bg-[#0a0a1a]">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col">
        <DashboardHeader user={user} />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <Megaphone className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">Trump Feed</h1>
                  <p className="text-xs text-muted-foreground">
                    Truth Social posts — last 24 hours
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {lastFetch && (
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    Updated {formatTime(lastFetch)}
                  </span>
                )}
                <button
                  onClick={() => fetchPosts(true)}
                  disabled={refreshing}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 text-white ${refreshing ? "animate-spin" : ""}`} />
                </button>
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
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Megaphone className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No posts in the last 24 hours</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {posts.map((post, i) => (
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="bg-[#12122a] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-white font-black text-sm">DT</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white text-sm">Donald J. Trump</span>
                          <span className="text-xs text-muted-foreground/40">@realDonaldTrump</span>
                          <span className="text-xs text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground/50" title={formatFullTime(post.created_at)}>
                            {formatTime(post.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed break-words">
                          {post.content}
                        </p>
                        {post.media && post.media.length > 0 && (
                          <div className="mt-2 flex gap-2 flex-wrap">
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
                        <div className="flex items-center gap-5 mt-3 text-muted-foreground/40">
                          <span className="flex items-center gap-1 text-xs">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {formatCount(post.replies_count)}
                          </span>
                          <span className="flex items-center gap-1 text-xs">
                            <Repeat2 className="h-3.5 w-3.5" />
                            {formatCount(post.reblogs_count)}
                          </span>
                          <span className="flex items-center gap-1 text-xs">
                            <Heart className="h-3.5 w-3.5" />
                            {formatCount(post.favourites_count)}
                          </span>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs hover:text-blue-400 transition-colors ml-auto"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View
                          </a>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardTrump;
