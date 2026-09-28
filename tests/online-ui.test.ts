import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref, type Ref } from "vue";
import AccountHistory from "../src/ui/AccountHistory.vue";
import PublicLeaderboard from "../src/ui/PublicLeaderboard.vue";
import Tutorial from "../src/ui/Tutorial.vue";
import { trapDialogFocus } from "../src/ui/dialog";
import type { Puzzle } from "../src/core/model";
import type { PlayResult } from "../src/core/results";

const auth = vi.hoisted(() => ({
  user: undefined as Ref<string | null> | undefined,
}));
vi.mock("@clerk/vue", async () => {
  const { ref, computed, defineComponent, h } = await import("vue");
  const user = ref<string | null>("ui-account");
  auth.user = user;
  return {
    Show: defineComponent({
      props: { when: String },
      setup:
        (props, { slots }) =>
        () =>
          (props.when === "signed-out" ? !user.value : !!user.value)
            ? slots.default?.()
            : [],
    }),
    SignInButton: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("div", slots.default?.()),
    }),
    useAuth: () => ({
      userId: user,
      isLoaded: ref(true),
      isSignedIn: computed(() => !!user.value),
      getToken: ref(async () => "test-token"),
      signOut: ref(async () => {
        user.value = null;
      }),
    }),
  };
});
vi.mock("../src/core/puzzle-identity", () => ({
  puzzleId: async (puzzle: Puzzle) => `p1:${puzzle.seed}`,
}));
vi.mock("../src/core/online-history", () => ({
  createCompletedPlayUpload: async (play: PlayResult) => ({ playId: play.id }),
}));

// A small Vue host exercises component lifecycle without introducing a DOM dependency.
interface HostNode {
  tag: string;
  text: string;
  children: HostNode[];
  parent: HostNode | null;
  props: Record<string, unknown>;
  open: boolean;
  focus: () => void;
}
function node(tag = "root", text = ""): HostNode {
  return {
    tag,
    text,
    children: [],
    parent: null,
    props: {},
    open: false,
    focus: vi.fn(),
  };
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (tag) => node(tag),
  createText: (text) => node("text", text),
  createComment: (text) => node("comment", text),
  insert(child, parent, anchor) {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
  },
  remove(child) {
    if (child.parent)
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = null;
  },
  setText(child, text) {
    child.text = text;
  },
  setElementText(child, text) {
    child.text = text;
    child.children = [];
  },
  parentNode: (child) => child.parent,
  nextSibling(child) {
    return (
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null
    );
  },
  patchProp(child, key, _previous, value) {
    child.props[key] = value;
    if (key === "open") child.open = !!value;
  },
});
function find(
  root: HostNode,
  predicate: (n: HostNode) => boolean,
): HostNode | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const roots: HostNode[] = [];
function root(): HostNode {
  const result = node();
  roots.push(result);
  return result;
}
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.user!.value = "ui-account";
  const data = new Map([
    [
      "tako-sen.account-profile.v1:ui-account",
      JSON.stringify({ displayName: "🐙タコ", consentVersion: 1 }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    confirm: () => true,
  });
  vi.stubGlobal("document", {
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  request = vi.fn(async (path: string) =>
    Response.json(
      path === "/api/profile"
        ? { profile: { displayName: "🐙タコ", consentVersion: 1 } }
        : path === "/api/plays"
          ? { plays: [] }
          : { entries: [] },
    ),
  );
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  for (const container of roots.splice(0)) renderer.render(null, container);
  vi.unstubAllGlobals();
});
const puzzle = { seed: "first" } as Puzzle;

describe("tutorial dialog", () => {
  it("offers login only when configured and closes before handing off to login", async () => {
    auth.user!.value = null;
    const container = root();
    const close = vi.fn();
    renderer.render(
      h(Tutorial, { open: true, onlineEnabled: true, onClose: close }),
      container,
    );
    await nextTick();
    for (let step = 0; step < 4; step++) {
      (
        find(container, (n) => n.tag === "button" && n.text.trim() === "次へ")!
          .props.onClick as () => void
      )();
      await nextTick();
    }
    (
      find(
        container,
        (n) => n.tag === "button" && n.text.trim() === "ログインして参加",
      )!.props.onClick as () => void
    )();
    expect(close).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    auth.user!.value = "ui-account";
    await nextTick();
    expect(
      find(
        container,
        (n) => n.tag === "button" && n.text.trim() === "ログインして参加",
      ),
    ).toBeUndefined();
    expect(
      find(container, (n) =>
        n.text.includes("この環境ではオンライン機能は無効です"),
      ),
    ).toBeUndefined();
  });

  it("works before login, focuses on opening and each step, and resets on reopening", async () => {
    const container = root();
    const open = ref(true);
    const close = vi.fn(() => {
      open.value = false;
    });
    renderer.render(
      h({
        setup: () => () =>
          h(Tutorial, {
            open: open.value,
            onlineEnabled: false,
            onClose: close,
          }),
      }),
      container,
    );
    await nextTick();
    const dialog = () => find(container, (n) => n.props.role === "dialog")!;
    const click = async (label: string) => {
      const button = find(
        container,
        (n) => n.tag === "button" && n.text.trim() === label,
      )!;
      expect(button).toBeDefined();
      (button.props.onClick as () => void)();
      await nextTick();
    };
    expect(dialog().focus).toHaveBeenCalled();
    const reminder = () =>
      find(
        container,
        (n) =>
          n.tag === "p" &&
          n.text.trim() === "後から「遊び方」でいつでも読み直せます。",
      );
    expect(reminder()).toBeUndefined();
    expect(
      find(container, (n) => n.tag === "svg" && n.props.role === "img"),
    ).toBeDefined();
    for (let step = 0; step < 4; step++) await click("次へ");
    expect(reminder()).toBeDefined();
    expect(find(container, (n) => n.props.id === "tutorial-title")?.text).toBe(
      "ランキングに参加",
    );
    expect(
      find(container, (n) => n.text === "ログインして参加"),
    ).toBeUndefined();
    await click("戻る");
    expect(reminder()).toBeUndefined();
    expect(
      find(
        container,
        (n) =>
          n.tag === "svg" &&
          String(n.props["aria-label"]).includes("青いエリアの候補"),
      ),
    ).toBeDefined();
    expect(find(container, (n) => n.props.id === "tutorial-title")?.text).toBe(
      "基本の定石",
    );
    await click("スキップ");
    expect(close).toHaveBeenCalledOnce();
    expect(find(container, (n) => n.props.role === "dialog")).toBeUndefined();
    open.value = true;
    await nextTick();
    await nextTick();
    expect(find(container, (n) => n.props.id === "tutorial-title")?.text).toBe(
      "タコを8匹置こう",
    );
    const backdrop = find(
      container,
      (n) => n.props.class === "dialog-backdrop",
    )!;
    (backdrop.props.onKeydown as (event: unknown) => void)({
      key: "Escape",
      preventDefault: vi.fn(),
    });
    await nextTick();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("finishes the last page with the play action", async () => {
    const container = root();
    const close = vi.fn();
    renderer.render(
      h(Tutorial, { open: true, onlineEnabled: false, onClose: close }),
      container,
    );
    await nextTick();
    for (let step = 0; step < 4; step++) {
      (
        find(container, (n) => n.tag === "button" && n.text.trim() === "次へ")!
          .props.onClick as () => void
      )();
      await nextTick();
    }
    (
      find(container, (n) => n.tag === "button" && n.text.trim() === "遊ぶ")!
        .props.onClick as () => void
    )();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("automatic leaderboard refresh", () => {
  it("refreshes on initial display, completion, upload acknowledgement and panel reopening without a button", async () => {
    const container = root();
    const complete = ref(false);
    const revision = ref(0);
    const app = renderer.createApp({
      setup: () => () =>
        h(PublicLeaderboard, {
          puzzle,
          complete: complete.value,
          revision: revision.value,
        }),
    });
    app.mount(container);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(find(container, (n) => n.tag === "button")).toBeUndefined();
    complete.value = true;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    revision.value += 1;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    const panel = find(container, (n) => n.tag === "details")!;
    panel.open = true;
    (panel.props.onToggle as () => void)();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    const visible = vi
      .mocked(document.addEventListener)
      .mock.calls.find(
        ([event]) => event === "visibilitychange",
      )![1] as EventListener;
    visible(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(5));
    app.unmount();
  });

  it("ignores an older response after the player switches puzzles", async () => {
    let resolveOld!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const selected = ref(puzzle);
    const container = root();
    const app = renderer.createApp({
      setup: () => () => h(PublicLeaderboard, { puzzle: selected.value }),
    });
    app.mount(container);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    selected.value = { ...puzzle, seed: "second" };
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    resolveOld(
      Response.json({
        entries: [
          {
            rank: 1,
            displayName: "old",
            elapsedSeconds: 1,
            hintsUsed: 0,
            mistakes: 0,
          },
        ],
      }),
    );
    await nextTick();
    await nextTick();
    expect(find(container, (n) => n.tag === "li")).toBeUndefined();
    app.unmount();
  });
});

describe("account modal", () => {
  it("hides account controls when closed but continues syncing new clears", async () => {
    const container = root();
    const plays = ref<PlayResult[]>([]);
    const app = renderer.createApp({
      setup: () => () => h(AccountHistory, { plays: plays.value, open: false }),
    });
    app.mount(container);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("/api/profile", expect.anything()),
    );
    expect(find(container, (n) => n.props.role === "dialog")).toBeUndefined();
    plays.value = [
      {
        id: crypto.randomUUID(),
        userId: "local",
        status: "completed",
        seedCode: "TAKO:g1:easy:test",
        generatorVersion: "g1",
        difficulty: "easy",
        startedAt: 1,
        completedAt: 1000,
        elapsedSeconds: 1,
        hintsUsed: 0,
        mistakes: 0,
      },
    ];
    await vi.waitFor(() =>
      expect(
        request.mock.calls.some(
          ([path, init]) => path === "/api/plays" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(find(container, (n) => n.props.role === "dialog")).toBeUndefined();
    app.unmount();
  });

  it("opens with modal semantics and focus, and requests closure on Escape", async () => {
    const container = root();
    const open = ref(false);
    const close = vi.fn();
    const app = renderer.createApp({
      setup: () => () =>
        h(AccountHistory, { plays: [], open: open.value, onClose: close }),
    });
    app.mount(container);
    await nextTick();
    open.value = true;
    await nextTick();
    await nextTick();
    const dialog = find(container, (n) => n.props.role === "dialog")!;
    expect(dialog.props["aria-modal"]).toBe("true");
    expect(dialog.focus).toHaveBeenCalled();
    const preventDefault = vi.fn();
    (dialog.props.onKeydown as (e: unknown) => void)({
      key: "Escape",
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    app.unmount();
  });

  it("traps Tab focus at both boundaries of the dialog", () => {
    const first = { focus: vi.fn(), getClientRects: () => [{}] };
    const last = { focus: vi.fn(), getClientRects: () => [{}] };
    const hidden = { focus: vi.fn(), getClientRects: () => [] };
    const dialog = {
      querySelectorAll: () => [first, last, hidden],
    } as unknown as HTMLElement;
    const preventDefault = vi.fn();
    vi.stubGlobal("document", { activeElement: last });
    trapDialogFocus(
      {
        key: "Tab",
        shiftKey: false,
        preventDefault,
      } as unknown as KeyboardEvent,
      dialog,
    );
    expect(first.focus).toHaveBeenCalledOnce();
    vi.stubGlobal("document", { activeElement: first });
    trapDialogFocus(
      {
        key: "Tab",
        shiftKey: true,
        preventDefault,
      } as unknown as KeyboardEvent,
      dialog,
    );
    expect(last.focus).toHaveBeenCalledOnce();
    expect(hidden.focus).not.toHaveBeenCalled();
  });
});
