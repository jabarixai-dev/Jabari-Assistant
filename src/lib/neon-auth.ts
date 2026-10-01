import {
  createInternalNeonAuth,
  createAuthClient,
} from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;

export const neonAuth = authUrl
  ? createInternalNeonAuth(authUrl, {
      adapter: BetterAuthReactAdapter(),
    })
  : null;

export const neonAuthClient = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthReactAdapter(),
    })
  : null;

export function requireNeonAuth() {
  if (!neonAuth) {
    throw new Error(
      "Neon Auth is not configured. Set VITE_NEON_AUTH_URL for the Jabari Assistant frontend."
    );
  }

  return neonAuth;
}

export async function getNeonAuthToken() {
  const auth = requireNeonAuth();
  return auth.getJWTToken();
}

export function requireNeonAuthClient() {
  if (!neonAuthClient) throw new Error("Neon Auth is not configured.")
  return neonAuthClient
}
