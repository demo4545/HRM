"use client";

import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiResponseErrorMessage, parseJsonResponse } from "@/lib/api/json-response";
import { setAbsenceGateSessionHint } from "@/lib/attendance/absence-gate-session";
import { useCompanyBranding } from "@/lib/branding/use-company-branding";
import { fetchPublicIpv4FromBrowser } from "@/lib/network-access/ip";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageFallback() {
  return (
    <div className="bg-ex-bg flex min-h-screen items-center justify-center px-4 py-12">
      <p className="text-ex-muted text-sm">Loading…</p>
    </div>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const fromRaw = searchParams.get("from") ?? "/dashboard";
  const from = fromRaw.startsWith("/") && !fromRaw.startsWith("//") ? fromRaw : "/dashboard";
  const { branding } = useCompanyBranding();
  const companyName = branding.companyName.trim();
  const workspaceLabel = companyName ? `${companyName}'s Internal Workspace` : "Internal Workspace";
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      // On localhost the server cannot see your public IP; send it from the browser.
      // On live (Vercel) the server already has x-forwarded-for — skip the slow ipify round-trip.
      let publicIp = "";
      const host = window.location.hostname;
      const isLocalHost =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local");
      if (isLocalHost) {
        try {
          publicIp = await fetchPublicIpv4FromBrowser();
        } catch {
          // Gate still runs with whatever the server can detect.
        }
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login, password, publicIp: publicIp || undefined }),
      });

      const parsed = await parseJsonResponse<{
        error?: string;
        ok?: boolean;
        networkAllowed?: boolean;
      }>(res);
      if (parsed.invalid || parsed.empty) {
        setError(apiResponseErrorMessage(res, parsed, "Sign-in failed"));
        setPending(false);
        return;
      }
      if (!res.ok || !parsed.data?.ok) {
        setError(parsed.data?.error ?? "Sign-in failed");
        setPending(false);
        return;
      }
      const data = parsed.data;
      if (data.networkAllowed === false) {
        window.location.assign("/network-blocked");
        return;
      }
      // Punch-desk gates (absence / morning) sync after navigation via DashboardShell.
      // Do not block sign-in on those checks — clears any stale "must punch" hint.
      setAbsenceGateSessionHint(false);
      window.location.assign(from);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      setError(message);
      setPending(false);
    }
  }

  return (
    <div className="bg-ex-bg relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="from-ex-secondary/8 pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] via-transparent to-transparent"
      />
      <Card className="border-ex-border relative z-10 w-full max-w-md shadow-lg dark:shadow-none">
        <CardHeader className="space-y-4 py-8 text-center">
          {branding.hasLogo ? <BrandLogo size="lg" priority className="mx-auto" /> : null}
          <div>
            <CardTitle className="text-xl">Sign in to HRM Admin</CardTitle>
            <CardDescription className="text-ex-muted">{workspaceLabel}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="space-y-2 text-left">
              <Label htmlFor="login">Email or Username</Label>
              <Input
                id="login"
                value={login}
                required
                onChange={(e) => setLogin(e.target.value)}
                placeholder="Enter username or email"
              />
            </div>
            <div className="space-y-2 text-left">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter your password"
              />
            </div>
            {error ? (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
