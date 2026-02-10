import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '../lib/api';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await requestPasswordReset(email);
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not request reset');
    }
  };

  return (
    <div className="mt-10 mx-auto max-w-md bg-white p-6 rounded-lg shadow-md">
      <h1 className="text-2xl font-bold text-center mb-4">Reset password</h1>
      {error && <p className="text-red-500 mb-3 text-center">{error}</p>}
      {done ? (
        <p className="text-sm text-gray-700 text-center">
          If that email exists, you'll get a reset link shortly.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 px-4 bg-primary hover:bg-secondary text-white rounded-md"
          >
            Send reset link
          </button>
        </form>
      )}
      <p className="text-sm text-center mt-4">
        <Link href="/login" className="text-primary hover:text-secondary">
          Back to login
        </Link>
      </p>
    </div>
  );
};

export default ForgotPasswordPage;
