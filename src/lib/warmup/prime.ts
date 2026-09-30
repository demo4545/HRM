import { getAdminFirestore } from "@/lib/firebase/admin";
import { getNetworkAccessSettings } from "@/lib/network-access/repository";

/**
 * Cheap keep-alive for serverless cold starts.
 * Exactly 2 Firestore document reads, 0 writes — safe for free-tier quotas.
 */
export async function primeServerHotPath(): Promise<{
  ok: true;
  durationMs: number;
  firestoreReads: 2;
  firestoreWrites: 0;
  networkRestrictionEnabled: boolean;
}> {
  const started = Date.now();

  // Init Admin SDK + TLS, then the two docs login / network gate also touch.
  const [, settings] = await Promise.all([
    getAdminFirestore().collection("employees").doc("meta").get(),
    getNetworkAccessSettings(),
  ]);

  return {
    ok: true,
    durationMs: Date.now() - started,
    firestoreReads: 2,
    firestoreWrites: 0,
    networkRestrictionEnabled: settings.restrictionEnabled,
  };
}
