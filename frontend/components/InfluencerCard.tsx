import Link from 'next/link';
import { UserGroupIcon } from '@heroicons/react/24/solid';

interface Influencer {
  id: number;
  name: string;
  bio: string;
  niche: string;
  style: string;
  lore?: string | null;
}

export default function InfluencerCard({ influencer }: { influencer: Influencer }) {
  return (
    <Link href={`/influencers/${influencer.id}`}>
      <div className="group cursor-pointer bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-lg transition-shadow p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary transition-colors">
              {influencer.name}
            </h3>
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{influencer.bio}</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <UserGroupIcon className="h-4 w-4" />
            <span>...</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 text-primary border border-indigo-100">
            {influencer.niche}
          </span>
          <span className="px-2 py-1 rounded-full text-xs bg-orange-50 text-secondary border border-orange-100">
            {influencer.style}
          </span>
        </div>
        {influencer.lore ? (
          <p className="mt-4 text-xs text-gray-500 line-clamp-2">{influencer.lore}</p>
        ) : null}
      </div>
    </Link>
  );
}
