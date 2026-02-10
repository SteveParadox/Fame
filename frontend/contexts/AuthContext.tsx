import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getMe, logout as apiLogout } from '../lib/api';

interface AuthContextProps {
  isAuthed: boolean;
  user: { id: number; email: string; onboarding_completed?: boolean } | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextProps>({
  isAuthed: false,
  user: null,
  login: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [user, setUser] = useState<{ id: number; email: string; onboarding_completed?: boolean } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const authed = !!token;
    setIsAuthed(authed);
    if (authed) {
      getMe()
        .then((res) => setUser(res.data))
        .catch(() => setUser(null));
    }
  }, []);

  const login = (token: string) => {
    localStorage.setItem('access_token', token);
    setIsAuthed(true);
    getMe()
      .then((res) => setUser(res.data))
      .catch(() => setUser(null));
  };

  const logout = () => {
    // Best-effort revoke refresh session on backend
    apiLogout().catch(() => {});
    localStorage.removeItem('access_token');
    setIsAuthed(false);
    setUser(null);
    router.push('/login');
  };

  return <AuthContext.Provider value={{ isAuthed, user, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);