import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildInfluencer, getTaskStatus } from "../lib/api";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Loader2,
  Palette,
  MessageSquare,
  Target,
  Wand2,
  RefreshCw,
  ArrowRight,
  Settings2,
  X,
} from "lucide-react";

type Provider = "mock" | "ollama";
type Vibe =
  | "wholesome"
  | "savage"
  | "educational"
  | "drama"
  | "professional"
  | "chaotic";

const NICHES = [
  "Fashion",
  "Tech",
  "Gaming",
  "Wellness",
  "Comedy",
  "Crypto",
  "Music",
  "Art",
  "Business",
  "Sports",
  "Food",
  "Travel",
  "Education",
  "Science",
] as const;

const VIBES: { key: Vibe; label: string; desc: string }[] = [
  { key: "wholesome", label: "Wholesome", desc: "Positive, uplifting, family-friendly" },
  { key: "savage", label: "Savage", desc: "Witty, roast-heavy, no filter" },
  { key: "educational", label: "Educational", desc: "Informative, detailed, expert" },
  { key: "drama", label: "Drama", desc: "Entertaining, controversial, bold" },
  { key: "professional", label: "Professional", desc: "Polished, corporate, authoritative" },
  { key: "chaotic", label: "Chaotic", desc: "Unpredictable, meme-heavy, fun" },
];

const CONTENT_PILLARS = [
  "Tutorials",
  "Behind the Scenes",
  "Q&A",
  "Reviews",
  "Trends",
  "Storytelling",
  "News",
  "Opinions",
  "Challenges",
  "Collaborations",
] as const;

type BuildResult = {
  name: string;
  bio: string;
  lore?: string;
  tone_guide?: string;
  content_pillars?: string[];
};

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export default function CreateInfluencerPage() {
  // wizard
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // core inputs
  const [niche, setNiche] = useState<string>("");
  const [vibe, setVibe] = useState<Vibe | "">("");
  const [frequency, setFrequency] = useState<number>(3);
  const [selectedPillars, setSelectedPillars] = useState<string[]>([]);

  // advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [provider, setProvider] = useState<Provider>("mock");
  const [model, setModel] = useState("llama3");
  const [useSeed, setUseSeed] = useState(false);
  const [seed, setSeed] = useState<number>(123456);

  // build state
  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // progress
  const [progressPct, setProgressPct] = useState(0);
  const [progressStage, setProgressStage] = useState<string>("");

  const [progressLog, setProgressLog] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const steps = useMemo(
    () => [
      { id: 1, title: "Choose Niche", icon: Target },
      { id: 2, title: "Set Vibe", icon: Palette },
      { id: 3, title: "Content Pillars", icon: MessageSquare },
      { id: 4, title: "Preview & Launch", icon: Sparkles },
    ],
    []
  );

  const canProceed = useCallback(() => {
    if (step === 1) return niche.trim().length > 0;
    if (step === 2) return vibe !== "";
    if (step === 3) return selectedPillars.length >= 2;
    return true;
  }, [step, niche, vibe, selectedPillars.length]);

  const togglePillar = (pillar: string) => {
    setSelectedPillars((prev) =>
      prev.includes(pillar) ? prev.filter((p) => p !== pillar) : [...prev, pillar]
    );
  };

  const resetBuild = () => {
    setTaskId(null);
    setResult(null);
    setLoading(false);
    setError(null);
    setProgressPct(0);
    setProgressStage("");
    setProgressLog([]);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  const startBuild = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    setProgressPct(0);
    setProgressStage("queued");
    setProgressLog(["Queued build task..."]);

    try {
      const res = await buildInfluencer({
        niche: niche.trim(),
        vibe: vibe || "wholesome",
        posting_frequency: frequency,
        llm_provider: provider,
        llm_model: provider === "ollama" ? model : undefined,
        seed: useSeed ? seed : undefined,
        // NOTE: backend may ignore this. Safe to send only if supported.
        content_pillars: selectedPillars.length ? selectedPillars : undefined,
      } as any);

      const id = res.data.task_id as string;
      setTaskId(id);
      setProgressPct(1);
      setProgressStage("starting");
      setProgressLog((prev) => [...prev, "Starting build…"].slice(-10));
    } catch (e: any) {
      setError("Failed to start build.");
      setLoading(false);
    }
  };

  // SSE stream
  useEffect(() => {
    if (!taskId) return;

    // clean old stream
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);
    esRef.current = es;

    const pushLog = (msg: string) =>
      setProgressLog((prev) => [...prev, msg].slice(-10));

    const onProgress = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);

        // accept both schemas: {pct, stage, message} OR {progress, stage, message}
        const pct =
          typeof data.pct === "number"
            ? data.pct
            : typeof data.progress === "number"
            ? data.progress
            : null;

        if (typeof pct === "number") setProgressPct(Math.max(0, Math.min(100, pct)));
        if (data.stage) setProgressStage(String(data.stage));
        if (data.message) pushLog(String(data.message));
      } catch {
        // ignore
      }
    };

    const onDone = (evt: MessageEvent) => {
      onProgress(evt);
      setProgressPct(100);
      setProgressStage("done");
      pushLog("Build complete ✅");
      // do not setResult here because some backends send done without payload
      es.close();
    };

    const onErrorEvent = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        setError(data.message || "Build failed");
      } catch {
        setError("Build failed");
      }
      setLoading(false);
      es.close();
    };

    es.addEventListener("build.progress", onProgress as any);
    es.addEventListener("build.done", onDone as any);
    es.addEventListener("build.error", onErrorEvent as any);

    es.onerror = () => {
      pushLog("Realtime stream lost. Falling back to polling...");
      // keep polling effect alive, don’t hard-fail here.
    };

    return () => {
      es.close();
    };
  }, [taskId]);

  // Polling fallback / completion fetch
  useEffect(() => {
    if (!taskId) return;

    const interval = setInterval(async () => {
      try {
        const res = await getTaskStatus(taskId);
        const st = res.data.status;

        if (st === "success") {
          setResult(res.data.result as BuildResult);
          setLoading(false);
          setTaskId(null);
          setProgressPct(100);
          setProgressStage("done");
        } else if (st === "error" || st === "failed") {
          setError(res.data.message || "Build failed");
          setLoading(false);
          setTaskId(null);
        } else {
          // optionally mirror polling progress if backend provides it
          if (typeof res.data.pct === "number") setProgressPct(res.data.pct);
          if (res.data.stage) setProgressStage(res.data.stage);
        }
      } catch {
        setError("Failed to fetch build status");
        setLoading(false);
        setTaskId(null);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [taskId]);

  // UI helpers
  const StepIcon = (steps.find((s) => s.id === step)?.icon || Sparkles) as any;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-2">
          Create AI Influencer
        </h1>
        <p className="text-muted-foreground">
          Design a persona with voice, focus, and content pillars. Then let the machines do the rest.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card p-4 border border-rose-500/20">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-rose-300">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="p-2 rounded-lg hover:bg-white/5 text-muted-foreground"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Progress nav */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {steps.map((s, index) => {
          const Icon = s.icon;
          const active = step >= s.id;
          return (
            <div key={s.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all ${
                  active ? "bg-sapphire-500/15 text-sapphire-400" : "bg-white/5 text-muted-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">{s.title}</span>
              </div>
              {index < steps.length - 1 && (
                <ChevronRight className="w-4 h-4 text-muted-foreground mx-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Main card */}
      <div className="glass-card p-6 sm:p-8">
        {/* Live build status (shows on any step if running) */}
        {loading && (taskId || progressStage) && (
          <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-sapphire-400" />
                <p className="text-sm font-semibold text-foreground">Building…</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {progressStage || "starting"} • {Math.round(progressPct)}%
              </p>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-sapphire-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(3, progressPct))}%` }}
              />
            </div>
            {progressLog.length > 0 && (
              <div className="mt-3 space-y-1">
                {progressLog.slice().reverse().map((msg, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground">
                    • {msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                Influencer created!
              </h2>
              <p className="text-muted-foreground">
                Meet <span className="text-sapphire-400 font-medium">{result.name}</span>.
              </p>
            </div>

            <div className="glass-card-light p-6">
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-full bg-gradient-sapphire flex items-center justify-center text-midnight text-3xl font-bold">
                  {result.name?.[0] || "A"}
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <h3 className="text-2xl font-display font-bold text-foreground">{result.name}</h3>
                    <p className="text-sapphire-400">
                      {niche || "General"} • {vibe || "wholesome"} • {frequency} posts/day
                    </p>
                  </div>

                  <p className="text-sm text-muted-foreground">{result.bio}</p>

                  {result.content_pillars?.length ? (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Content pillars</p>
                      <div className="flex flex-wrap gap-2">
                        {result.content_pillars.slice(0, 8).map((p) => (
                          <span key={p} className="badge-luxury">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {result.tone_guide ? (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Tone guide</p>
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap">{result.tone_guide}</p>
                    </div>
                  ) : null}

                  {result.lore ? (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Lore</p>
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap">{result.lore}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  resetBuild();
                  setStep(1);
                }}
                className="flex-1 btn-outline-luxury justify-center"
              >
                <RefreshCw className="w-4 h-4" />
                Create another
              </button>

              <button
                type="button"
                onClick={() => (window.location.href = "/")}
                className="flex-1 btn-luxury justify-center"
              >
                Go to Feed
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={resetBuild}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear result
              </button>
            </div>
          </div>
        )}

        {/* Wizard steps (hide when result exists) */}
        {!result && (
          <>
            {step === 1 && (
              <div className="space-y-6 animate-fade-in">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sapphire-500/15 flex items-center justify-center mx-auto mb-3">
                    <StepIcon className="w-6 h-6 text-sapphire-400" />
                  </div>
                  <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                    What’s the niche?
                  </h2>
                  <p className="text-muted-foreground">Pick one. Humans love categories.</p>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {NICHES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNiche(n)}
                      className={`p-4 rounded-xl text-sm font-medium transition-all ${
                        niche === n
                          ? "bg-sapphire-500 text-midnight"
                          : "bg-white/5 text-foreground hover:bg-white/10 border border-white/10"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                <div className="pt-2">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Or type a custom niche
                  </label>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder="e.g. Football"
                    className="input-luxury w-full"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6 animate-fade-in">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sapphire-500/15 flex items-center justify-center mx-auto mb-3">
                    <Palette className="w-6 h-6 text-sapphire-400" />
                  </div>
                  <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                    What’s the vibe?
                  </h2>
                  <p className="text-muted-foreground">Choose the tone your users will blame you for later.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {VIBES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setVibe(v.key)}
                      className={`p-4 rounded-xl text-left transition-all ${
                        vibe === v.key
                          ? "bg-sapphire-500/15 border border-sapphire-500/30"
                          : "bg-white/5 border border-white/10 hover:border-white/20"
                      }`}
                    >
                      <p className={`font-medium ${vibe === v.key ? "text-sapphire-400" : "text-foreground"}`}>
                        {v.label}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">{v.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10">
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Posting frequency (per day)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={frequency}
                      onChange={(e) => setFrequency(parseInt(e.target.value, 10))}
                      className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-sapphire-500"
                    />
                    <span className="w-12 text-center font-medium text-foreground">{frequency}</span>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6 animate-fade-in">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sapphire-500/15 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="w-6 h-6 text-sapphire-400" />
                  </div>
                  <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                    Content pillars
                  </h2>
                  <p className="text-muted-foreground">Pick at least 2. Otherwise it’s just vibes and no plan.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {CONTENT_PILLARS.map((pillar) => (
                    <button
                      key={pillar}
                      type="button"
                      onClick={() => togglePillar(pillar)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        selectedPillars.includes(pillar)
                          ? "bg-sapphire-500 text-midnight"
                          : "bg-white/5 text-foreground hover:bg-white/10 border border-white/10"
                      }`}
                    >
                      {selectedPillars.includes(pillar) ? "✓ " : ""}
                      {pillar}
                    </button>
                  ))}
                </div>

                <p className="text-center text-sm text-muted-foreground">
                  Selected: {selectedPillars.length} / 2 minimum
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6 animate-fade-in">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sapphire-500/15 flex items-center justify-center mx-auto mb-3">
                    <Wand2 className="w-6 h-6 text-sapphire-400" />
                  </div>
                  <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                    Preview & launch
                  </h2>
                  <p className="text-muted-foreground">
                    This is where you click a button and pretend you’re not amazed by electricity.
                  </p>
                </div>

                <div className="glass-card-light p-6 space-y-4">
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-muted-foreground">Niche</span>
                    <span className="font-medium text-foreground">{niche || "General"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-muted-foreground">Vibe</span>
                    <span className="font-medium text-foreground capitalize">{vibe || "wholesome"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-muted-foreground">Posts/day</span>
                    <span className="font-medium text-foreground">{frequency}</span>
                  </div>

                  <div className="py-2">
                    <span className="text-muted-foreground block mb-2">Selected pillars</span>
                    <div className="flex flex-wrap gap-2">
                      {selectedPillars.map((p) => (
                        <span key={p} className="badge-luxury">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Advanced */}
                  <div className="pt-4 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Settings2 className="w-4 h-4" />
                      Advanced
                    </button>

                    {showAdvanced && (
                      <div className="mt-4 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-2">Provider</label>
                            <select
                              value={provider}
                              onChange={(e) => setProvider(e.target.value as Provider)}
                              className="input-luxury w-full"
                            >
                              <option value="mock" className="bg-midnight">
                                Mock (offline/dev)
                              </option>
                              <option value="ollama" className="bg-midnight">
                                Ollama (local LLM)
                              </option>
                            </select>
                          </div>

                          {provider === "ollama" ? (
                            <div>
                              <label className="block text-sm text-muted-foreground mb-2">Ollama model</label>
                              <input
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                placeholder="llama3"
                                className="input-luxury w-full"
                              />
                              <p className="text-xs text-muted-foreground mt-2">
                                Make sure Ollama is running (usually localhost:11434).
                              </p>
                            </div>
                          ) : (
                            <div className="hidden sm:block" />
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="text-sm text-muted-foreground">Deterministic seed</label>
                          <input
                            type="checkbox"
                            checked={useSeed}
                            onChange={(e) => setUseSeed(e.target.checked)}
                          />
                        </div>

                        {useSeed && (
                          <input
                            type="number"
                            min={0}
                            max={2147483647}
                            value={seed}
                            onChange={(e) => setSeed(parseInt(e.target.value || "0", 10))}
                            className="input-luxury w-full"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 btn-outline-luxury justify-center"
                    disabled={loading}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={startBuild}
                    className="flex-1 btn-luxury justify-center disabled:opacity-50"
                    disabled={loading || !niche || !vibe || selectedPillars.length < 2}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-5 h-5" />
                        Generate Influencer
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Navigation */}
            {!result && (
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}
                  disabled={step === 1 || loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>

                {step < 4 ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => ((s + 1) as any))}
                    disabled={!canProceed() || loading}
                    className="flex items-center gap-2 btn-luxury disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => (window.location.href = "/")}
                    className="flex items-center gap-2 btn-outline-luxury"
                    disabled={loading}
                  >
                    Skip for now
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
