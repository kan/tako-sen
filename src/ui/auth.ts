import {
  computed,
  defineComponent,
  h,
  ref,
  type App,
  type PropType,
  type Ref,
} from "vue";
import {
  clerkPlugin,
  Show as ClerkShow,
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
  useAuth as useClerkAuth,
} from "@clerk/vue";
import { bypassToken, isBypassAccount } from "../core/auth-bypass";

/**
 * The one place the screens get sign-in state from. It wraps Clerk today, so
 * replacing the provider (kan/tako-sen#7) touches only this file.
 *
 * It also holds the login bypass for auditing signed-in screens locally:
 * `npm run dev:roji:bypass` sets VITE_AUTH_BYPASS, and only a dev server
 * (import.meta.env.DEV) honours it, so a production build never signs anyone
 * in this way. `?as=dev-<name>` picks the test account.
 */
export const authBypass =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === "1";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export const onlineAuthEnabled = authBypass || Boolean(clerkKey);

export interface OnlineAuth {
  readonly userId: Ref<string | null>;
  readonly isLoaded: Ref<boolean>;
  readonly isSignedIn: Ref<boolean>;
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

/** Sets up the provider; the bypass needs none, so Clerk is not loaded then. */
export function installAuth(app: App): void {
  if (clerkKey && !authBypass)
    app.use(clerkPlugin, { publishableKey: clerkKey });
}

const BYPASS_KEY = "tako-sen.auth-bypass-account";
const SIGNED_OUT_KEY = "tako-sen.auth-bypass-signed-out";

function storage<T>(use: (store: Storage) => T, fallback: T): T {
  try {
    return use(sessionStorage);
  } catch {
    // Without storage the state lasts until the page is reloaded.
    return fallback;
  }
}

/** The tab's test account: ?as= picks it, and it outlives in-app navigation. */
function bypassAccount(): string {
  const stored = storage((store) => store.getItem(BYPASS_KEY), null);
  return isBypassAccount(stored) ? stored : "dev-player";
}

/**
 * Read once per page load, so changing ?as= takes a reload. A sign-out wins
 * over ?as= until the sign-in button is pressed.
 */
function initialBypassUser(): string | null {
  const requested = new URL(window.location.href).searchParams.get("as");
  return storage(
    (store) => {
      if (isBypassAccount(requested)) store.setItem(BYPASS_KEY, requested);
      return store.getItem(SIGNED_OUT_KEY) ? null : bypassAccount();
    },
    isBypassAccount(requested) ? requested : "dev-player",
  );
}

const bypassUser = ref<string | null>(authBypass ? initialBypassUser() : null);
const bypassAuth: OnlineAuth = {
  userId: bypassUser,
  isLoaded: ref(true),
  isSignedIn: computed(() => !!bypassUser.value),
  getToken: async () =>
    bypassUser.value ? bypassToken(bypassUser.value) : null,
  // Signing out lasts across reloads, so the signed-out screens can be checked.
  signOut: async () => {
    storage((store) => store.setItem(SIGNED_OUT_KEY, "1"), undefined);
    bypassUser.value = null;
  },
};

function signInBypass(): void {
  storage((store) => store.removeItem(SIGNED_OUT_KEY), undefined);
  bypassUser.value = bypassAccount();
}

/** Clerk's state in the shape above, so callers never see Clerk's own. */
function clerkAuth(): OnlineAuth {
  const clerk = useClerkAuth();
  return {
    userId: computed(() => clerk.userId.value ?? null),
    isLoaded: computed(() => !!clerk.isLoaded.value),
    isSignedIn: computed(() => !!clerk.isSignedIn.value),
    getToken: () => clerk.getToken.value(),
    signOut: () => clerk.signOut.value(),
  };
}

export function useAuth(): OnlineAuth {
  return authBypass ? bypassAuth : clerkAuth();
}

const BypassShow = defineComponent({
  props: {
    when: {
      type: String as PropType<"signed-in" | "signed-out">,
      required: true,
    },
  },
  setup(props, { slots }) {
    return () =>
      (props.when === "signed-in") === !!bypassUser.value
        ? slots.default?.()
        : null;
  },
});

/** Stands in for Clerk's sign-in and sign-up buttons: a click signs in. */
const BypassSignInButton = defineComponent({
  setup(_, { slots }) {
    return () =>
      h(
        "span",
        { style: "display: contents", onClick: signInBypass },
        slots.default?.(),
      );
  },
});

export const Show = authBypass ? BypassShow : ClerkShow;
export const SignInButton = authBypass ? BypassSignInButton : ClerkSignInButton;
export const SignUpButton = authBypass ? BypassSignInButton : ClerkSignUpButton;
