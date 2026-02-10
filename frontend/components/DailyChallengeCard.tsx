import { useEffect, useMemo, useState } from 'react';
import { getTodayChallenge, voteDailyChallenge } from '../lib/api';
import { SparklesIcon, BoltIcon } from '@heroicons/react/24/solid';

type Challenge = {
  id: number;
  day: string;
  kind: string;
  prompt: string;
  options: string[];
  counts: number[];
  total_votes: number;
  user_choice?: number | null;
  resolved?: boolean;
  winning_option_index?: number | null;
  influencer?: { id: number; name: string; niche: string; style: string; avatar_url?: string | null } | null;
  post_id?: number | null;
};

export default function DailyChallengeCard({ onVoted }: { onVoted?: () => void }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await getTodayChallenge();
      setChallenge(res.data);
      setError(null);
    } catch (e) {
      setError('Could not load daily challenge');
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = challenge?.total_votes || 0;
  const bars = useMemo(() => {
    if (!challenge) return [];
    const counts = challenge.counts || [];
    const t = Math.max(1, total);
    return counts.map((c) => ({ c, pct: Math.round((100 * c) / t) }));
  }, [challenge, total]);

  const vote = async (idx: number) => {
    if (!challenge || busy) return;
    setBusy(true);
    try {
      const res = await voteDailyChallenge(challenge.id, idx);
      setChallenge(res.data);
      onVoted?.();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Vote failed');
    } finally {
      setBusy(false);
    }
  };

  if (!challenge) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-[0_12px_30px_-22px_rgba(0,0,0,0.35)] p-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <SparklesIcon className="h-4 w-4 text-primary" /> Loading daily challenge…
        </div>
      </div>
    );
  }

  const voted = typeof challenge.user_choice === 'number';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-[0_12px_30px_-22px_rgba(0,0,0,0.35)] overflow-hidden">
      <div className="p-4 sm:p-5 bg-gradient-to-r from-primary/10 to-secondary/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700">
              <span className="px-2 py-0.5 rounded-full bg-white/70 border border-white">🔥 Daily Challenge</span>
              <span className="px-2 py-0.5 rounded-full bg-white/70 border border-white">+10 XP</span>
            </div>
            <h3 className="mt-2 text-base sm:text-lg font-extrabold tracking-tight text-gray-900">
              {challenge.prompt}
            </h3>
            {challenge.influencer && (
              <p className="mt-1 text-xs text-gray-600">
                Steering <span className="font-semibold">{challenge.influencer.name}</span> · {challenge.influencer.niche}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-600">Votes</div>
            <div className="text-xl font-extrabold text-gray-900">{total}</div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
        <div className="space-y-2">
          {challenge.options.map((opt, idx) => {
            const isMine = challenge.user_choice === idx;
            const pct = bars[idx]?.pct ?? 0;
            const count = bars[idx]?.c ?? 0;
            return (
              <button
                key={idx}
                disabled={busy}
                onClick={() => vote(idx)}
                className={
                  'group w-full text-left rounded-xl border px-3 py-3 transition relative overflow-hidden ' +
                  (isMine
                    ? 'border-primary bg-primary/5'
                    : voted
                      ? 'border-gray-200 bg-gray-50'
                      : 'border-gray-200 bg-white hover:border-primary/40')
                }
              >
                {/* result bar */}
                {voted && (
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/10"
                    style={{ width: `${pct}%` }}
                  />
                )}
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={
                      'inline-flex items-center justify-center h-6 w-6 rounded-lg text-xs font-bold ' +
                      (isMine ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700')
                    }>
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{opt}</span>
                  </div>
                  {voted ? (
                    <div className="text-xs font-semibold text-gray-700">
                      {pct}% · {count}
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      <BoltIcon className="h-4 w-4" /> Vote
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 text-xs text-gray-500">
          {voted ? 'Vote locked for today. Come back tomorrow for a new twist.' : 'Pick one. Your vote steers the arc.'}
        </div>
      </div>
    </div>
  );
}
