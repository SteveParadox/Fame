import React from 'react';
import type { IconType } from 'react-icons';

/**
 * A card component for displaying simple statistics with an icon, label,
 * value, and optional subtitle. Designed with a dark theme and gold accent.
 */
interface StatCardProps {
  /** An icon component from react-icons to visually represent the metric. */
  icon?: IconType;
  /** Descriptive label for the metric. */
  label: string;
  /** Metric value to display. */
  value: React.ReactNode;
  /** Optional subtext, e.g., unit or additional context. */
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, sub }) => {
  return (
    <div className="flex items-center gap-4 bg-[#1E293B] border border-gray-700 rounded-2xl p-4 shadow">
      {Icon ? (
        <div className="flex-shrink-0 text-amber-400 text-xl">
          <Icon />
        </div>
      ) : null}
      <div>
        <div className="text-gray-300 text-sm capitalize">{label}</div>
        <div className="text-white font-semibold text-2xl leading-none mt-1">{value}</div>
        {sub && <div className="text-gray-500 text-xs mt-0.5">{sub}</div>}
      </div>
    </div>
  );
};

export default StatCard;