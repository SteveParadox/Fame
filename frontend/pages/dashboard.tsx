import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { getMyDashboard, getInfluencer } from "../lib/api";

import {
  Users,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  BarChart3,
  Activity,
} from "lucide-react";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type InfluencerSummary = {
  id: number;
  name: string;
  niche: string;
  style: string;
  posting_frequency: number;
};

type TokenHolding = {
  influencer_id: number;
  balance: number;
  avg_buy_price?: number | null;
  last_trade_price?: number | null;
  trades_7d?: number;
};

type Dashboard = {
  user_id: number;
  created_influencers: InfluencerSummary[];
  followed_influencers: InfluencerSummary[];
  engagement: { posts_7d: number; likes_7d: number; comments_7d: number };
  token_holdings: TokenHolding[];
};

type ActiveTab = "overview" | "tokens" | "creators";

function formatCompact(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function safeNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export default function DashboardPage() {
  const { isAuthed } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // influencer_id -> name cache for holdings
  const [idToName, setIdToName] = useState<Record<number, string>>({});
  const fetchingIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!isAuthed) return;

    setLoading(true);
    setError(null);

    getMyDashboard()
      .then((res) => {
        const dash: Dashboard = res.data;
        setData(dash);

        // prime name map from dashboard lists (free, no extra calls)
        const map: Record<number, string> = {};
        for (const i of dash.created_influencers || []) map[i.id] = i.name;
        for (const i of dash.followed_influencers || []) map[i.id] = i.name;
        setIdToName((prev) => ({ ...prev, ...map }));
      })
      .catch((e) => {
        setError(e?.response?.data?.detail || "Failed to load dashboard");
      })
      .finally(() => setLoading(false));
  }, [isAuthed]);

  // Fetch missing names for holdings (only those not in created/followed lists)
  useEffect(() => {
    if (!data) return;

    const ids = (data.token_holdings || [])
      .filter((h) => safeNum(h.balance) !== 0)
      .map((h) => h.influencer_id);

    const missing = Array.from(new Set(ids)).filter((id) => !idToName[id]);
    if (missing.length === 0) return;

    missing.forEach((id) => {
      if (fetchingIdsRef.current.has(id)) return;
      fetchingIdsRef.current.add(id);

      getInfluencer(id)
        .then((r) => {
          const name = r.data?.name || `Influencer #${id}`;
          setIdToName((prev) => ({ ...prev, [id]: name }));
        })
        .catch(() => {
          setIdToName((prev) => ({ ...prev, [id]: `Influencer #${id}` }));
        })
        .finally(() => {
          fetchingIdsRef.current.delete(id);
        });
    });
  }, [data, idToName]);

  const totals = useMemo(() => {
    const created = data?.created_influencers?.length || 0;
    const followed = data?.followed_influencers?.length || 0;

    const holdingsUnits = (data?.token_holdings || []).reduce(
      (s, h) => s + safeNum(h.balance),
      0
    );

    const posts7d = safeNum(data?.engagement?.posts_7d);
    const likes7d = safeNum(data?.engagement?.likes_7d);
    const comments7d = safeNum(data?.engagement?.comments_7d);
    const engagementTotal = likes7d + comments7d;

    // portfolio “value” (only if you have last_trade_price)
    const portfolioValue = (data?.token_holdings || []).reduce((s, h) => {
      const bal = safeNum(h.balance);
      const px = h.last_trade_price == null ? 0 : safeNum(h.last_trade_price);
      return s + bal * px;
    }, 0);

    // simplistic “change” proxy using trades_7d
    const trades7d = (data?.token_holdings || []).reduce(
      (s, h) => s + safeNum(h.trades_7d),
      0
    );

    return {
      created,
      followed,
      holdingsUnits,
      posts7d,
      likes7d,
      comments7d,
      engagementTotal,
      portfolioValue,
      trades7d,
    };
  }, [data]);

  // Chart data: you only have totals, so we chart Likes vs Comments over “7d”
  const engagementChartData = useMemo(
    () => [
      { label: "7d", likes: totals.likes7d, comments: totals.comments7d },
      // add a second point so AreaChart doesn’t look like a sad dot
      { label: "Now", likes: totals.likes7d, comments: totals.comments7d },
    ],
    [totals.likes7d, totals.comments7d]
  );

  const holdingsRows = useMemo(() => {
    const rows = (data?.token_holdings || [])
      .filter((h) => safeNum(h.balance) !== 0)
      .map((h) => {
        const name = idToName[h.influencer_id] || `Influencer #${h.influencer_id}`;
        const balance = safeNum(h.balance);
        const last = h.last_trade_price == null ? null : safeNum(h.last_trade_price);
        const avg = h.avg_buy_price == null ? null : safeNum(h.avg_buy_price);
        const trades = safeNum(h.trades_7d);

        const value = last == null ? null : balance * last;
        const change =
          avg != null && last != null && avg > 0 ? ((last - avg) / avg) * 100 : null;

        return { ...h, name, balance, last, avg, trades, value, change };
      });

    // Sort by value (if available), else by balance
    rows.sort((a, b) => {
      const av = a.value ?? -1;
      const bv = b.value ?? -1;
      if (av !== bv) return bv - av;
      return b.balance - a.balance;
    });

    return rows;
  }, [data, idToName]);

  if (!isAuthed) {
    return (
      <div className="glass-card p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-sapphire-500/20 flex items-center justify-center mx-auto mb-6">
          <Users className="w-8 h-8 text-sapphire-400" />
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground mb-3">
          Sign in to view your dashboard
        </h2>
        <p className="text-muted-foreground mb-6">
          Track influencers, holdings, and engagement. Like a responsible adult.
        </p>
        <Link href="/login" className="btn-luxury inline-flex no-underline">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Your Dashboard
          </h1>
          <p className="text-muted-foreground">
            Creators, followers, engagement, and your off-chain bags.
          </p>
        </div>
        <Link href="/create-influencer" className="btn-luxury inline-flex no-underline">
          <Sparkles className="w-4 h-4" />
          Create Influencer
        </Link>
      </div>

      {error && (
        <div className="glass-card p-4 border border-rose-500/20">
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Influencers Created</span>
            <div className="w-8 h-8 rounded-lg bg-sapphire-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-sapphire-400" />
            </div>
          </div>
          <p className="stat-value">{loading ? "…" : totals.created}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your factory output this week
          </p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Following</span>
            <div className="w-8 h-8 rounded-lg bg-sapphire-500/20 flex items-center justify-center">
              <Users className="w-4 h-4 text-sapphire-400" />
            </div>
          </div>
          <p className="stat-value">{loading ? "…" : totals.followed}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Parasocial commitments
          </p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Weekly Engagement</span>
            <div className="w-8 h-8 rounded-lg bg-sapphire-500/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-sapphire-400" />
            </div>
          </div>
          <p className="stat-value">
            {loading ? "…" : formatCompact(totals.engagementTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Likes + comments (7d)
          </p>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Portfolio Value</span>
            <div className="w-8 h-8 rounded-lg bg-sapphire-500/20 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-sapphire-400" />
            </div>
          </div>
          <p className="stat-value">
            {loading ? "…" : totals.portfolioValue ? `$${formatCompact(totals.portfolioValue)}` : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Uses last trade price when available
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/5 w-fit">
        {[
          { key: "overview", label: "Overview", icon: Activity },
          { key: "tokens", label: "Tokens", icon: Wallet },
          { key: "creators", label: "My Creators", icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as ActiveTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                activeTab === tab.key
                  ? "bg-sapphire-500 text-midnight"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Engagement Chart */}
          <div className="lg:col-span-2 glass-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-display font-semibold text-foreground">
                Engagement (7 days)
              </h3>
              <div className="text-xs text-muted-foreground">
                Posts: <span className="text-foreground">{totals.posts7d}</span>
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={engagementChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0B1022",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="likes"
                    stroke="#4B6CFF"
                    fillOpacity={0.25}
                    fill="#4B6CFF"
                  />
                  <Area
                    type="monotone"
                    dataKey="comments"
                    stroke="#34D399"
                    fillOpacity={0.20}
                    fill="#34D399"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="space-y-4">
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Total token units held
              </h3>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-display font-bold text-foreground">
                  {loading ? "…" : totals.holdingsUnits.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Off-chain ledger sum</p>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Trades (7 days)
              </h3>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-display font-bold text-foreground">
                  {loading ? "…" : totals.trades7d}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Activity proxy since your API doesn’t expose PnL yet
              </p>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Shortcuts
              </h3>
              <div className="space-y-2">
                <Link href="/discover" className="block text-sm text-sapphire-400 hover:text-sapphire-300 no-underline">
                  Discover influencers →
                </Link>
                <Link href="/market" className="block text-sm text-sapphire-400 hover:text-sapphire-300 no-underline">
                  Open market →
                </Link>
                <Link href="/notifications" className="block text-sm text-sapphire-400 hover:text-sapphire-300 no-underline">
                  Notifications →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOKENS */}
      {activeTab === "tokens" && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-display font-semibold text-foreground">
              Token Holdings
            </h3>
            <Link
              href="/market"
              className="text-sm text-sapphire-400 hover:text-sapphire-300 flex items-center gap-1 no-underline"
            >
              View Market
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : holdingsRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No holdings yet. Your wallet is as empty as your excuses.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                      Influencer
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Balance
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Last Price
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      7d Trades
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsRows.map((h) => {
                    const change = h.change;
                    const up = change != null && change >= 0;
                    return (
                      <tr
                        key={h.influencer_id}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      >
                        <td className="py-4 px-4">
                          <Link
                            href={`/influencers/${h.influencer_id}`}
                            className="font-medium text-foreground hover:text-sapphire-300 no-underline"
                          >
                            {h.name}
                          </Link>
                        </td>

                        <td className="py-4 px-4 text-right text-foreground">
                          {h.balance.toFixed(2)}
                        </td>

                        <td className="py-4 px-4 text-right text-foreground">
                          {h.last == null ? "—" : h.last.toFixed(4)}
                        </td>

                        <td className="py-4 px-4 text-right text-foreground">
                          {h.trades || 0}
                        </td>

                        <td className="py-4 px-4 text-right">
                          {change == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center justify-end gap-1 ${
                                up ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {up ? (
                                <ArrowUpRight className="w-4 h-4" />
                              ) : (
                                <ArrowDownRight className="w-4 h-4" />
                              )}
                              {Math.abs(change).toFixed(2)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATORS */}
      {activeTab === "creators" && (
        <div className="space-y-6">
          {/* Created */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-display font-semibold text-foreground mb-4">
              Your Influencers
            </h3>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (data?.created_influencers || []).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No influencers yet. That’s fine. Most apps are empty at the start.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {data!.created_influencers.map((inf) => (
                  <div
                    key={inf.id}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-sapphire-500/30 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-sapphire flex items-center justify-center text-midnight font-bold text-lg">
                          {inf.name[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{inf.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {inf.niche} • {inf.style} • {inf.posting_frequency}/day
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/analytics/${inf.id}`}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors no-underline"
                          title="Analytics"
                        >
                          <BarChart3 className="w-4 h-4 text-sapphire-400" />
                        </Link>

                        <Link
                          href={`/influencers/${inf.id}`}
                          className="text-sm text-sapphire-400 hover:text-sapphire-300 no-underline"
                        >
                          Open →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Following */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-display font-semibold text-foreground mb-4">
              Following
            </h3>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (data?.followed_influencers || []).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                You aren’t following anyone. Introvert behavior.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {data!.followed_influencers.slice(0, 12).map((inf) => (
                  <Link
                    key={inf.id}
                    href={`/influencers/${inf.id}`}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-sapphire-500/30 transition-all cursor-pointer no-underline"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-sapphire flex items-center justify-center text-midnight font-bold">
                        {inf.name[0]}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{inf.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {inf.niche} • {inf.style}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
