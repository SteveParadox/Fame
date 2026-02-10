import { useEffect, useMemo, useRef, useState } from "react";
import InfluencerCard from "../components/InfluencerCard";
import SkeletonCard from "../components/SkeletonCard";
import { getRecommendedInfluencers, searchInfluencers } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Search, Filter as FilterIcon, Sparkles, X } from "lucide-react";

interface Influencer {
  id: number;
  name: string;
  bio: string;
  niche: string;
  style: string;
}

const nicheOptions = ["Football", "Crypto", "Anime", "Comedy", "Fitness", "Tech"];
const styleOptions = ["wholesome", "savage", "educational", "drama", "professional", "chaotic"];

const SORT_OPTIONS = [
  { key: "popularity" as const, label: "Popular" },
  { key: "new" as const, label: "New" },
];

export default function DiscoverPage() {
  const { isAuthed } = useAuth();

  const [q, setQ] = useState("");
  const [niche, setNiche] = useState<string>("");
  const [style, setStyle] = useState<string>("");
  const [sort, setSort] = useState<"popularity" | "new">("popularity");

  const [results, setResults] = useState<Influencer[]>([]);
  const [recommended, setRecommended] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<any>(null);

  const hasFilters = useMemo(() => Boolean(q || niche || style), [q, niche, style]);

  const runSearch = async () => {
    setLoading(true);
    try {
      const res = await searchInfluencers({
        q: q || undefined,
        niche: niche || undefined,
        style: style || undefined,
        sort,
        limit: 24,
      });
      setResults(res.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Debounce searches so the UI doesn't feel like a broken slot machine.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runSearch, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, niche, style, sort]);

  useEffect(() => {
    if (!isAuthed) {
      setRecommended([]);
      return;
    }
    getRecommendedInfluencers(8)
      .then((r) => setRecommended(r.data || []))
      .catch(() => setRecommended([]));
  }, [isAuthed]);

  const clearAll = () => {
    setQ("");
    setNiche("");
    setStyle("");
    setSort("popularity");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground">
          Discover
        </h1>
        <p className="text-muted-foreground">
          Find influencers by niche, vibe, and whatever chaos you’re in the mood for.
        </p>
      </div>

      {/* Search + Primary Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names, bios..."
              className="input-luxury pl-12 w-full"
            />
          </div>

          {/* Selects */}
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="input-luxury py-3"
            >
              <option value="" className="bg-midnight">All niches</option>
              {nicheOptions.map((n) => (
                <option key={n} value={n} className="bg-midnight">
                  {n}
                </option>
              ))}
            </select>

            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="input-luxury py-3"
            >
              <option value="" className="bg-midnight">All vibes</option>
              {styleOptions.map((s) => (
                <option key={s} value={s} className="bg-midnight">
                  {s}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`p-3 rounded-xl transition-all ${
                showFilters
                  ? "bg-sapphire-500/15 text-sapphire-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
              type="button"
              aria-label="Toggle filters"
            >
              <FilterIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Advanced (Sort + Clear) */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort:</span>
              <div className="flex gap-2">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSort(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      sort === opt.key
                        ? "bg-sapphire-500 text-midnight"
                        : "bg-white/5 text-foreground hover:bg-white/10"
                    }`}
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sm:ml-auto flex items-center gap-2">
              <button
                onClick={clearAll}
                className="btn-outline-luxury text-sm px-3 py-2"
                type="button"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recommended */}
      {isAuthed && recommended.length > 0 && !hasFilters && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sapphire-400" />
              Recommended for you
            </h2>
            <span className="text-sm text-muted-foreground">Based on your follows and vibes</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommended.map((inf) => (
              <InfluencerCard key={inf.id} influencer={inf} />
            ))}
          </div>
        </section>
      )}

      {/* Browse */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-display font-semibold text-foreground">
            Browse influencers
          </h2>
          <span className="text-sm text-muted-foreground">
            {loading ? "Searching…" : `${results.length} results`}
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Search className="w-12 h-12 text-sapphire-400 mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No influencers match your filters.</p>
            <button
              onClick={clearAll}
              className="mt-4 text-sapphire-400 hover:text-sapphire-300 text-sm font-medium"
              type="button"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((inf) => (
              <InfluencerCard key={inf.id} influencer={inf} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
