import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import {
  getInfluencer,
  getFeed,
  followInfluencer,
  unfollowInfluencer,
  updateReplyMode,
} from '../../lib/api';
import PostCard from '../../components/PostCard';
import SkeletonCard from '../../components/SkeletonCard';
import { UserPlusIcon, UserMinusIcon } from '@heroicons/react/24/solid';

const InfluencerDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const influencerId = parseInt(id as string, 10);

  const [influencer, setInfluencer] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [followed, setFollowed] = useState(false);
  const [replyMode, setReplyMode] = useState('wholesome');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    async function fetchData() {
      try {
        const res = await getInfluencer(influencerId);
        setInfluencer(res.data);
        setReplyMode(res.data.reply_mode || 'wholesome');
        // Fetch posts and filter by influencer
        const feedRes = await getFeed(0, 20, false);
        const filtered = feedRes.data.filter((p: any) => p.influencer_id === influencerId);
        setPosts(filtered);
        // Determine if current user follows: naive approach by checking if we get 204 from unfollow; assume not followed at start
        setFollowed(false);
      } catch (err) {
        setError('Failed to load influencer');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [router.isReady, influencerId]);

  const toggleFollow = async () => {
    try {
      if (followed) {
        await unfollowInfluencer(influencerId);
      } else {
        await followInfluencer(influencerId);
      }
      setFollowed(!followed);
    } catch (err) {
      // ignore errors
    }
  };

  const handleReplyModeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value;
    try {
      await updateReplyMode(influencerId, newMode);
      setReplyMode(newMode);
    } catch (err) {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (error) return <p className="text-center mt-8 text-red-500">{error}</p>;
  if (!influencer) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold mb-2">{influencer.name}</h1>
        <p className="text-gray-700 mb-1">{influencer.bio}</p>
        {influencer.lore && <p className="text-sm text-gray-500 mb-2">Lore: {influencer.lore}</p>}
        <div className="flex items-center space-x-4 mt-4">
          <button
            onClick={toggleFollow}
            className={`flex items-center space-x-1 px-3 py-1 rounded-md text-sm text-white transition-all ${
              followed
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary hover:bg-secondary'
            }`}
          >
            {followed ? <UserMinusIcon className="h-4 w-4" /> : <UserPlusIcon className="h-4 w-4" />}
            <span>{followed ? 'Unfollow' : 'Follow'}</span>
          </button>
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-700">Reply Mode:</label>
            <select
              value={replyMode}
              onChange={handleReplyModeChange}
              className="rounded-md border-gray-300 focus:border-primary focus:ring-primary text-sm"
            >
              <option value="wholesome">Wholesome</option>
              <option value="savage">Savage</option>
              <option value="educational">Educational</option>
              <option value="drama">Drama</option>
            </select>
          </div>
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-semibold mb-4">Recent Posts</h2>
        {posts.length > 0 ? (
          posts.map((post) => (
            <PostCard key={post.id} post={post} influencerName={influencer.name} refresh={undefined} />
          ))
        ) : (
          <p className="text-gray-500">No posts available.</p>
        )}
      </div>
    </div>
  );
};

export default InfluencerDetailPage;