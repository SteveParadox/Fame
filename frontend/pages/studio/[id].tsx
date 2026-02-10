import { Dialog, Transition } from '@headlessui/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  commitGeneratedPosts,
  deleteStudioPost,
  generatePostsPreview,
  getCalendar,
  getDrafts,
  getInfluencer,
  regenerateStudioPost,
  updateStudioPost,
} from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

type Post = {
  id: number;
  influencer_id: number;
  content: string;
  mode: string;
  post_type: string;
  status: string;
  created_at: string;
  scheduled_at?: string | null;
  meta?: any;
};

const MODES = ['wholesome', 'savage', 'educational', 'drama'];
const TYPES = ['post', 'thread', 'poll', 'story', 'meme'];

function fmtDate(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function StudioInfluencerPage() {
  const { isAuthed } = useAuth();
  const router = useRouter();
  const id = useMemo(() => Number(router.query.id || 0), [router.query.id]);

  const [tab, setTab] = useState<'drafts' | 'schedule' | 'generate'>('drafts');
  const [loading, setLoading] = useState(true);
  const [inf, setInf] = useState<any | null>(null);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [cal, setCal] = useState<Post[]>([]);

  // editor modal
  const [editing, setEditing] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);

  // generation
  const [genMode, setGenMode] = useState<string>('wholesome');
  const [genCount, setGenCount] = useState<number>(5);
  const [preview, setPreview] = useState<any | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Record<number, boolean>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);

  const loadDrafts = async () => {
    const res = await getDrafts(id);
    setDrafts(res.data || []);
  };

  const loadCalendar = async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    const res = await getCalendar(id, start.toISOString(), end.toISOString());
    setCal(res.data || []);
  };

  useEffect(() => {
    if (!isAuthed) {
      router.push('/login');
      return;
    }
    if (!id) return;
    setLoading(true);
    Promise.all([getInfluencer(id), getDrafts(id)])
      .then(([infRes, draftsRes]) => {
        setInf(infRes.data);
        setDrafts(draftsRes.data || []);
      })
      .catch(() => {
        setInf(null);
        setDrafts([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthed, id]);

  useEffect(() => {
    if (tab === 'schedule' && id) {
      loadCalendar().catch(() => setCal([]));
    }
  }, [tab, id]);

  const openEdit = (p: Post) => setEditing({ ...p });

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateStudioPost(editing.id, {
        content: editing.content,
        mode: editing.mode,
        post_type: editing.post_type,
        scheduled_at: editing.scheduled_at || null,
        status: editing.status,
      });
      await loadDrafts();
      if (tab === 'schedule') await loadCalendar();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (postId: number) => {
    if (!confirm('Delete this draft?')) return;
    await deleteStudioPost(postId);
    await loadDrafts();
    if (tab === 'schedule') await loadCalendar();
  };

  const doRegenerate = async (postId: number) => {
    const res = await regenerateStudioPost(postId);
    // The task will update the DB and publish events; we still refresh drafts after a bit.
    setTimeout(() => loadDrafts().catch(() => {}), 1200);
    alert(`Regeneration started: task ${res.data?.task_id}`);
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await generatePostsPreview(id, { count: genCount, mode: genMode });
      setPreview(res.data);
      const idxMap: Record<number, boolean> = {};
      (res.data?.items || []).forEach((_: any, i: number) => (idxMap[i] = true));
      setSelectedIdx(idxMap);
    } finally {
      setPreviewLoading(false);
    }
  };

  const commitSelected = async (schedule: boolean) => {
    if (!preview) return;
    const items = (preview.items || []).filter((_: any, i: number) => selectedIdx[i]);
    if (items.length === 0) return;
    setCommitLoading(true);
    try {
      const schedule_start = schedule ? new Date().toISOString() : null;
      await commitGeneratedPosts(id, { seed: preview.seed, items, schedule_start });
      setPreview(null);
      await loadDrafts();
      alert('Added to drafts. Now you can edit/schedule like a civilized person.');
    } finally {
      setCommitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="h-6 w-56 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-32 animate-pulse rounded-2xl bg-gray-200" />
      </div>
    );
  }

  if (!inf) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold">Influencer not found</div>
          <Link href="/studio" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
            Back to studio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500">Creator Studio</div>
          <h1 className="text-2xl font-bold tracking-tight">{inf.name}</h1>
          <div className="mt-1 text-sm text-gray-500">
            <span className="font-medium text-gray-700">{inf.niche}</span>
            <span className="mx-2 text-gray-300">•</span>
            <span className="capitalize">{inf.style}</span>
            <span className="mx-2 text-gray-300">•</span>
            <span>{inf.posting_frequency}/day</span>
          </div>
        </div>
        <Link href="/studio" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">
          ← Back
        </Link>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-2 rounded-2xl border bg-white p-2 shadow-sm">
        {([
          ['drafts', 'Drafts'],
          ['schedule', 'Schedule'],
          ['generate', 'Generate'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              tab === k ? 'bg-black text-white shadow' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Drafts */}
      {tab === 'drafts' && (
        <div className="mt-4 space-y-3">
          {drafts.length === 0 ? (
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="text-lg font-semibold">No drafts</div>
              <p className="mt-1 text-sm text-gray-500">
                Generate 5 posts with preview, then edit and schedule them. Your influencer will not magically grow by itself.
              </p>
              <button
                onClick={() => setTab('generate')}
                className="mt-4 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900"
              >
                Generate posts
              </button>
            </div>
          ) : (
            drafts.map((p) => (
              <div key={p.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-700">
                        {p.mode}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                        {p.post_type}
                      </span>
                      {p.scheduled_at ? (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          Scheduled: {fmtDate(p.scheduled_at)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          Not scheduled
                        </span>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-900">{p.content}</p>
                    <div className="mt-2 text-xs text-gray-500">Created: {fmtDate(p.created_at)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button onClick={() => openEdit(p)} className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black">
                      Edit
                    </button>
                    <button onClick={() => doRegenerate(p.id)} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-200">
                      Regenerate
                    </button>
                    <button onClick={() => doDelete(p.id)} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Schedule */}
      {tab === 'schedule' && (
        <div className="mt-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold">Next 14 days</div>
                <p className="mt-1 text-sm text-gray-500">Timeline view. Drag-drop can wait. This already beats chaos.</p>
              </div>
              <button
                onClick={() => loadCalendar().catch(() => {})}
                className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-200"
              >
                Refresh
              </button>
            </div>

            {cal.length === 0 ? (
              <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                No scheduled drafts yet. Go to Drafts, set scheduled time, come back here.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {cal.map((p) => (
                  <div key={p.id} className="rounded-xl border bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{fmtDate(p.scheduled_at || p.created_at)}</div>
                      <button onClick={() => openEdit(p)} className="text-sm text-blue-600 hover:underline">Edit</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-700">{p.mode}</span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">{p.post_type}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-gray-900">{p.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generate */}
      {tab === 'generate' && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Generate drafts (with preview)</div>
                <p className="mt-1 text-sm text-gray-500">Create posts you can edit before scheduling. Control feels good.</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Mode</label>
                <select
                  value={genMode}
                  onChange={(e) => setGenMode(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Count</label>
                <input
                  type="number"
                  value={genCount}
                  min={1}
                  max={20}
                  onChange={(e) => setGenCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => runPreview()}
                  disabled={previewLoading}
                  className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900 disabled:opacity-60"
                >
                  {previewLoading ? 'Generating…' : 'Generate preview'}
                </button>
              </div>
            </div>
          </div>

          {preview && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Preview</div>
                  <p className="mt-1 text-sm text-gray-500">Select what you want. Reject what you don’t. Revolutionary concept.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => commitSelected(false)}
                    disabled={commitLoading}
                    className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-200 disabled:opacity-60"
                  >
                    Add to drafts
                  </button>
                  <button
                    onClick={() => commitSelected(true)}
                    disabled={commitLoading}
                    className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900 disabled:opacity-60"
                  >
                    Add + auto-schedule
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(preview.items || []).map((it: any, i: number) => (
                  <label key={i} className="block rounded-xl border p-4 hover:bg-gray-50">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={!!selectedIdx[i]}
                        onChange={(e) => setSelectedIdx((prev) => ({ ...prev, [i]: e.target.checked }))}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-700">
                            {(it.meta?.mode || genMode) as string}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                            {it.type || 'post'}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{it.text}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit modal */}
      <Transition appear show={!!editing} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setEditing(null)}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 sm:items-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
                  <Dialog.Title className="text-lg font-semibold">Edit Draft</Dialog.Title>
                  <p className="mt-1 text-sm text-gray-500">Change mode, schedule, and content. This is where creators feel in control.</p>

                  {editing && (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Mode</label>
                          <select
                            value={editing.mode}
                            onChange={(e) => setEditing((p) => (p ? { ...p, mode: e.target.value } : p))}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          >
                            {MODES.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Type</label>
                          <select
                            value={editing.post_type}
                            onChange={(e) => setEditing((p) => (p ? { ...p, post_type: e.target.value } : p))}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          >
                            {TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Schedule (optional)</label>
                          <input
                            type="datetime-local"
                            value={editing.scheduled_at ? new Date(editing.scheduled_at).toISOString().slice(0, 16) : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditing((p) => (p ? { ...p, scheduled_at: v ? new Date(v).toISOString() : null } : p));
                            }}
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Content</label>
                        <textarea
                          value={editing.content}
                          onChange={(e) => setEditing((p) => (p ? { ...p, content: e.target.value } : p))}
                          rows={8}
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <button
                          onClick={() => setEditing(null)}
                          className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit()}
                          disabled={saving}
                          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gray-900 disabled:opacity-60"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
