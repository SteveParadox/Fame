import { Dialog, Transition } from '@headlessui/react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { commentOnPost, getCommentsV2 } from '../lib/api';
import { XMarkIcon } from '@heroicons/react/24/solid';

type InfluencerMini = {
  id: number;
  name: string;
  niche: string;
  style: string;
  avatar_url?: string | null;
};

type CommentV2 = {
  id: number;
  post_id: number;
  content: string;
  author_type: string;
  created_at: string;
  user_id?: number | null;
  influencer_id?: number | null;
  influencer?: InfluencerMini | null;
};

export default function CommentsDrawer({
  open,
  postId,
  onClose,
  onChanged,
}: {
  open: boolean;
  postId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const getKey = (pageIndex: number, prev: any) => {
    if (!postId) return null;
    if (prev && !prev.next_cursor) return null;
    const cursor = pageIndex === 0 ? null : prev?.next_cursor;
    return ['commentsV2', postId, cursor];
  };

  const {
    data,
    size,
    setSize,
    isValidating,
    mutate,
  } = useSWRInfinite(getKey, async (key) => {
    const [, pid, cursor] = key as any[];
    const res = await getCommentsV2(pid, { limit: 25, cursor });
    return res.data;
  }, {
    revalidateOnFocus: false,
  });

  const items: CommentV2[] = useMemo(() => {
    if (!data) return [];
    return data.flatMap((p: any) => p.items || []);
  }, [data]);

  // infinite scroll inside drawer
  useEffect(() => {
    if (!open) return;
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isValidating) {
        setSize((s) => s + 1);
      }
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, [open, isValidating, setSize]);

  useEffect(() => {
    if (!open) {
      setInput('');
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (!postId) return;
    const text = input.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await commentOnPost(postId, text);
      setInput('');
      await mutate();
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  }, [postId, input, mutate, onChanged]);

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-x-0 bottom-0 flex max-h-full">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-out duration-200"
                enterFrom="translate-y-full"
                enterTo="translate-y-0"
                leave="transform transition ease-in duration-150"
                leaveFrom="translate-y-0"
                leaveTo="translate-y-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen">
                  <div className="flex h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                      <Dialog.Title className="text-base font-semibold">Comments</Dialog.Title>
                      <button
                        className="p-2 rounded-lg hover:bg-gray-100"
                        onClick={onClose}
                        aria-label="Close"
                      >
                        <XMarkIcon className="h-5 w-5 text-gray-600" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {items.length === 0 && !isValidating && (
                        <p className="text-sm text-gray-500">No comments yet. Be the first.</p>
                      )}

                      {items.map((c) => {
                        const isInf = c.author_type === 'influencer';
                        const avatar = c.influencer?.avatar_url;
                        return (
                          <div
                            key={c.id}
                            className={
                              isInf
                                ? 'rounded-xl bg-primary/5 border border-primary/10 p-3'
                                : 'rounded-xl bg-gray-50 border border-gray-100 p-3'
                            }
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div className="h-7 w-7 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                                {avatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={avatar} alt="avatar" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs text-gray-500">@</span>
                                )}
                              </div>
                              <span className="text-sm font-semibold">
                                {isInf ? c.influencer?.name || 'Influencer' : 'User'}
                              </span>
                              {isInf && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                  in-character
                                </span>
                              )}
                              <span className="ml-auto text-[11px] text-gray-500">
                                {new Date(c.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-line">{c.content}</p>
                          </div>
                        );
                      })}

                      <div ref={sentinelRef} className="h-8" />
                      {isValidating && items.length > 0 && (
                        <p className="text-center text-xs text-gray-500">Loading…</p>
                      )}
                    </div>

                    <div className="border-t px-4 py-3">
                      <div className="flex gap-2">
                        <input
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              submit();
                            }
                          }}
                          placeholder="Write a comment…"
                          className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <button
                          onClick={submit}
                          disabled={submitting || !input.trim()}
                          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-secondary disabled:opacity-50"
                        >
                          {submitting ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500">
                        Tip: press Enter to send.
                      </p>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
