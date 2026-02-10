import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/Navbar';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

const publicRoutes = ['/login', '/signup'];

function AppContent({ Component, pageProps }: AppProps) {
  const { isAuthed, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const path = router.pathname;
    const isPublic = publicRoutes.includes(path);
    if (!isPublic && !isAuthed) {
      router.push('/login');
    }
    if (isPublic && isAuthed && (path === '/login' || path === '/signup')) {
      router.push('/');
    }

    // First-time user flow: force onboarding until completed
    if (
      isAuthed &&
      user &&
      user.onboarding_completed === false &&
      path !== '/onboarding'
    ) {
      router.push('/onboarding');
    }
  }, [isAuthed, user, router]);

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-6">
        <Component {...pageProps} />
      </main>
    </>
  );
}

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <AppContent Component={Component} pageProps={pageProps} />
    </AuthProvider>
  );
}

export default MyApp;