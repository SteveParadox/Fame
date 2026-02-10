import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import Link from "next/link";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../lib/api";
import {
  Bell,
  Check,
  CheckCircle,
  Filter as FilterIcon,
  MessageSquare,
  TrendingUp,
  Wallet,
  UserPlus,
  Sparkles,
} from "lucide-react";

type Notification = {
  id: number;
  type: string;
  message: string;
  data: any;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
};

const PAGE_SIZE = 20;

type FilterKey = "all" | "unread" | "read";

function formatDateTime(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function normType(t: string) {
  return String(t || "").toLowerCase();
}

function getNotifMeta(t: string) {
  const tt = normType(t);

  // Map your backend event types to UI
  if (tt.includes("big_buy") || tt.includes("bigbuy")) {
    return {
      title: "Big Buy",
      Icon: Wallet,
      color: "emerald" as const,
      pill: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    };
  }
  if (tt.includes("trending")) {
    return {
      title: "Trending",
      Icon: TrendingUp,
      color: "sapphire" as const,
      pill: "bg-sapphire-500/10 text-sapphire-400 border-sapphire-500/20",
    };
  }
  if (tt.includes("reply") || tt.includes("comment")) {
    return {
      title: "New Reply",
      Icon: MessageSquare,
      color: "rose" as const,
      pill: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    };
  }
  if (tt.includes("follow")) {
    return {
      title: "New Follower",
      Icon: UserPlus,
      color: "sapphire" as const,
      pill: "bg-sapphire-500/10 text-sapphire-400 border-sapphire-500/20",
    };
  }

  return {
    title: t || "Notification",
    Icon: Sparkles,
    color: "gold" as const,
    pill: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  };
}

export default function NotificationsPage() {
  // Fancy UI filter chips (design update)
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  // Real backend filters (your working version)
  const [notifType, setNotifType] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  // Collapsible advanced filters panel
  const [showAdvanced, setShowAdvanced] = useState(false);

  const filters = useMemo(
    () => ({
      status: activeFilter,
      notif_type: notifType || undefined,
      search: search || undefined,
      since: since || undefined,
      until: until || undefined,
    }),
    [activeFilter, notifType, search, since, until]
  );

  const getKey = (pageIndex: number, prev: Notification[] | null) => {
    if (prev && prev.length === 0) return null;
    return ["notifications", pageIndex * PAGE_SIZE, filters] as const;
  };

  const fetcher = async (_: string, skip: number, f: any) => {
    const res = await getNotifications({ ...f, skip, limit: PAGE_SIZE });
    return res.data as Notification[];
  };

  const { data, size, setSize, mutate, isValidating } = useSWRInfinite(
    getKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  const notifications = useMemo(
    () => (data ? ([] as Notification[]).concat(...data) : []),
    [data]
  );

  const canLoadMore = data ? data[data.length - 1]?.length === PAGE_SIZE : true;

  // Unread badge count (works off currently loaded items)
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && canLoadMore && !isValidating) {
          setSize((s) => s + 1);
        }
      },
      { rootMargin: "400px" }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [canLoadMore, isValidating, setSize]);

  // Reset pagination on filter change
  useEffect(() => {
    setSize(1);
  }, [filters, setSize]);

  const onMarkRead = useCallback(
    async (n: Notification) => {
      if (n.is_read) return;

      // Optimistic UI (so it feels instant)
      mutate(
        (pages) => {
          if (!pages) return pages;
          return pages.map((page) =>
            page.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
          );
        },
        false
      );

      try {
        await markNotificationRead(n.id);
        mutate();
      } catch {
        // rollback by refetch
        mutate();
      }
    },
    [mutate]
  );

  const onMarkAll = useCallback(async () => {
    // optimistic
    mutate(
      (pages) => {
        if (!pages) return pages;
        return pages.map((page) => page.map((x) => ({ ...x, is_read: true })));
      },
      false
    );

    try {
      await markAllNotificationsRead();
      mutate();
    } catch {
      mutate();
    }
  }, [mutate]);

  const clearFilters = () => {
    setActiveFilter("all");
    setNotifType("");
    setSearch("");
    setSince("");
    setUntil("");
  };

  const FILTERS = useMemo(
    () =>
      [
        { key: "all" as const, label: "All" },
        { key: "unread" as const, label: "Unread" },
        { key: "read" as const, label: "Read" },
      ] as const,
    []
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-display font-bold text-foreground">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-sapphire-500 text-midnight text-sm font-medium">
              {unreadCount}
            </span>
          )}
        </div>

        <button
          onClick={onMarkAll}
          className="flex items-center gap-2 btn-outline-luxury text-sm"
        >
          <Check className="w-4 h-4" />
          Mark all read
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeFilter === f.key
                ? "bg-sapphire-500 text-midnight"
                : "bg-white/5 text-foreground hover:bg-white/10"
            }`}
          >
            {f.label}
          </button>
        ))}

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            showAdvanced
              ? "bg-sapphire-500/15 text-sapphire-400"
              : "bg-white/5 text-foreground hover:bg-white/10"
          }`}
        >
          <FilterIcon className="w-4 h-4" />
          Filters
        </button>
      </div>

      {/* Advanced filters panel (real backend filters, styled) */}
      {showAdvanced && (
        <div className="glass-card p-4 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={notifType}
              onChange={(e) => setNotifType(e.target.value)}
              className="input-luxury"
            >
              <option value="">All types</option>
              <option value="notify.big_buy">Big buys</option>
              <option value="notify.trending">Trending</option>
              <option value="notify.reply_spike">Reply spikes</option>
            </select>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search message…"
              className="input-luxury"
            />

            <input
              value={since}
              onChange={(e) => setSince(e.target.value)}
              placeholder="Since (ISO or yyyy-mm-dd)"
              className="input-luxury"
            />

            <div className="flex gap-2">
              <input
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                placeholder="Until (ISO or yyyy-mm-dd)"
                className="input-luxury flex-1"
              />
              <button
                onClick={clearFilters}
                className="btn-outline-luxury px-4"
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {!data && (
          <div className="glass-card p-12 text-center">
            <Bell className="w-12 h-12 text-sapphire-400 mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">Loading notifications…</p>
          </div>
        )}

        {data && notifications.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Bell className="w-12 h-12 text-sapphire-400 mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No notifications match your filters.</p>
          </div>
        )}

        {notifications.map((n) => {
          const meta = getNotifMeta(n.type);
          const Icon = meta.Icon;

          const infId = n.data?.influencer_id;
          const tradeId = n.data?.trade_id;
          const deepLink = infId ? `/market?influencer_id=${infId}` : null;

          return (
            <div
              key={n.id}
              onClick={() => onMarkRead(n)}
              className={`glass-card p-4 transition-all cursor-pointer ${
                !n.is_read ? "border-l-4 border-l-sapphire-500" : ""
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${meta.pill}`}
                >
                  <Icon className="w-5 h-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground truncate">
                          {meta.title}
                        </h3>
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-sapphire-500" />}
                        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs border border-white/10 bg-white/5 text-muted-foreground">
                          {n.type}
                        </span>
                      </div>

                      <p className="text-sm text-muted-foreground mt-1">
                        {n.message}
                      </p>

                      <p className="text-xs text-muted-foreground mt-2">
                        {formatDateTime(n.created_at)}
                        {tradeId ? ` • trade #${tradeId}` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!n.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkRead(n);
                          }}
                          className="p-2 rounded-lg text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                          title="Mark as read"
                          type="button"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}

                      {deepLink && (
                        <Link
                          href={deepLink}
                          onClick={(e) => e.stopPropagation()}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-foreground hover:bg-white/10 transition"
                        >
                          Open market
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={sentinelRef} />

        {isValidating && (
          <div className="text-center text-xs text-muted-foreground py-4">
            Loading…
          </div>
        )}

        {data && notifications.length > 0 && !canLoadMore && (
          <div className="text-center text-xs text-muted-foreground py-4">
            You’ve reached the end. Congratulations on surviving your own app.
          </div>
        )}
      </div>
    </div>
  );
}
