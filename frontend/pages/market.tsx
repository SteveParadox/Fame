import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  listTokenMarkets,
  getTokenMarket,
  getOrderbook,
  getTradeTape,
  getPosition,
  createTrade,
} from '../lib/api';
import {
  ArrowsRightLeftIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';

type TokenRow = {
  influencer_id: number;
  name: string;
  niche: string;
  style: string;
  price: number;
  supply: number;
  followers: number;
};

type OrderbookRes = {
  influencer_id: number;
  asks: Array<{ amount: number; avg_price: number; new_price: number }>;
  bids: Array<{ amount: number; avg_price: number; new_price: number }>;
  current_price: number;
  current_supply: number;
};

type Trade = {
  id: number;
  user_id: number;
  trade_type: string;
  amount: number;
  price: number;
  timestamp?: string | null;
};

const MarketPage: React.FC = () => {
  const router = useRouter();
  const preselect = typeof router.query.influencer_id === 'string' ? parseInt(router.query.influencer_id, 10) : null;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [tradeAmount, setTradeAmount] = useState<number>(10);
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);

  const { data: tokenListRes, mutate: mutateTokenList } = useSWR('market.tokens', async () => {
    const res = await listTokenMarkets(0, 50);
    return res.data as TokenRow[];
  }, { revalidateOnFocus: false });

  const tokens = tokenListRes || [];

  useEffect(() => {
    if (!router.isReady) return;
    if (preselect && Number.isFinite(preselect)) {
      setSelectedId(preselect);
    } else if (tokens.length > 0 && selectedId == null) {
      setSelectedId(tokens[0].influencer_id);
    }
  }, [router.isReady, preselect, tokens, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter((t) =>
      [t.name, t.niche, t.style].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [tokens, query]);

  const { data: tokenDetail, mutate: mutateTokenDetail } = useSWR(
    selectedId ? ['market.token', selectedId] : null,
    async (_, id: number) => (await getTokenMarket(id)).data,
    { revalidateOnFocus: false }
  );

  const { data: orderbook, mutate: mutateOrderbook } = useSWR(
    selectedId ? ['market.orderbook', selectedId] : null,
    async (_, id: number) => (await getOrderbook(id, 6)).data as OrderbookRes,
    { revalidateOnFocus: false, refreshInterval: 0 }
  );

  const { data: tape, mutate: mutateTape } = useSWR(
    selectedId ? ['market.tape', selectedId] : null,
    async (_, id: number) => (await getTradeTape(id, 30)).data as Trade[],
    { revalidateOnFocus: false }
  );

  const { data: position, mutate: mutatePosition } = useSWR(
    selectedId ? ['market.position', selectedId] : null,
    async (_, id: number) => {
      try {
        return (await getPosition(id)).data;
      } catch {
        return null;
      }
    },
    { revalidateOnFocus: false }
  );

  const runTrade = async (trade_type: 'buy' | 'sell') => {
    if (!selectedId) return;
    setTradeMsg(null);
    try {
      const res = await createTrade({ influencer_id: selectedId, amount: tradeAmount, trade_type });
      const p = res.data?.price;
      const np = res.data?.new_price;
      setTradeMsg(`${trade_type.toUpperCase()} executed at ~${Number(p).toFixed(4)}. New price: ${Number(np).toFixed(4)}`);
      await Promise.all([mutateTokenList(), mutateTokenDetail(), mutateOrderbook(), mutateTape(), mutatePosition()]);
    } catch (e: any) {
      setTradeMsg(e?.response?.data?.detail || 'Trade failed (login required, or insufficient balance).');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">Market</h1>
          <p className="text-sm text-gray-600 mt-1">Orderbook-style depth from the bonding curve. Recent trades. One click away from regret.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2">
          <ArrowsRightLeftIcon className="h-5 w-5 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Off-chain market</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left list */}
        <div className="lg:col-span-4">
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search influencers, niches, vibes…"
                className="w-full bg-transparent outline-none text-sm"
              />
            </div>
            <div className="divide-y">
              {filtered.map((t) => (
                <button
                  key={t.influencer_id}
                  onClick={() => setSelectedId(t.influencer_id)}
                  className={
                    "w-full text-left py-3 px-2 rounded-xl transition hover:bg-gray-50 " +
                    (selectedId === t.influencer_id ? "bg-primary/10" : "")
                  }
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-500">{t.niche} • {t.style}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900">{t.price.toFixed(4)}</div>
                      <div className="text-xs text-gray-500">{t.followers} followers</div>
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-500">No matches.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right details */}
        <div className="lg:col-span-8">
          {!selectedId && (
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-8 text-center text-sm text-gray-600">
              Select a tokenized influencer to view the orderbook.
            </div>
          )}

          {selectedId && (
            <>
              <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <div className="text-2xl font-extrabold text-gray-900">{tokenDetail?.name || `Influencer #${selectedId}`}</div>
                    <div className="text-sm text-gray-600 mt-1">{tokenDetail?.niche} • {tokenDetail?.style}</div>
                    {tokenDetail?.bio && <div className="text-sm text-gray-700 mt-3 leading-relaxed">{tokenDetail.bio}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">Price</div>
                      <div className="text-xl font-bold">{(orderbook?.current_price ?? tokenDetail?.price ?? 0).toFixed(4)}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">Supply</div>
                      <div className="text-xl font-bold">{(orderbook?.current_supply ?? tokenDetail?.supply ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">Followers</div>
                      <div className="text-xl font-bold">{tokenDetail?.followers ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">Your balance</div>
                      <div className="text-xl font-bold">{position?.balance?.toFixed?.(2) ?? '—'}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Trade controls + orderbook + tape */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-4">
                  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
                    <div className="text-lg font-semibold text-gray-900 mb-3">Trade</div>
                    <label className="text-xs text-gray-500">Amount</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(parseFloat(e.target.value))}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <button
                        onClick={() => runTrade('buy')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                      >
                        <ArrowTrendingUpIcon className="h-5 w-5" /> Buy
                      </button>
                      <button
                        onClick={() => runTrade('sell')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                      >
                        <ArrowTrendingDownIcon className="h-5 w-5" /> Sell
                      </button>
                    </div>
                    {position?.avg_buy_price != null && (
                      <div className="mt-4 text-xs text-gray-500">Avg buy price: {Number(position.avg_buy_price).toFixed(4)}</div>
                    )}
                    {tradeMsg && (
                      <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
                        {tradeMsg}
                      </div>
                    )}
                  </div>
                </div>

                <div className="xl:col-span-4">
                  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-lg font-semibold text-gray-900">Orderbook</div>
                      <div className="text-xs text-gray-500">Depth quotes</div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Bids (sell)</div>
                        <div className="space-y-2">
                          {(orderbook?.bids || []).map((l, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                              <span className="text-xs text-gray-500">{l.amount.toFixed(0)}</span>
                              <span className="text-sm font-bold text-gray-900">{l.avg_price.toFixed(4)}</span>
                            </div>
                          ))}
                          {(!orderbook || (orderbook.bids || []).length === 0) && (
                            <div className="text-xs text-gray-400">No bids (supply is 0).</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Asks (buy)</div>
                        <div className="space-y-2">
                          {(orderbook?.asks || []).map((l, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                              <span className="text-xs text-gray-500">{l.amount.toFixed(0)}</span>
                              <span className="text-sm font-bold text-gray-900">{l.avg_price.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="xl:col-span-4">
                  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-lg font-semibold text-gray-900">Trade Tape</div>
                      <div className="text-xs text-gray-500">Recent prints</div>
                    </div>
                    <div className="max-h-80 overflow-auto divide-y">
                      {(tape || []).map((t) => (
                        <div key={t.id} className="py-2 flex items-center justify-between">
                          <span className={
                            "text-xs font-semibold " + (t.trade_type === 'buy' ? 'text-primary' : 'text-gray-900')
                          }>
                            {t.trade_type.toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-500">{t.amount.toFixed(2)}</span>
                          <span className="text-sm font-bold text-gray-900">{t.price.toFixed(4)}</span>
                        </div>
                      ))}
                      {tape && tape.length === 0 && (
                        <div className="py-8 text-center text-sm text-gray-500">No trades yet.</div>
                      )}
                      {!tape && (
                        <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarketPage;
