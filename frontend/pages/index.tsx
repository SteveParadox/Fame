import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import Link from "next/link";
import {
  Sparkles,
  Users,
  Flame,
  Search,
  Filter,
  TrendingUp,
} from "lucide-react";

import { getEventsUrl, getFeedV2, getRecommendedInfluencers } from "../lib/api";
import FeedPostCard, { FeedPostV2 } from "../components/FeedPostCard";
import CommentsDrawer from "../components/CommentsDrawer";
import SkeletonCard from "../components/SkeletonCard";
import StartHerePanel from "../components/StartHerePanel";
import DailyChallengeCard from "../components/DailyChallengeCard";
import { useAuth } from "../contexts/AuthContext";

// ------------------------------------
// Types
// ------------------------------------
type FeedPageV2 = {
  items: FeedPostV2[];
  next_cursor?: string | null;
};

const MODES = [
  { key: "for_you", label: "For You", icon: Sparkles },
  { key: "following", label: "Following", icon: Users },
  { key: "trending", label: "Trending", icon: Flame },
] as const;

type FeedMode = (typeof MODES)[number]["key"];

// ------------------------------------
// Helpers
// ------------------------------------
function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ------------------------------------
// Component
// ------------------------------------
export default function FeedModern() {
  const { user } = useAuth();

  const [mode, setMode] = useState<FeedMode>("for_you");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [openPostId, setOpenPostId] = useState<number | null>(null);
  const [newPosts, setNewPosts] = useState(0);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // SWR Infinite key generator
  const getKey = (pageIndex: number, prev: FeedPageV2 | null) => {
    if (prev && !prev.next_cursor) return null;
    const cursor = pageIndex === 0 ? null : prev?.next_cursor || null;
    return ["feedV2", mode, qDebounced, niche, style, cursor] as const;
  };

  const {
    data,
    size,
    setSize,
    mutate,
    isValidating,
  } = useSWRInfinite<FeedPageV2>(
    getKey,
    async (key) => {
      const [, m, qv, nv, sv, cursor] = key;
      const res = await getFeedV2({
        mode: m,
        q: qv || undefined,
        niche: nv || undefined,
        style: sv || undefined,
        cursor,
        limit: 12,
      });
      return res.data;
    },
    { revalidateOnFocus: false }
  );

  const posts = useMemo(() => {
    if (!data) return [];
    return data.flatMap((p) => p.items || []);
  }, [data]);

  const hasMore = useMemo(() => {
    if (!data || data.length === 0) return true;
    const last = data[data.length - 1];
    return !!last?.next_cursor;
  }, [data]);

  const showStartHere = !!user && user.onboarding_completed === false;

  // Keyboard navigation (J/K) for scrolling inside feed container
  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const delta = Math.max(220, node.clientHeight * 0.85);

      if (e.key.toLowerCase() === "j") node.scrollBy({ top: delta, behavior: "smooth" });
      if (e.key.toLowerCase() === "k") node.scrollBy({ top: -delta, behavior: "smooth" });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Infinite scroll using IntersectionObserver
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    const node = sentinelRef.current;
    const scroller = feedRef.current;
    if (!node || !scroller) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries[0]?.isIntersecting;
        if (!hit) return;
        if (!hasMore) return;
        if (isValidating) return;

        // Prevent rapid-fire increments
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;

        setSize((s) => s + 1);

        // reset lock shortly after
        window.setTimeout(() => {
          loadingMoreRef.current = false;
        }, 400);
      },
      { root: scroller, rootMargin: "600px" }
    );

    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, isValidating, setSize]);

  // SSE: refresh feed on events
  useEffect(() => {
    const url = getEventsUrl();
    if (!url) return;

    const es = new EventSource(url);

    const onPostCreated = () => {
      const scroller = feedRef.current;
      if (scroller && scroller.scrollTop < 80) {
        mutate();
      } else {
        setNewPosts((n) => clampInt(n + 1, 0, 99));
      }
    };

    const refresh = () => mutate();

    es.addEventListener("post.created", onPostCreated as any);
    es.addEventListener("comment.created", refresh as any);
    es.addEventListener("comment.reply", refresh as any);
    es.addEventListener("reaction.like", refresh as any);
    es.addEventListener("reaction.unlike", refresh as any);
    es.addEventListener("poll.voted", refresh as any);
    es.addEventListener("challenge.voted", refresh as any);
    es.addEventListener("challenge.created", refresh as any);
    es.addEventListener("challenge.resolved", refresh as any);

    // If SSE dies, we don’t crash. Humans love unreliable networks.
    es.onerror = () => {
      // Let the browser retry automatically; no spam logs here.
    };

    return () => es.close();
  }, [mutate]);

  // Recommended influencers
  const [recommended, setRecommended] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getRecommendedInfluencers(6);
        if (!alive) return;
        setRecommended(r.data || []);
      } catch {
        if (!alive) return;
        setRecommended([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Reset pagination when filters/mode change
  const resetAndReload = useCallback(() => {
    setSize(1);
    mutate();
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewPosts(0);
  }, [mutate, setSize]);

  useEffect(() => {
    resetAndReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, qDebounced, niche, style]);

  const ModeIcon = MODES.find((m) => m.key === mode)?.icon || Sparkles;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-6 pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground">
              Feed
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sapphire-500/10 text-sapphire-400 text-xs font-medium border border-sapphire-500/20">
              <ModeIcon className="w-3.5 h-3.5" />
              {MODES.find((m) => m.key === mode)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search posts or creators..."
                className="input-luxury pl-10 w-full"
              />
            </div>

            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`p-2.5 rounded-xl transition-all ${
                showFilters
                  ? "bg-sapphire-500/15 text-sapphire-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
              aria-label="Toggle filters"
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/5 w-fit">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                  active ? "bg-sapphire-500 text-midnight" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="glass-card p-4 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Filters</span>
              <button
                onClick={() => {
                  setNiche("");
                  setStyle("");
                }}
                className="text-xs text-sapphire-400 hover:text-sapphire-300 transition-colors"
              >
                Clear filters
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Filter by niche..."
                className="input-luxury"
              />
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="Filter by style..."
                className="input-luxury"
              />
            </div>
          </div>
        )}
      </div>

      {(showStartHere || (!isValidating && posts.length === 0 && mode === "for_you")) && (
        <div>
          <StartHerePanel />
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_320px] gap-6">
        {/* Left Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-4">
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Quick Links</h3>
              <nav className="space-y-1">
                <Link
                  href="/discover"
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
                >
                  <Search className="w-4 h-4" />
                  Discover
                </Link>
                <Link
                  href="/market"
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
                >
                  <TrendingUp className="w-4 h-4" />
                  Market
                </Link>
                <Link
                  href="/dashboard"
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
                >
                  <Users className="w-4 h-4" />
                  Dashboard
                </Link>
              </nav>
            </div>

            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Tip</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Press <span className="text-sapphire-400 font-medium">J</span> /
                <span className="text-sapphire-400 font-medium"> K</span> to scroll quickly.
              </p>
            </div>
          </div>
        </aside>

        {/* Feed */}
        <main>
          <div
            ref={feedRef}
            className="h-[calc(100vh-14rem)] sm:h-[calc(100vh-13rem)] lg:h-[calc(100vh-10rem)] overflow-y-auto rounded-2xl bg-white/5 border border-white/10 p-3 sm:p-4 scroll-smooth"
          >
            {newPosts > 0 && (
              <div className="sticky top-2 z-10 flex justify-center">
                <button
                  onClick={resetAndReload}
                  className="rounded-full bg-sapphire-500 text-midnight px-4 py-2 text-xs font-semibold shadow-lg hover:opacity-90 transition"
                >
                  New posts ({newPosts})
                </button>
              </div>
            )}

            {user && (
              <div className="mb-4">
                <DailyChallengeCard onVoted={() => mutate()} />
              </div>
            )}

            {(!data || (posts.length === 0 && isValidating)) && (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {posts.length > 0 && (
              <div className="space-y-4">
                {posts.map((p) => (
                  <FeedPostCard
                    key={p.id}
                    post={p}
                    onOpenComments={(pid) => setOpenPostId(pid)}
                    onChanged={() => mutate()}
                  />
                ))}
              </div>
            )}

            <div ref={sentinelRef} className="h-12" />

            {!isValidating && posts.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-muted-foreground">No posts found.</p>
                <p className="text-sm text-muted-foreground/70 mt-2">
                  Try removing filters or switch tabs.
                </p>
                <button
                  onClick={() => {
                    setQ("");
                    setNiche("");
                    setStyle("");
                  }}
                  className="mt-4 text-sapphire-400 hover:text-sapphire-300 text-sm font-medium"
                >
                  Clear all
                </button>
              </div>
            )}

            {isValidating && posts.length > 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">Loading more…</p>
            )}

            {!hasMore && posts.length > 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                You reached the end. Touch grass or switch tabs.
              </p>
            )}
          </div>
        </main>

        {/* Right Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-4">
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Recommended Creators
              </h3>

              <div className="space-y-3">
                {recommended.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recommendations yet.</p>
                )}

                {recommended.map((i) => (
                  <Link
                    key={i.id}
                    href={`/influencers/${i.id}`}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-sapphire flex items-center justify-center text-midnight font-bold text-sm">
                      {String(i?.name || "?")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm group-hover:text-sapphire-400 transition-colors truncate">
                        {i.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {i.niche} • {i.style}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Pro Tip</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Use <span className="text-sapphire-400 font-medium">Following</span> for curated
                content, or <span className="text-sapphire-400 font-medium">Trending</span> for
                maximum chaos per pixel.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <CommentsDrawer
        open={openPostId !== null}
        postId={openPostId}
        onClose={() => setOpenPostId(null)}
        onChanged={() => mutate()}
      />
    </div>
  );
}
