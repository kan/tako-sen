/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** "1" signs in a test account on a dev server; see src/ui/auth.ts. */
  readonly VITE_AUTH_BYPASS?: string;
}
