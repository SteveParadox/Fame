import React from 'react';

/**
 * A minimalist skeleton component used to indicate that data is loading.
 * It uses Tailwind classes to animate a pulsing placeholder.
 */
const SkeletonCard: React.FC = () => {
  return (
    <div className="animate-pulse bg-[#0F172A] border border-gray-700 rounded-xl p-4 space-y-2">
      <div className="h-4 bg-gray-700 rounded w-3/4"></div>
      <div className="h-3 bg-gray-700 rounded w-1/2"></div>
    </div>
  );
};

export default SkeletonCard;