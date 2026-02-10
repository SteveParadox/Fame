import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getMyInfluencers } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

type Influencer = {
  id: number;
  name: string;
  niche: string;
  style: string;
  posting_frequency: number;
};

export default function StudioIndex() {
  const { isAuthed } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed) {
      router.push('/login');
      return;
    }
    setLoading(true);
    getMyInfluencers()
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [isAuthed]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Creator Studio</h1>
          <p className="mt-1 text-sm text-gray-500">Drafts, scheduling, and generation controls. Because black boxes don't build trust.</p>
        </div>
        <Link
          href="/create-influencer"
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900"
        >
          + New Influencer
        </Link>
      </div>

      <div className="mt-6 grid gap-4">
        {loading ? (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
            <div className="mt-3 h-4 w-64 animate-pulse rounded bg-gray-200" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">No influencers yet</h2>
            <p className="mt-1 text-sm text-gray-500">Create your first influencer, seed drafts, and schedule the next 7 days.</p>
            <Link
              href="/create-influencer"
              className="mt-4 inline-block rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900"
            >
              Create an influencer
            </Link>
          </div>
        ) : (
          items.map((inf) => (
            <Link
              key={inf.id}
              href={`/studio/${inf.id}`}
              className="group rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold group-hover:underline">{inf.name}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    <span className="font-medium text-gray-700">{inf.niche}</span>
                    <span className="mx-2 text-gray-300">•</span>
                    <span className="capitalize">{inf.style}</span>
                    <span className="mx-2 text-gray-300">•</span>
                    <span>{inf.posting_frequency}/day</span>
                  </div>
                </div>
                <div className="text-sm text-gray-500 group-hover:text-gray-900">Open →</div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
