"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { parseJsonResponse } from "@/lib/api/json-response";

type DriveStatus = {
  oauthConfigured: boolean;
  oauthConnected: boolean;
  oauthRedirectUri: string;
  oauthSetupRedirectUris: string[];
  needsEnvRefreshToken?: boolean;
  oauthNeedsReconnect?: boolean;
  preferOAuth?: boolean;
  tokenPersistence?: string;
  impersonation: boolean;
};

function OAuthSetupInstructions({
  status,
  envFileLabel,
}: {
  status: DriveStatus | null;
  envFileLabel: string;
}) {
  const setupUris = status?.oauthSetupRedirectUris ?? [];

  return (
    <div className="text-ex-muted space-y-2">
      <p>
        In Google Cloud Console → Credentials → your OAuth 2.0 Web client →{" "}
        <strong>Authorized redirect URIs</strong>, add every environment you use (same client):
      </p>
      {setupUris.length > 0 ? (
        <ul className="list-inside list-disc text-xs">
          {setupUris.map((uri) => (
            <li key={uri}>
              <code className="break-all">{uri}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {!status?.oauthRedirectUri ? (
        <p className="text-xs">
          Set <code>GOOGLE_OAUTH_REDIRECT_URI</code> (or <code>NEXT_PUBLIC_APP_URL</code>) in{" "}
          {envFileLabel} for this deployment — e.g. production:{" "}
          <code>https://your-domain.com/api/integrations/google-drive/callback</code>
        </p>
      ) : null}
      <p>
        Add to <code>{envFileLabel}</code> for this deployment (must match the URL above):
      </p>
      {status?.oauthRedirectUri ? (
        <pre className="bg-ex-surface-2 overflow-x-auto rounded-md p-3 text-xs">
          {`GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=${status.oauthRedirectUri}`}
        </pre>
      ) : null}
      <p>Enable Drive API. Add your Gmail as a test user if the app is in Testing mode.</p>
    </div>
  );
}

export default function GoogleDriveIntegrationPage() {
  return (
    <Suspense fallback={<p className="text-ex-muted text-sm">Loading…</p>}>
      <GoogleDriveIntegrationContent />
    </Suspense>
  );
}

function GoogleDriveIntegrationContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const connected = searchParams.get("connected") === "1";
  const error = searchParams.get("error");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/integrations/google-drive/status");
        const parsed = await parseJsonResponse<{
          success?: boolean;
          oauthConfigured?: boolean;
          oauthConnected?: boolean;
          oauthRedirectUri?: string;
          oauthSetupRedirectUris?: string[];
          needsEnvRefreshToken?: boolean;
          oauthNeedsReconnect?: boolean;
          preferOAuth?: boolean;
          tokenPersistence?: string;
          impersonation?: boolean;
        }>(res);
        const data = parsed.data;
        if (data?.success) {
          setStatus({
            oauthConfigured: data.oauthConfigured ?? false,
            oauthConnected: data.oauthConnected ?? false,
            oauthRedirectUri: data.oauthRedirectUri ?? "",
            oauthSetupRedirectUris: data.oauthSetupRedirectUris ?? [],
            needsEnvRefreshToken: data.needsEnvRefreshToken,
            oauthNeedsReconnect: data.oauthNeedsReconnect,
            preferOAuth: data.preferOAuth,
            tokenPersistence: data.tokenPersistence,
            impersonation: data.impersonation ?? false,
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [connected]);

  // Keep UI stable right after OAuth callback even if status recheck is momentarily delayed.
  const isConnected = connected || status?.oauthConnected || status?.impersonation || false;

  return (
    <div className="space-y-8">

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {loading ? (
            <p className="text-ex-muted">Checking…</p>
          ) : (
            <>
              <p>
                Status:{" "}
                <span className={isConnected ? "text-green-600" : "text-amber-600"}>
                  {isConnected ? "Ready" : "Not connected"}
                </span>
              </p>

              {connected ? (
                <p className="text-green-600">
                  Connected. Employee document uploads will use your Gmail storage.
                </p>
              ) : null}

              {status?.needsEnvRefreshToken ? (
                <div className="border-ex-border bg-ex-surface-2 space-y-2 rounded-md border p-3 text-xs">
                  <p className="font-medium text-amber-700">Vercel: set refresh token in env</p>
                  <p className="text-ex-muted">
                    Production cannot keep tokens on disk. Connect locally (<code>npm run dev</code>
                    ), open <code>.data/google-drive-oauth.json</code>, copy{" "}
                    <code>refresh_token</code> into Vercel as{" "}
                    <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>, then redeploy.
                  </p>
                </div>
              ) : null}
              {status?.oauthNeedsReconnect ? (
                <div className="border-ex-border bg-ex-surface-2 space-y-2 rounded-md border p-3 text-xs">
                  <p className="font-medium text-amber-700">Google reconnect required</p>
                  <p className="text-ex-muted">
                    Saved OAuth token is no longer valid. Click{" "}
                    <strong>Connect Google Drive</strong> to refresh access, then replace{" "}
                    <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> in Vercel and redeploy.
                  </p>
                </div>
              ) : null}

              {error ? (
                <div className="space-y-2 text-red-600">
                  <p>Failed: {decodeURIComponent(error)}</p>

                  {error.includes("missing_code") && (
                    <p className="text-ex-muted text-sm">
                      Finish the full flow: click Connect → Continue on Google → Allow. Do not open
                      the callback URL directly.
                    </p>
                  )}

                  {/redirect_uri/i.test(error) ? (
                    <div className="text-ex-muted border-ex-border mt-2 border-t pt-3">
                      <OAuthSetupInstructions
                        status={status}
                        envFileLabel="production env / .env.local"
                      />
                    </div>
                  ) : null}

                  {/Vercel|GOOGLE_OAUTH_REFRESH_TOKEN|ENOENT|EROFS/i.test(error) ? (
                    <p className="text-ex-muted text-sm">
                      On Vercel, add <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> from a local Connect
                      (see warning above). Deploy the latest app code, then retry.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!status?.oauthConfigured ? (
                <OAuthSetupInstructions status={status} envFileLabel=".env.local" />
              ) : !isConnected ? (
                <a href="/api/integrations/google-drive/connect">
                  <Button type="button">Connect Google Drive</Button>
                </a>
              ) : (
                <p className="text-ex-muted">
                  Your HRM folder stays private. Only this app uploads as you.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
