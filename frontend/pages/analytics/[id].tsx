import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { getInfluencer, getInfluencerAnalytics } from '../../lib/api';
import Link from 'next/link';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

type AnalyticsResponse = {
  influencer_id: number;
  days: number;
  points: Array<{
    date: string;
    posts: number;
    likes: number;
    comments: number;
    followers_added: number;
    followers_total: number;
    price: number | null;
  }>;
  totals: {
    posts: number;
    likes: number;
    comments: number;
    followers: number;
    last_price: number | null;
  };
};

const fetcher = (key: string) => {
  const [url, days] = key.split('|');
  const id = parseInt(url.split('/').pop() || '0', 10);
  return getInfluencerAnalytics(id, parseInt(days, 10)).then((r) => r.data as AnalyticsResponse);
};

const AnalyticsPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const influencerId = typeof id === 'string' ? parseInt(id, 10) : NaN;

  const [days, setDays] = useState<number>(30);
  const [influencerName, setInfluencerName] = useState<string>('');

  useEffect(() => {
    if (!router.isReady || !Number.isFinite(influencerId)) return;
    getInfluencer(influencerId)
      .then((r) => setInfluencerName(r.data?.name || `Influencer #${influencerId}`))
      .catch(() => setInfluencerName(`Influencer #${influencerId}`));
  }, [router.isReady, influencerId]);

  const { data, error, mutate, isValidating } = useSWR(
    router.isReady && Number.isFinite(influencerId) ? `/influencers/${influencerId}/analytics|${days}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const chartData = useMemo(() => (data?.points || []).map((p) => ({
    ...p,
    price: p.price ?? undefined,
  })), [data]);


  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-600 mt-1">{influencerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Range</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load analytics. You may need to be logged in as the influencer owner.
        </div>
      )}

      {!data && !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="animate-pulse h-4 w-1/3 bg-gray-200 rounded" />
          <div className="animate-pulse h-64 mt-4 bg-gray-100 rounded" />
        </div>
      )}

      {data && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500">Posts</div>
              <div className="text-xl font-bold">{data.totals.posts}</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500">Likes</div>
              <div className="text-xl font-bold">{data.totals.likes}</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500">Comments</div>
              <div className="text-xl font-bold">{data.totals.comments}</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500">Followers</div>
              <div className="text-xl font-bold">{data.totals.followers}</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500">Last Price</div>
              <div className="text-xl font-bold">{data.totals.last_price ?? '—'}</div>
            </div>
          </div>

          {/* Engagement chart */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Engagement</h2>
              <span className="text-xs text-gray-500">posts / likes / comments</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="posts" stroke="#6B5BD2" dot={false} />
                  <Line type="monotone" dataKey="likes" stroke="#F37A24" dot={false} />
                  <Line type="monotone" dataKey="comments" stroke="#10B981" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Followers chart */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Follower Growth</h2>
              <span className="text-xs text-gray-500">cumulative followers</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="followers_total" stroke="#111827" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Price chart */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Token Price (Trades)</h2>
              <span className="text-xs text-gray-500">last trade price per day</span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="price" stroke="#3B82F6" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Market CTA */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Trade this influencer</h2>
              <span className="text-xs text-gray-500">Orderbook & trade tape</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Want depth quotes, recent prints, and your position? The Market page has the full orderbook-style UI.
            </p>
            <Link
              href={`/market?influencer_id=${influencerId}`}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Open Market
            </Link>
            {isValidating && <div className="text-xs text-gray-400 mt-2">Refreshing…</div>}
          </div>
        </>
      )}
    </div>
  );
};

export default AnalyticsPage;
