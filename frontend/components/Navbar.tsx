import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';

import { useAuth } from '../contexts/AuthContext';
import {
  getEventsUrl,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  getLoopsStatus,
} from '../lib/api';
import {
  HomeIcon,
  PlusCircleIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  BellIcon,
  ArrowsRightLeftIcon,
  PencilSquareIcon,
  FireIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid';

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

type Notif = { id: number; type: string; message: string; createdAt: number; is_read: boolean };

const Navbar: React.FC = () => {
  const { isAuthed, user, logout } = useAuth();
  const router = useRouter();
  const path = router.pathname;

  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [toast, setToast] = useState<Notif | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const { data: gami } = useSWR(
    isAuthed ? 'loopsStatus' : null,
    async () => {
      const r = await getLoopsStatus();
      return r.data;
    },
    { revalidateOnFocus: false, refreshInterval: 30000 }
  );
  const prevBadgeCount = useRef<number>(0);

  // Show toast when a new badge is earned
  useEffect(() => {
    const c = Array.isArray(gami?.badges) ? gami.badges.length : 0;
    if (c > 0 && prevBadgeCount.current && c > prevBadgeCount.current) {
      const newest = gami.badges[c - 1];
      const n: Notif = {
        id: Math.floor(Date.now()),
        type: 'badge',
        message: `Badge unlocked: ${newest.icon || '🏅'} ${newest.name}`,
        createdAt: Date.now(),
        is_read: false,
      };
      setToast(n);
      window.setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 2800);
    }
    prevBadgeCount.current = c;
  }, [gami]);

  // Load initial notifications
  useEffect(() => {
    if (!isAuthed) return;
    Promise.all([getNotifications({ unread_only: true, limit: 15 }), getUnreadCount()])
      .then(([listRes, countRes]) => {
        const items = (listRes.data || []).map((n: any) => ({
          id: Number(n.id),
          type: n.type,
          message: n.message,
          createdAt: n.created_at ? new Date(n.created_at).getTime() : Date.now(),
          is_read: !!n.is_read,
        }));
        setNotifs(items);
        setUnreadCount(Number(countRes.data?.unread_count || items.length));
      })
      .catch(() => {
        setNotifs([]);
        setUnreadCount(0);
      });
  }, [isAuthed]);

  // Real-time notification stream via EventSource
  useEffect(() => {
    if (!isAuthed || !user) return;
    const es = new EventSource(getEventsUrl());
    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || data.user_id !== user.id) return;
        const nid = Number(data.notification_id || 0);
        const n: Notif = {
          id: nid || Math.floor(Date.now()),
          type: data.type || 'notify',
          message: data.message || 'New activity',
          createdAt: Date.now(),
          is_read: false,
        };
        setNotifs((prev) => {
          if (nid && prev.some((p) => p.id === nid)) return prev;
          return [n, ...prev].slice(0, 15);
        });
        setUnreadCount((c) => c + 1);
        setToast(n);
        window.setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 3000);
      } catch {
        return;
      }
    };
    es.addEventListener('notify.trending', handle);
    es.addEventListener('notify.reply_spike', handle);
    es.addEventListener('notify.big_buy', handle);
    return () => {
      try {
        es.close();
      } catch {
        /* no-op */
      }
    };
  }, [isAuthed, user?.id]);

  const markAllRead = async () => {
    try {
      await markAllNotificationsRead();
    } catch {}
    setNotifs([]);
    setUnreadCount(0);
  };

  const markOneRead = async (notificationId: number) => {
    if (!notificationId) return;
    try {
      await markNotificationRead(notificationId);
    } catch {}
    setNotifs((prev) => prev.filter((n) => n.id !== notificationId));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const navItems = [
    { name: 'Home', href: '/', icon: HomeIcon },
    { name: 'Discover', href: '/discover', icon: MagnifyingGlassIcon },
    { name: 'Market', href: '/market', icon: ArrowsRightLeftIcon },
    { name: 'Dashboard', href: '/dashboard', icon: ChartBarIcon },
    { name: 'Studio', href: '/studio', icon: PencilSquareIcon },
    { name: 'Create', href: '/create-influencer', icon: PlusCircleIcon },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#0F172A] text-gray-200 shadow-xl border-b border-gray-700 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-2 text-2xl font-bold text-amber-400">
              <span>FameForge</span>
            </Link>
            <div className="hidden md:flex space-x-6">
              {navItems
                .filter((i) => {
                  if (i.href === '/create-influencer' || i.href === '/dashboard' || i.href === '/studio') return isAuthed;
                  return true;
                })
                .map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={classNames(
                      'flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-md transition-colors',
                      path === item.href
                        ? 'text-amber-400'
                        : 'text-gray-300 hover:text-amber-300'
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.name}</span>
                  </Link>
                ))}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {isAuthed ? (
              <>
                {/* Streak + Level pill */}
                <div
                  title="Your daily streak and level. Humans love numbers that go up."
                  className="hidden sm:inline-flex items-center gap-2 rounded-full bg-[#1E293B] border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300"
                >
                  <FireIcon className="h-5 w-5 text-amber-400" />
                  <span>{gami?.current_streak ?? 0}</span>
                  <span className="text-gray-500">•</span>
                  <SparklesIcon className="h-5 w-5 text-amber-400" />
                  <span>Lv {gami?.level ?? 1}</span>
                </div>
                {/* Notifications */}
                <Menu as="div" className="relative inline-block text-left">
                  <div>
                    <Menu.Button className="relative inline-flex items-center justify-center rounded-md bg-[#1E293B] bg-opacity-60 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-opacity-80 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <BellIcon className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] text-[#0F172A]">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </Menu.Button>
                  </div>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-80 origin-top-right rounded-md bg-[#1E293B] text-gray-200 shadow-lg ring-1 ring-gray-700 focus:outline-none">
                      <div className="px-4 py-3 border-b border-gray-700">
                        <p className="text-sm font-semibold text-gray-100">Notifications</p>
                        <p className="text-xs text-gray-400">Live events for your influencers</p>
                      </div>
                      <div className="max-h-72 overflow-auto">
                        {notifs.length === 0 ? (
                          <div className="px-4 py-6 text-sm text-gray-500">No notifications yet.</div>
                        ) : (
                          notifs.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => markOneRead(n.id)}
                              className="w-full text-left px-4 py-3 border-b border-gray-700 last:border-b-0 hover:bg-[#0F172A]"
                            >
                              <div className="text-sm font-medium text-gray-100">{n.message}</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="px-4 py-2">
                        <Link
                          href="/notifications"
                          className="mb-2 block w-full rounded-md bg-[#0F172A] border border-gray-700 px-3 py-2 text-center text-sm text-gray-200 hover:bg-[#16213A]"
                        >
                          View all
                        </Link>
                        <button
                          type="button"
                          onClick={() => markAllRead()}
                          className="w-full rounded-md bg-[#0F172A] border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-[#16213A]"
                        >
                          Mark all read
                        </button>
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
                {/* Account menu */}
                <Menu as="div" className="relative inline-block text-left">
                  <div>
                    <Menu.Button className="inline-flex w-full justify-center rounded-md bg-[#1E293B] bg-opacity-60 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-opacity-80 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      Menu
                      <ChevronDownIcon className="-mr-1 ml-2 h-5 w-5" aria-hidden="true" />
                    </Menu.Button>
                  </div>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-40 origin-top-right rounded-md bg-[#1E293B] text-gray-200 shadow-lg ring-1 ring-gray-700 focus:outline-none">
                      <div className="py-1">
                        <Menu.Item>
                          {({ active }) => (
                            <Link
                              href="/sessions"
                              className={classNames(
                                active ? 'bg-[#0F172A] text-gray-100' : 'text-gray-200',
                                'block w-full px-4 py-2 text-left text-sm'
                              )}
                            >
                              Sessions
                            </Link>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              type="button"
                              onClick={() => logout()}
                              className={classNames(
                                active ? 'bg-[#0F172A] text-gray-100' : 'text-gray-200',
                                'block w-full px-4 py-2 text-left text-sm'
                              )}
                            >
                              Sign out
                            </button>
                          )}
                        </Menu.Item>
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </>
            ) : (
              <div className="space-x-4">
                <Link href="/login" className="text-sm font-medium text-gray-300 hover:text-amber-300">
                  Login
                </Link>
                <Link href="/signup" className="text-sm font-medium text-gray-300 hover:text-amber-300">
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-20 z-50 max-w-sm rounded-xl bg-[#1E293B] bg-opacity-90 p-4 text-gray-200 shadow-xl ring-1 ring-gray-700 backdrop-blur">
          <div className="text-sm font-semibold">Notification</div>
          <div className="text-sm mt-1">{toast.message}</div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;