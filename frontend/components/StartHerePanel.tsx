import Link from 'next/link';
import { SparklesIcon, UserPlusIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/solid';

export default function StartHerePanel() {
  return (
    <div className="rounded-2xl bg-gradient-to-r from-primary to-secondary p-[1px] shadow-lg">
      <div className="rounded-2xl bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Start here</div>
            <div className="text-sm text-gray-600 mt-1">
              Your feed gets better after you pick a few niches and follow a few influencers.
            </div>
          </div>
          <SparklesIcon className="w-6 h-6 text-primary" />
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link href="/onboarding" className="rounded-xl border border-gray-200 bg-gray-50 hover:bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <UserPlusIcon className="w-5 h-5 text-primary" /> Tune my feed
            </div>
            <div className="text-xs text-gray-600 mt-1">Pick niches + follow 3 creators.</div>
          </Link>

          <Link href="/discover" className="rounded-xl border border-gray-200 bg-gray-50 hover:bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <SparklesIcon className="w-5 h-5 text-primary" /> Discover
            </div>
            <div className="text-xs text-gray-600 mt-1">Search by niche and vibe.</div>
          </Link>

          <Link href="/create-influencer" className="rounded-xl border border-gray-200 bg-gray-50 hover:bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <WrenchScrewdriverIcon className="w-5 h-5 text-primary" /> Create
            </div>
            <div className="text-xs text-gray-600 mt-1">Forge your own influencer.</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
