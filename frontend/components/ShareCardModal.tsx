import { Dialog, Transition } from '@headlessui/react';
import { Fragment, useMemo, useRef, useState } from 'react';
import { sharePost } from '../lib/api';
import { ArrowDownTrayIcon, LinkIcon, XMarkIcon } from '@heroicons/react/24/solid';

type SharePost = {
  id: number;
  content: string;
  created_at: string;
  influencer: { id: number; name: string; niche: string; style: string; avatar_url?: string | null };
};

export default function ShareCardModal({
  open,
  onClose,
  post,
}: {
  open: boolean;
  onClose: () => void;
  post: SharePost;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const link = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/?post=${post.id}`;
  }, [post.id]);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // record a share on backend (badges/xp)
      await sharePost(post.id).catch(() => null);
      const html2canvas = (await import('html2canvas')).default;
      const node = ref.current;
      if (!node) return;
      const canvas = await html2canvas(node, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `fameforge_post_${post.id}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await sharePost(post.id).catch(() => null);
    await navigator.clipboard?.writeText(link);
  };

  return (
    <Transition appear show={open} as={Fragment}>
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

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-100">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <Dialog.Title className="text-sm font-extrabold text-gray-900">
                    Share Card
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-xl border border-gray-200 hover:border-gray-300"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-700" />
                  </button>
                </div>

                <div className="p-5">
                  {/* Card preview */}
                  <div
                    ref={ref}
                    className="rounded-2xl overflow-hidden border border-gray-100 shadow-[0_14px_40px_-26px_rgba(0,0,0,0.35)]"
                    style={{ width: '100%' }}
                  >
                    <div className="p-6 bg-gradient-to-br from-primary via-purple-600 to-secondary text-white">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-white/20 overflow-hidden flex items-center justify-center">
                          {post.influencer.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={post.influencer.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-bold">@</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold truncate">{post.influencer.name}</div>
                          <div className="text-[11px] opacity-90 truncate">{post.influencer.niche} • {post.influencer.style}</div>
                        </div>
                        <div className="ml-auto text-[10px] font-extrabold tracking-widest opacity-90">
                          FAMEFORGE
                        </div>
                      </div>

                      <div className="mt-5 text-[16px] leading-relaxed whitespace-pre-line font-semibold">
                        {post.content}
                      </div>

                      <div className="mt-6 flex items-center justify-between text-[11px] opacity-90">
                        <span>{new Date(post.created_at).toLocaleDateString()}</span>
                        <span>Own the clout. Forge the arc.</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row gap-2">
                    <button
                      disabled={busy}
                      onClick={download}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-semibold hover:bg-gray-800 disabled:opacity-60"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" /> Download PNG
                    </button>
                    <button
                      onClick={copy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:border-gray-300"
                    >
                      <LinkIcon className="h-5 w-5" /> Copy link
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-gray-500">
                    Tip: sharing feeds the streak, badges, and XP loop. Yes, we’re exploiting your brain’s reward circuitry.
                  </p>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
