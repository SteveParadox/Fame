import { useMemo, useState } from 'react';
import { followInfluencer, likePost, unfollowInfluencer, unlikePost, votePoll } from '../lib/api';
import {
  HeartIcon,
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  ShareIcon,
  PlusIcon,
  CheckIcon,
} from '@heroicons/react/24/solid';
import ShareCardModal from './ShareCardModal';

type PollMeta = {
  question: string;
  options: string[];
  ends_at?: string | null;
  counts: number[];
  total_votes: number;
  user_choice?: number | null;
};

type InfluencerMini = {
  id: number;
  name: string;
  niche: string;
  style: string;
  avatar_url?: string | null;
};

export type FeedPostV2 = {
  id: number;
  created_at: string;
  content: string;
  post_type?: string | null;
  influencer: InfluencerMini;
  like_count: number;
  comment_count: number;
  is_liked?: boolean | null;
  is_following?: boolean | null;
  poll?: PollMeta | null;
};

export default function FeedPostCard({
  post,
  onOpenComments,
  onChanged,
}: {
  post: FeedPostV2;
  onOpenComments: (postId: number) => void;
  onChanged?: () => void;
}) {
  const [likeOptimistic, setLikeOptimistic] = useState<boolean | null>(post.is_liked ?? null);
  const [likeCountOptimistic, setLikeCountOptimistic] = useState<number>(post.like_count);
  const [followOptimistic, setFollowOptimistic] = useState<boolean | null>(post.is_following ?? null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pollState, setPollState] = useState<PollMeta | null>(post.poll ?? null);

  const liked = likeOptimistic ?? false;
  const following = followOptimistic ?? false;

  const badge = useMemo(() => {
    const s = (post.influencer.style || '').toLowerCase();
    if (s.includes('savage')) return { label: 'SAVAGE', cls: 'bg-red-50 text-red-600 border-red-100' };
    if (s.includes('educ')) return { label: 'EDU', cls: 'bg-blue-50 text-blue-600 border-blue-100' };
    if (s.includes('drama')) return { label: 'DRAMA', cls: 'bg-pink-50 text-pink-600 border-pink-100' };
    return { label: 'VIBES', cls: 'bg-green-50 text-green-600 border-green-100' };
  }, [post.influencer.style]);

  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!liked) {
        setLikeOptimistic(true);
        setLikeCountOptimistic((c) => c + 1);
        await likePost(post.id);
      } else {
        setLikeOptimistic(false);
        setLikeCountOptimistic((c) => Math.max(0, c - 1));
        await unlikePost(post.id);
      }
      onChanged?.();
    } catch {
      // rollback on error
      setLikeOptimistic(post.is_liked ?? null);
      setLikeCountOptimistic(post.like_count);
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!following) {
        setFollowOptimistic(true);
        await followInfluencer(post.influencer.id);
      } else {
        setFollowOptimistic(false);
        await unfollowInfluencer(post.influencer.id);
      }
      onChanged?.();
    } catch {
      setFollowOptimistic(post.is_following ?? null);
    } finally {
      setBusy(false);
    }
  };

  const avatar = post.influencer.avatar_url;

  const isPoll = (post.post_type || '').toLowerCase() === 'poll' && !!pollState;
  const pollVoted = isPoll && typeof pollState?.user_choice === 'number';
  const pollTotal = pollState?.total_votes || 0;
  const pollPct = (idx: number) => {
    const c = pollState?.counts?.[idx] || 0;
    return pollTotal <= 0 ? 0 : Math.round((100 * c) / pollTotal);
  };

  const castPollVote = async (idx: number) => {
    if (!isPoll || busy) return;
    setBusy(true);
    try {
      // optimistic update
      if (pollState) {
        const next = { ...pollState };
        const prevChoice = typeof next.user_choice === 'number' ? next.user_choice : null;
        next.user_choice = idx;
        next.counts = [...(next.counts || [])];
        // if changing vote, move one count
        if (prevChoice !== null && prevChoice !== idx && next.counts[prevChoice] != null) {
          next.counts[prevChoice] = Math.max(0, (next.counts[prevChoice] || 0) - 1);
          next.total_votes = Math.max(0, (next.total_votes || 0) - 1);
        }
        next.counts[idx] = (next.counts[idx] || 0) + 1;
        next.total_votes = (next.total_votes || 0) + 1;
        setPollState(next);
      }
      const res = await votePoll(post.id, idx);
      setPollState(res.data);
      onChanged?.();
    } catch {
      setPollState(post.poll ?? null);
    } finally {
      setBusy(false);
    }
  };

  // Poll UI uses pollState + castPollVote

  return (
    <article
      className={
        'snap-start bg-white rounded-2xl shadow-[0_12px_30px_-18px_rgba(0,0,0,0.25)] border border-gray-100 overflow-hidden'
      }
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-gray-500">@</span>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{post.influencer.name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
              <span className="text-[11px] text-gray-500 ml-auto">
                {new Date(post.created_at).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="truncate">{post.influencer.niche}</span>
              <span className="text-gray-300">•</span>
              <span className="truncate">{post.influencer.style}</span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-gray-900 whitespace-pre-line">
          {post.content}
        </p>

        {isPoll && pollState && (
          <div className="mt-4 rounded-2xl border border-gray-100 bg-gradient-to-b from-gray-50 to-white p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-extrabold text-gray-800">
                🗳️ Poll
              </div>
              <div className="text-[11px] text-gray-500">
                {pollTotal} vote{pollTotal === 1 ? '' : 's'}
              </div>
            </div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {pollState.question || 'Pick one'}
            </div>

            <div className="mt-3 space-y-2">
              {pollState.options.map((opt, idx) => {
                const mine = pollState.user_choice === idx;
                const pct = pollPct(idx);
                const count = pollState.counts?.[idx] || 0;
                return (
                  <button
                    key={idx}
                    disabled={busy}
                    onClick={() => castPollVote(idx)}
                    className={
                      'relative w-full text-left rounded-xl border px-3 py-3 overflow-hidden transition ' +
                      (mine
                        ? 'border-primary bg-primary/5'
                        : pollVoted
                          ? 'border-gray-200 bg-white'
                          : 'border-gray-200 bg-white hover:border-primary/40')
                    }
                  >
                    {pollVoted && (
                      <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${pct}%` }} />
                    )}
                    <div className="relative flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            'inline-flex items-center justify-center h-6 w-6 rounded-lg text-xs font-extrabold ' +
                            (mine ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700')
                          }
                        >
                          {idx + 1}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">{opt}</span>
                      </div>
                      {pollVoted ? (
                        <span className="text-xs font-semibold text-gray-700">
                          {pct}% · {count}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-primary">Vote</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 text-[11px] text-gray-500">
              {pollVoted ? 'Vote recorded. Come back tomorrow for more chaos.' : 'Vote to steer the story. Yes, your click matters.'}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLike}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${
                liked ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-200 hover:border-primary/40'
              }`}
            >
              <HeartIcon className="h-4 w-4" />
              <span>{likeCountOptimistic}</span>
            </button>
            <button
              onClick={() => onOpenComments(post.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-gray-200 text-gray-700 hover:border-primary/40 transition"
            >
              <ChatBubbleOvalLeftIcon className="h-4 w-4" />
              <span>{post.comment_count}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleFollow}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${
                following ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-900/30'
              }`}
              title={following ? 'Following' : 'Follow'}
            >
              {following ? <CheckIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{following ? 'Following' : 'Follow'}</span>
            </button>
            <button
              className="p-2 rounded-xl border border-gray-200 text-gray-700 hover:border-primary/40 transition"
              title="Repost (MVP placeholder)"
              onClick={() => {
                // placeholder for future repost endpoint
              }}
            >
              <ArrowPathRoundedSquareIcon className="h-4 w-4" />
            </button>
            <button
              className="p-2 rounded-xl border border-gray-200 text-gray-700 hover:border-primary/40 transition"
              title="Share"
              onClick={() => {
                setShareOpen(true);
              }}
            >
              <ShareIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <ShareCardModal open={shareOpen} onClose={() => setShareOpen(false)} post={post as any} />
    </article>
  );
}
