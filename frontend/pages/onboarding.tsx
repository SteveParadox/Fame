import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  completeOnboarding,
  followInfluencer,
  getOnboardingStatus,
  getOnboardingSuggestions,
  previewInfluencer,
  buildInfluencer,
  unfollowInfluencer,
  updateOnboardingPreferences,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Sparkles,
  Palette,
  UserPlus,
  Loader2,
} from "lucide-react";

const NICHES = [
  "Fitness", "Crypto", "Anime", "Football", "Comedy",
  "AI", "Fashion", "Music", "Gaming", "Movies", "Business", "Motivation",
];

const MODES = ["wholesome", "savage", "educational", "drama"] as const;
type Mode = (typeof MODES)[number];

type Step = 1 | 2 | 3;

type Suggestion = {
  id: number;
  name: string;
  niche?: string;
  style?: string;
  bio?: string;
  followers?: string | number;
};

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthed, user } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [selectedModes, setSelectedModes] = useState<Mode[]>(["wholesome"]);

  // Step 2
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [followedCount, setFollowedCount] = useState(0);
  const [followedIds, setFollowedIds] = useState<Set<number>>(new Set());

  // Step 3
  const [creatorNiche, setCreatorNiche] = useState("");
  const [creatorVibe, setCreatorVibe] = useState<Mode>("wholesome");
  const [creatorFreq, setCreatorFreq] = useState(3);

  const [preview, setPreview] = useState<any | null>(null);
  const [previewSeed, setPreviewSeed] = useState<number | null>(null);

  const [buildTaskId, setBuildTaskId] = useState<string | null>(null);
  const [buildPct, setBuildPct] = useState<number>(0);
  const [buildStage, setBuildStage] = useState<string>("");
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

  // Redirect if already completed
  useEffect(() => {
    if (!isAuthed) return;
    if (user?.onboarding_completed) router.replace("/");
  }, [isAuthed, user, router]);

  // Hydrate status
  useEffect(() => {
    if (!isAuthed) return;

    getOnboardingStatus()
      .then((res) => {
        const d = res.data || {};
        setSelectedNiches(d.preferred_niches || []);
        setSelectedModes((d.preferred_styles || ["wholesome"]) as Mode[]);
        setFollowedCount(d.followed_count || 0);

        // Pick next step based on backend
        const next = d.next_action;
        if (next === "pick_preferences") setStep(1);
        else if (next === "follow_influencers") setStep(2);
        else if (next === "create_influencer") setStep(3);
      })
      .catch(() => {
        // silent
      });
  }, [isAuthed]);

  // Load suggestions on step 2
  useEffect(() => {
    if (!isAuthed || step !== 2) return;

    setLoading(true);
    setError(null);

    getOnboardingSuggestions(24)
      .then((res) => setSuggestions(res.data || []))
      .catch(() => setError("Could not load suggestions"))
      .finally(() => setLoading(false));
  }, [isAuthed, step]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  const steps = useMemo(
    () => [
      { id: 1 as const, title: "Pick your vibes", icon: Palette },
      { id: 2 as const, title: "Follow creators", icon: UserPlus },
      { id: 3 as const, title: "Forge your influencer", icon: Sparkles },
    ],
    []
  );

  const toggleNiche = (niche: string) => {
    setSelectedNiches((prev) =>
      prev.includes(niche) ? prev.filter((n) => n !== niche) : [...prev, niche]
    );
  };

  const toggleMode = (m: Mode) => {
    setSelectedModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  };

  const refreshFollowedCount = async () => {
    try {
      const res = await getOnboardingStatus();
      setFollowedCount(res.data.followed_count || 0);
    } catch {
      // ignore
    }
  };

  const onFollow = async (infId: number) => {
    // optimistic UI
    setFollowedIds((prev) => {
      const n = new Set(prev);
      n.add(infId);
      return n;
    });

    try {
      await followInfluencer(infId);
      await refreshFollowedCount();
    } catch {
      // rollback
      setFollowedIds((prev) => {
        const n = new Set(prev);
        n.delete(infId);
        return n;
      });
    }
  };

  const onUnfollow = async (infId: number) => {
    // optimistic
    setFollowedIds((prev) => {
      const n = new Set(prev);
      n.delete(infId);
      return n;
    });

    try {
      await unfollowInfluencer(infId);
      await refreshFollowedCount();
    } catch {
      // rollback
      setFollowedIds((prev) => {
        const n = new Set(prev);
        n.add(infId);
        return n;
      });
    }
  };

  const savePreferencesAndNext = async () => {
    if (selectedNiches.length === 0) {
      setError("Pick at least one niche.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await updateOnboardingPreferences({
        preferred_niches: selectedNiches,
        preferred_styles: selectedModes,
      });
      setStep(2);
    } catch {
      setError("Failed to save preferences.");
    } finally {
      setLoading(false);
    }
  };

  const nextFromFollows = () => {
    if (followedCount < 3) {
      setError("Follow at least 3 creators to tune your feed.");
      return;
    }
    setError(null);
    setStep(3);
  };

  const runPreview = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await previewInfluencer({
        niche: creatorNiche || selectedNiches[0] || "General",
        vibe: creatorVibe,
        posting_frequency: clampInt(creatorFreq, 1, 20),
      });
      setPreview(res.data.spec);
      setPreviewSeed(res.data.seed);
      setBuildTaskId(null);
      setBuildPct(0);
      setBuildStage("");
      setBuildLog([]);
    } catch {
      setError("Preview failed. Try a different niche or provider.");
    } finally {
      setLoading(false);
    }
  };

  const startBuild = async () => {
    if (!preview) {
      setError("Generate a preview first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await buildInfluencer({
        niche: creatorNiche || selectedNiches[0] || "General",
        vibe: creatorVibe,
        posting_frequency: clampInt(creatorFreq, 1, 20),
        seed: previewSeed || undefined,
      });

      const taskId = res.data.task_id as string;
      setBuildTaskId(taskId);
      setBuildPct(5);
      setBuildStage("starting");
      setBuildLog(["Starting build…"]);

      // reset/close prior stream
      if (esRef.current) esRef.current.close();

      const es = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);
      esRef.current = es;

      es.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "build.progress") {
            setBuildPct(clampInt(msg.progress || 0, 0, 100));
            setBuildStage(msg.stage || "");
            if (msg.message) {
              setBuildLog((prev) => [msg.message, ...prev].slice(0, 10));
            }
          }
          if (msg.type === "build.done") {
            setBuildPct(100);
            setBuildStage("done");
            setBuildLog((prev) => ["Build complete ✅", ...prev].slice(0, 10));
            es.close();
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        // browser will retry; don't block UI
      };
    } catch {
      setError("Failed to start build.");
    } finally {
      setLoading(false);
    }
  };

  const finishOnboarding = async () => {
    setLoading(true);
    setError(null);

    try {
      await completeOnboarding();
      router.replace("/");
    } catch {
      setError("Could not complete onboarding.");
    } finally {
      setLoading(false);
    }
  };

  const canProceed = useCallback(() => {
    if (step === 1) return selectedNiches.length > 0;
    if (step === 2) return followedCount >= 3;
    return true;
  }, [step, selectedNiches.length, followedCount]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Progress Header */}
      <div className="glass-card mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-sapphire-600/20 to-sapphire-800/20 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-1">
                Welcome to FameForge
              </h1>
              <p className="text-muted-foreground text-sm">
                Three quick steps to personalize your experience
              </p>
            </div>
            <Sparkles className="w-8 h-8 text-sapphire-400" />
          </div>

          <div className="flex gap-2">
            {steps.map((s, index) => {
              const Icon = s.icon;
              return (
                <div key={s.id} className="flex-1">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      step >= s.id ? "bg-sapphire-500" : "bg-white/10"
                    }`}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                        step >= s.id
                          ? "bg-sapphire-500 text-midnight"
                          : "bg-white/10 text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {step > s.id ? <CheckCircle className="w-4 h-4" /> : index + 1}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span
                        className={`text-xs font-medium truncate ${
                          step >= s.id ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {s.title}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="glass-card p-6 sm:p-8">
        {error && (
          <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                What do you want on your feed?
              </h2>
              <p className="text-muted-foreground">
                Pick a few niches. We’ll tune your recommendations immediately.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">Select niches</h3>
              <div className="flex flex-wrap gap-2">
                {NICHES.map((n) => {
                  const active = selectedNiches.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleNiche(n)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                        active
                          ? "bg-sapphire-500 text-midnight"
                          : "bg-white/5 text-foreground hover:bg-white/10 border border-white/10"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">
                Content styles you enjoy
              </h3>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => {
                  const active = selectedModes.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMode(m)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 capitalize ${
                        active
                          ? "bg-sapphire-500 text-midnight"
                          : "bg-white/5 text-foreground hover:bg-white/10 border border-white/10"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
              >
                Skip
              </button>

              <button
                type="button"
                onClick={savePreferencesAndNext}
                disabled={loading || selectedNiches.length === 0}
                className="flex items-center gap-2 btn-luxury disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                  Follow at least 3 creators
                </h2>
                <p className="text-muted-foreground">
                  This seeds your Following tab and improves recommendations.
                </p>
              </div>

              <div className="text-right">
                <span
                  className={`text-2xl font-bold ${
                    followedCount >= 3 ? "text-emerald-400" : "text-foreground"
                  }`}
                >
                  {followedCount}
                </span>
                <span className="text-muted-foreground"> / 3</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading suggestions…
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {suggestions.map((creator) => {
                  const isFollowed = followedIds.has(creator.id);
                  return (
                    <div
                      key={creator.id}
                      className={`p-4 rounded-xl border transition-all duration-300 ${
                        isFollowed
                          ? "bg-sapphire-500/10 border-sapphire-500/30"
                          : "bg-white/5 border-white/10 hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-gradient-sapphire flex items-center justify-center text-midnight font-bold">
                            {String(creator.name || "?")[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{creator.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {creator.niche} • {creator.style}
                              {creator.followers ? ` • ${creator.followers}` : ""}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            isFollowed ? onUnfollow(creator.id) : onFollow(creator.id)
                          }
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                            isFollowed
                              ? "bg-sapphire-500 text-midnight"
                              : "bg-white/10 text-foreground hover:bg-white/20"
                          }`}
                        >
                          {isFollowed ? "Following" : "Follow"}
                        </button>
                      </div>

                      {creator.bio ? (
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                          {creator.bio}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <button
                type="button"
                onClick={nextFromFollows}
                disabled={!canProceed()}
                className="flex items-center gap-2 btn-luxury disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                Forge your first influencer
              </h2>
              <p className="text-muted-foreground">Preview first. Launch when it feels right.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Niche
                  </label>
                  <input
                    type="text"
                    value={creatorNiche}
                    onChange={(e) => setCreatorNiche(e.target.value)}
                    placeholder={selectedNiches[0] || "e.g. Fashion"}
                    className="input-luxury w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Vibe
                  </label>
                  <select
                    value={creatorVibe}
                    onChange={(e) => setCreatorVibe(e.target.value as Mode)}
                    className="input-luxury w-full"
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m} className="bg-midnight">
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Posting frequency (per day)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={creatorFreq}
                    onChange={(e) => setCreatorFreq(parseInt(e.target.value || "1", 10))}
                    className="input-luxury w-full"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={loading}
                    className="flex-1 btn-luxury justify-center disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Preview Persona
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={finishOnboarding}
                    disabled={loading}
                    className="flex-1 btn-outline-luxury justify-center disabled:opacity-50"
                  >
                    Skip for now
                  </button>
                </div>
              </div>

              {/* Right: Preview / Build */}
              <div className="glass-card-light p-6">
                {!preview ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-sapphire-500/20 flex items-center justify-center mx-auto mb-4">
                      <Sparkles className="w-8 h-8 text-sapphire-400" />
                    </div>
                    <p className="text-muted-foreground">
                      Generate a preview to see your influencer before launching.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-xl font-display font-bold text-foreground truncate">
                          {preview.name}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {preview.bio}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        seed: {previewSeed}
                      </div>
                    </div>

                    {Array.isArray(preview.content_pillars) && preview.content_pillars.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          Content pillars
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {preview.content_pillars.slice(0, 6).map((p: string) => (
                            <span key={p} className="badge-luxury">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.starter_arc?.title ? (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          Starter arc
                        </div>
                        <div className="text-sm text-foreground">{preview.starter_arc.title}</div>
                      </div>
                    ) : null}

                    {Array.isArray(preview.starter_posts) && preview.starter_posts.length > 0 ? (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          Starter posts
                        </div>
                        <ul className="space-y-2">
                          {preview.starter_posts.slice(0, 3).map((p: any, idx: number) => (
                            <li key={idx} className="p-3 rounded-xl bg-white/5 border border-white/10">
                              <div className="text-xs text-muted-foreground mb-1">
                                {p.type}
                              </div>
                              <div className="text-sm text-foreground whitespace-pre-wrap">
                                {p.text}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {!buildTaskId ? (
                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={runPreview}
                          disabled={loading}
                          className="flex-1 btn-outline-luxury justify-center disabled:opacity-50"
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={startBuild}
                          disabled={loading}
                          className="flex-1 btn-luxury justify-center disabled:opacity-50"
                        >
                          Launch
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                          <div className="font-semibold text-foreground/90">
                            Building… {buildStage}
                          </div>
                          <div>{buildPct}%</div>
                        </div>

                        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-2 bg-sapphire-500"
                            style={{ width: `${buildPct}%` }}
                          />
                        </div>

                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          {buildLog.map((l, i) => (
                            <div key={i}>• {l}</div>
                          ))}
                        </div>

                        {buildPct >= 100 && (
                          <div className="mt-4 flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-emerald-400 font-semibold">
                              <CheckCircle className="w-5 h-5" /> Ready
                            </div>
                            <button
                              type="button"
                              onClick={finishOnboarding}
                              className="btn-luxury"
                            >
                              Go to Feed
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <button
                type="button"
                onClick={finishOnboarding}
                className="flex items-center gap-2 btn-outline-luxury"
              >
                Finish later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
