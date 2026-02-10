import { useEffect, useState } from 'react';
import { listSessions, revokeSession, logoutAll, logout } from '../lib/api';

type Session = {
  id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  user_agent?: string;
  ip?: string;
  is_revoked: boolean;
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const resp = await listSessions();
      setSessions(resp.data || []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRevoke(id: string) {
    try {
      await revokeSession(id);
      await load();
    } catch {}
  }

  async function handleLogoutAll() {
    await logoutAll();
    await load();
  }

  async function handleLogout() {
    await logout();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Sessions</h1>
          <p className="text-gray-600 mt-1">Manage logged-in devices. Revoke anything you don’t recognize.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleLogoutAll}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition"
          >
            Logout all devices
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
          >
            Logout
          </button>
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4">{err}</div>}

      {loading ? (
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-5 border border-gray-100">No sessions found.</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="bg-white rounded-xl shadow p-5 border border-gray-100">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{s.user_agent || 'Unknown device'}</div>
                  <div className="text-sm text-gray-600 mt-1">IP: {s.ip || 'unknown'}</div>
                  <div className="text-sm text-gray-600">Last used: {new Date(s.last_used_at).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Expires: {new Date(s.expires_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  {s.is_revoked ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-700">Revoked</span>
                  ) : (
                    <button
                      onClick={() => handleRevoke(s.id)}
                      className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
