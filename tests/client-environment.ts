import { builtinEnvironments, type Environment } from "vitest/runtime";

/**
 * Node's globals, with modules transformed for the browser. Vue then compiles
 * the components for the client renderer that the UI tests mount, not for SSR.
 * vitest.config.ts assigns it to the UI tests.
 */
export default {
  ...builtinEnvironments.node,
  name: "node-client",
  viteEnvironment: "client",
} satisfies Environment;
