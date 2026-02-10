import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { verifyEmail, resendVerification } from '../lib/api';

const VerifyEmailPage: React.FC = () => {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const email = typeof router.query.email === 'string' ? router.query.email : '';
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('Verifying...');

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setStatus('error');
      setMessage('Missing token.');
      return;
    }
    (async () => {
      try {
        await verifyEmail(token);
        setStatus('ok');
        setMessage('Email verified. You can log in now.');
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.response?.data?.detail || 'Verification failed');
      }
    })();
  }, [router.isReady, token]);

  const handleResend = async () => {
    try {
      if (!email) {
        setMessage('Add ?email=you@example.com to resend.');
        return;
      }
      await resendVerification(email);
      setMessage('Verification email resent.');
    } catch {
      setMessage('Could not resend verification email.');
    }
  };

  return (
    <div className="mt-10 mx-auto max-w-md bg-white p-6 rounded-lg shadow-md space-y-3">
      <h1 className="text-2xl font-bold text-center">Verify Email</h1>
      <p className={status === 'error' ? 'text-red-600' : 'text-gray-700'}>{message}</p>
      {status === 'ok' && (
        <Link href="/login" className="block text-center text-primary hover:text-secondary">
          Go to login
        </Link>
      )}
      {status === 'error' && (
        <button
          type="button"
          onClick={handleResend}
          className="w-full py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-md"
        >
          Resend verification email
        </button>
      )}
    </div>
  );
};

export default VerifyEmailPage;
