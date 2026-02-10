import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { resetPassword } from '../lib/api';

const ResetPasswordPage: React.FC = () => {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setError('Missing token');
    }
  }, [router.isReady, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (pw !== pw2) {
      setError('Passwords do not match');
      return;
    }
    try {
      await resetPassword(token, pw);
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not reset password');
    }
  };

  return (
    <div className="mt-10 mx-auto max-w-md bg-white p-6 rounded-lg shadow-md">
      <h1 className="text-2xl font-bold text-center mb-4">Choose a new password</h1>
      {error && <p className="text-red-500 mb-3 text-center">{error}</p>}
      {done ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-700 text-center">Password updated. You can log in now.</p>
          <Link href="/login" className="block text-center text-primary hover:text-secondary">
            Go to login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">New password</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Confirm password</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary"
            />
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-primary hover:bg-secondary text-white rounded-md">
            Reset password
          </button>
        </form>
      )}
    </div>
  );
};

export default ResetPasswordPage;
