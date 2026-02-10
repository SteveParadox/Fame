import { useState } from 'react';
import { likePost, unlikePost, commentOnPost } from '../lib/api';
import { HeartIcon, ChatBubbleOvalLeftIcon } from '@heroicons/react/24/solid';

interface Post {
  id: number;
  influencer_id: number;
  content: string;
  created_at: string;
  scheduled_at?: string | null;
}

interface PostCardProps {
  post: Post;
  influencerName: string;
  refresh?: () => void;
}

const PostCard: React.FC<PostCardProps> = ({ post, influencerName, refresh }) => {
  const [isLiking, setIsLiking] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);

  const handleLike = async () => {
    setIsLiking(true);
    try {
      await likePost(post.id);
      refresh?.();
    } catch (err) {
      // If already liked, unlike
      await unlikePost(post.id);
      refresh?.();
    } finally {
      setIsLiking(false);
    }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    try {
      await commentOnPost(post.id, comment.trim());
      setComment('');
      setError(null);
      refresh?.();
    } catch (err) {
      setError('Failed to comment');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-5 mb-6 border border-gray-100">
      <div className="mb-2 flex justify-between items-center">
        <span className="font-semibold text-primary">{influencerName}</span>
        <span className="text-xs text-gray-500">{new Date(post.created_at).toLocaleString()}</span>
      </div>
      <p className="text-gray-800 whitespace-pre-line mb-4">{post.content}</p>
      <div className="flex items-center space-x-6">
        <button
          onClick={handleLike}
          disabled={isLiking}
          className="flex items-center space-x-1 text-gray-600 hover:text-primary"
        >
          <HeartIcon className="h-5 w-5" />
          <span>Like</span>
        </button>
        <button
          onClick={() => setShowCommentBox((prev) => !prev)}
          className="flex items-center space-x-1 text-gray-600 hover:text-primary"
        >
          <ChatBubbleOvalLeftIcon className="h-5 w-5" />
          <span>Comment</span>
        </button>
      </div>
      {showCommentBox && (
        <div className="mt-3">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Write a comment..."
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary"
          />
          {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
          <div className="flex justify-end mt-1">
            <button
              onClick={handleComment}
              className="bg-primary text-white px-3 py-1 rounded-md text-sm hover:bg-secondary"
            >
              Post
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PostCard;