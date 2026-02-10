// pages/login.tsx
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Shield,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

import { login, resendVerification } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

type ApiErr = {
  response?: {
    status?: number;
    data?: { detail?: unknown; message?: unknown };
  };
  message?: string;
};

function getErrorMessage(err: ApiErr): { message: string; needsVerify: boolean } {
  const status = err?.response?.status;
  const detailRaw = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;

  const detail = typeof detailRaw === "string" ? detailRaw : JSON.stringify(detailRaw ?? "");

  // Your original logic, but less brittle.
  const notVerified =
    status === 403 &&
    /not verified|unverified|verify/i.test(detail);

  if (notVerified) {
    return { message: "Email not verified. Check your inbox.", needsVerify: true };
  }

  if (status === 423) {
    return { message: "Too many attempts. Account temporarily locked.", needsVerify: false };
  }

  if (status === 429) {
    return { message: "Too many requests. Slow down a bit.", needsVerify: false };
  }

  // Common auth failures
  if (status === 401 || status === 400) {
    return { message: "Invalid credentials. Please try again.", needsVerify: false };
  }

  return { message: "Login failed. Please try again.", needsVerify: false };
}

const LoginPage: React.FC = () => {
  const router = useRouter();
  const { login: setAuthToken } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const features = useMemo(
    () => [
      { icon: Sparkles, label: "AI-Powered", desc: "Create unique personas" },
      { icon: TrendingUp, label: "Trade", desc: "Buy & sell tokens" },
      { icon: Shield, label: "Secure", desc: "Enterprise-grade safety" },
    ],
    []
  );

  const canResend = email.trim().length > 3 && email.includes("@");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setError(null);
    setNeedsVerify(false);
    setIsLoading(true);

    try {
      const response = await login(email.trim(), password);
      const token =
        response?.data?.access_token ??
        response?.data?.token ??
        response?.access_token;

      if (!token || typeof token !== "string") {
        setError("Login succeeded but no token was returned. Fix your API response.");
        return;
      }

      setAuthToken(token);

      const next =
        typeof router.query.next === "string" ? router.query.next : "/";
      await router.push(next);
    } catch (err) {
      const parsed = getErrorMessage(err as ApiErr);
      setError(parsed.message);
      setNeedsVerify(parsed.needsVerify);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (isResending || !canResend) return;

    setError(null);
    setIsResending(true);

    try {
      await resendVerification(email.trim());
      setError("Verification email resent. Check your inbox (and spam, because email is cursed).");
    } catch {
      setError("Could not resend verification email.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Left Side - Branding */}
        <div className="hidden lg:flex flex-col items-start space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-sapphire flex items-center justify-center animate-pulse-glow">
                <Zap className="w-7 h-7 text-midnight" />
              </div>
              <span className="font-display font-bold text-3xl text-foreground">
                FameForge
              </span>
            </div>

            <h1 className="text-4xl xl:text-5xl font-display font-bold leading-tight">
              Welcome back to the{" "}
              <span className="gradient-text-sapphire">future of influence</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-md">
              Create AI personas, discover trending creators, and trade social tokens in one
              powerful platform.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 w-full max-w-md">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index} className="glass-card p-4 text-center card-hover">
                  <Icon className="w-6 h-6 text-sapphire-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="glass-card p-8 sm:p-10">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-sapphire flex items-center justify-center">
              <Zap className="w-6 h-6 text-midnight" />
            </div>
            <span className="font-display font-bold text-2xl text-foreground">FameForge</span>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2">
              Sign in to your account
            </h2>
            <p className="text-muted-foreground">Enter your credentials to access the platform</p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-luxury pl-12 w-full"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-luxury pl-12 pr-12 w-full"
                  required
                  minLength={6}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-sapphire-500 focus:ring-sapphire-500/20"
                />
                <span className="text-sm text-muted-foreground">Remember me</span>
              </label>

              <Link
                href="/forgot-password"
                className="text-sm text-sapphire-400 hover:text-sapphire-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-luxury justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Verification resend */}
          {needsVerify && (
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || !canResend}
              className="w-full mt-4 px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={!canResend ? "Enter your email first" : undefined}
            >
              {isResending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Resending…
                </span>
              ) : (
                "Resend verification email"
              )}
            </button>
          )}

          <div className="mt-8 text-center">
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href="/signup"
                className="text-sapphire-400 hover:text-sapphire-300 font-medium transition-colors"
              >
                Create one
              </Link>
            </p>
          </div>

          {/* Social Login (UI only) */}
          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-midnight px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                // hook this to real OAuth later
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="text-sm">Google</span>
              </button>

              <button
                type="button"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                // hook this to real OAuth later
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="text-sm">GitHub</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
