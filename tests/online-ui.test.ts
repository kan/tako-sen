import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref, type Ref } from "vue";
import AccountHistory from "../src/ui/AccountHistory.vue";
import PublicLeaderboard from "../src/ui/PublicLeaderboard.vue";
import Tutorial from "../src/ui/Tutorial.vue";
import InteractiveTutorial from "../src/ui/InteractiveTutorial.vue";
import TutorialBoard from "../src/ui/TutorialBoard.vue";
import App from "../src/App.vue";
import { encodePuzzleSeed } from "../src/core/puzzle-code";
import { trapDialogFocus } from "../src/ui/dialog";
import type { Puzzle } from "../src/core/model";
import type { PlayResult } from "../src/core/results";
import { audioDevice } from "./audio-device";
import { LONG_PRESS_MS } from "../src/ui/pointer";
import { createTutorialLesson } from "../src/core/interactive-tutorial";

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
    SignUpButton: defineComponent({
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
  style: Record<string, string>;
  addEventListener: () => void;
  getRootNode: () => typeof document;
  scrollIntoView: () => void;
  tagName: string;
  options: { selected: boolean; value: string }[];
  clientLeft: number;
  clientTop: number;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
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
    style: {},
    addEventListener: () => {},
    getRootNode: () => document,
    scrollIntoView: () => {},
    tagName: tag.toUpperCase(),
    options: [],
    clientLeft: 4,
    clientTop: 4,
    clientWidth: 320,
    clientHeight: 320,
    getBoundingClientRect: () => ({
      left: 10,
      top: 100,
      width: 328,
      height: 328,
    }),
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
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    location: { href: "https://example.test/" },
    scrollTo: vi.fn(),
    matchMedia: () => ({ matches: true }),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const puzzle = { seed: "first" } as Puzzle;

describe("haptic settings", () => {
  async function openSettings() {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = node();
    roots.push(container);
    renderer.render(h(App), container);
    await nextTick();
    for (const label of ["メニューを開く", "設定・シード・共有"]) {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.props["aria-label"] === label || n.text.trim() === label),
      )!;
      await (button.props.onClick as () => void)();
      await nextTick();
    }
    return container;
  }
  const checkbox = (container: HostNode) =>
    find(container, (n) => n.props["aria-describedby"] === "haptics-help")!;
  const testButton = (container: HostNode) =>
    find(
      container,
      (n) => n.tag === "button" && n.text.trim() === "振動を試す（100ms）",
    )!;

  it("explains an absent API and disables controls without discarding the stored preference", async () => {
    const container = await openSettings();
    expect(checkbox(container).props.disabled).toBe(true);
    expect(testButton(container).props.disabled).toBe(true);
    const help = find(container, (n) => n.props.id === "haptics-help")!;
    expect(
      find(help, (n) => n.text.includes("振動APIが利用できません")),
    ).toBeDefined();
    expect(localStorage.getItem("tako-sen:haptics-enabled")).toBeNull();
  });
  it.each([
    ["accepted", (): boolean => true, "実際に振動したか確認してください"],
    ["rejected", (): boolean => false, "受け付けませんでした"],
    [
      "failed",
      () => {
        throw new Error("blocked");
      },
      "プレイは続けられます",
    ],
  ] as const)(
    "tests a direct 100ms request and explains %s",
    async (_kind, response, message) => {
      const vibrate = vi.fn(response);
      vi.stubGlobal("navigator", { onLine: true, vibrate });
      const container = await openSettings();
      expect(checkbox(container).props.disabled).toBe(false);
      expect(testButton(container).props.disabled).toBe(false);
      expect(vibrate).not.toHaveBeenCalled();
      (testButton(container).props.onClick as () => void)();
      expect(vibrate).toHaveBeenCalledWith(100); // nextTickやtimerの前に同期的に要求する。
      await nextTick();
      expect(
        find(
          container,
          (n) => n.props.role === "status" && n.text.includes(message),
        ),
      ).toBeDefined();
      (
        checkbox(container).props["onUpdate:modelValue"] as (
          value: boolean,
        ) => void
      )(false);
      await nextTick();
      expect(testButton(container).props.disabled).toBe(true);
      expect(localStorage.getItem("tako-sen:haptics-enabled")).toBe("0");
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(
        find(
          container,
          (n) => n.props.role === "status" && n.text.includes(message),
        ),
      ).toBeUndefined();
    },
  );
});

describe("board pointer input", () => {
  async function setup() {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    (
      find(container, (n) => n.tag === "button" && n.text.trim() === "OK")!
        .props.onClick as () => void
    )();
    await nextTick();
    const board = find(container, (n) => n.props.class === "board")!;
    const saved = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    const cell = (index: number) =>
      find(container, (n) => n.props["data-cell-index"] === index)!;
    const event = (index: number) => ({
      isPrimary: true,
      button: 0,
      pointerId: 1,
      clientX: 34 + (index % 8) * 40,
      clientY: 124 + Math.floor(index / 8) * 40,
      currentTarget: { setPointerCapture: vi.fn() },
      preventDefault: vi.fn(),
    });
    const send = (name: string, index: number, dx = 0, dy = 0) => {
      const input = event(index);
      (board.props[name] as (e: unknown) => void)({
        ...input,
        clientX: input.clientX + dx,
        clientY: input.clientY + dy,
      });
    };
    const tap = (index: number) => {
      send("onPointerdown", index);
      send("onPointerup", index);
      send("onLostpointercapture", index);
    };
    return { container, saved, cell, send, tap };
  }

  it("keeps a cleared board unchanged after the result dialog is closed", async () => {
    const { container, saved, cell, send, tap } = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (const index of saved().puzzle.solution as number[]) {
      send("onPointerdown", index);
      now += LONG_PRESS_MS;
      send("onPointerup", index);
      await nextTick();
    }

    expect(find(container, (n) => n.props.class === "clear")).toBeDefined();
    const close = find(
      container,
      (n) => n.tag === "button" && n.text.trim() === "盤面を見る",
    )!;
    (close.props.onClick as () => void)();
    await nextTick();
    expect(
      find(container, (n) => n.props.class === "play-area")?.props.inert,
    ).toBe(true);

    const cleared = saved().state;
    const empty = Array.from({ length: 64 }, (_, index) => index).find(
      (index) => !cleared.pieces.includes(index),
    )!;
    (cell(empty).props.onClick as () => void)();
    tap(empty);
    send("onPointerdown", empty);
    send("onPointermove", empty + 1);
    send("onPointerup", empty + 1);
    send("onPointerdown", empty);
    now += LONG_PRESS_MS;
    send("onPointerup", empty);
    await nextTick();

    expect(saved().state).toEqual(cleared);
    expect(find(container, (n) => n.props.class === "clear")).toBeDefined();
  });

  it("persists auto exclusions and applies them only to new correct pieces", async () => {
    const { container, saved, send } = await setup();
    const checkbox = find(
      container,
      (n) => n.props["aria-describedby"] === "auto-exclusions-help",
    )!;
    const change = checkbox.props["onUpdate:modelValue"] as (
      value: boolean,
    ) => void;
    expect(checkbox.props["onUpdate:modelValue"]).toBeTypeOf("function");
    change(true);
    await nextTick();
    expect(saved().state.excluded).toEqual([]);
    expect(localStorage.getItem("tako-sen:auto-exclusions-enabled")).toBe("1");
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const index = saved().puzzle.solution[0];
    send("onPointerdown", index);
    now += LONG_PRESS_MS;
    send("onPointerup", index);
    await nextTick();
    expect(saved().state.pieces).toContain(index);
    expect(saved().state.excluded.length).toBeGreaterThan(0);
    const marks = saved().state.excluded;
    change(false);
    await nextTick();
    expect(saved().state.excluded).toEqual(marks);
    expect(localStorage.getItem("tako-sen:auto-exclusions-enabled")).toBe("0");
  });

  it("renders placed pieces with the shared decorative SVG instead of emoji", async () => {
    const { saved, send, cell } = await setup();
    const index = saved().puzzle.solution[0];
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", index);
    now += LONG_PRESS_MS;
    send("onPointerup", index);
    await nextTick();
    const icon = find(cell(index), (n) => n.tag === "img")!;
    expect(icon.props).toMatchObject({
      src: "/tako.svg",
      alt: "",
      "aria-hidden": "true",
      draggable: "false",
      class: "tako",
    });
    expect(cell(index).props["aria-label"]).toContain("piece");
  });

  it("renders the same SVG at the center of each tutorial piece cell", () => {
    const container = root();
    renderer.render(
      h(TutorialBoard, { kind: "piece", after: false, label: "タコの例" }),
      container,
    );
    const icon = find(container, (n) => n.tag === "image")!;
    expect(icon.props).toMatchObject({
      href: "/tako.svg",
      x: 124,
      y: 44,
      width: "32",
      height: "32",
      preserveAspectRatio: "xMidYMid meet",
    });
    expect(find(container, (n) => n.tag === "svg")!.props["aria-label"]).toBe(
      "タコの例",
    );
  });

  it("shows the decorative shared octopus to the left of the menu title", async () => {
    const { container } = await setup();
    (
      find(container, (n) => n.props["aria-label"] === "メニューを開く")!.props
        .onClick as () => void
    )();
    await nextTick();
    const title = find(container, (n) => n.props.id === "menu-title")!;
    expect(find(title, (n) => n.tag === "img")!.props).toMatchObject({
      src: "/tako.svg",
      alt: "",
      "aria-hidden": "true",
    });
    expect(find(title, (n) => n.tag === "span")!.text).toBe("メニュー");
  });

  it("commits short taps without click, ignores retargeted clicks, and preserves keyboard activation", async () => {
    const { saved, cell, tap } = await setup();
    tap(17);
    await nextTick();
    expect(saved().state.excluded).toContain(17);
    expect(saved().state.excluded).not.toContain(9);
    // Safari may synthesize a click on a different target; it must not change the board.
    (cell(9).props.onClick as (e: unknown) => void)({ detail: 1 });
    (cell(17).props.onClick as (e: unknown) => void)({ detail: 1 });
    await nextTick();
    expect(saved().state.excluded).toContain(17);
    expect(saved().state.excluded).not.toContain(9);
    (cell(9).props.onClick as (e: unknown) => void)({ detail: 0 });
    await nextTick();
    expect(saved().state.excluded).toContain(9);
  });

  it("shows immediate waiting feedback without treating it as permission to place a piece", async () => {
    const { saved, send, cell } = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", 17);
    await nextTick();
    expect(cell(17).props.class).toContain("is-holding");
    expect(cell(17).props.class).not.toContain("is-pressed");
    now += LONG_PRESS_MS - 1;
    send("onPointerup", 17);
    await nextTick();
    expect(cell(17).props.class).not.toContain("is-holding");
    expect(cell(17).props.class).not.toContain("is-pressed");
    expect(saved().state.excluded).toContain(17);
    expect(saved().state.pieces).not.toContain(17);
    expect(saved().state.fixedErrors).not.toContain(17);
  });

  it.each(["onPointermove", "onPointercancel", "onLostpointercapture"])(
    "clears immediate waiting feedback when %s interrupts the press",
    async (eventName) => {
      const { send, cell } = await setup();
      send("onPointerdown", 17);
      await nextTick();
      expect(cell(17).props.class).toContain("is-holding");
      send(eventName, 18);
      await nextTick();
      expect(cell(17).props.class).not.toContain("is-holding");
      expect(cell(17).props.class).not.toContain("is-pressed");
      send("onPointerup", 18);
    },
  );

  it("does not suppress the next short tap after a long press", async () => {
    const { saved, send, tap } = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", 17);
    now += LONG_PRESS_MS;
    send("onPointerup", 17);
    tap(18);
    await nextTick();
    expect(saved().state.excluded).toContain(18);
    expect([...saved().state.pieces, ...saved().state.fixedErrors]).toContain(
      17,
    );
  });

  it("keeps drag input separate from taps and accepts the next tap immediately", async () => {
    const { saved, send, tap } = await setup();
    send("onPointerdown", 17);
    send("onPointermove", 18);
    send("onPointerup", 18);
    send("onLostpointercapture", 18);
    tap(19);
    await nextTick();
    expect(saved().state.excluded).toEqual(
      expect.arrayContaining([17, 18, 19]),
    );
    expect(saved().state.fixedErrors).toEqual([]);
  });

  it("erases marks when dragging from a marked cell without toggling empty or revisited cells", async () => {
    const { saved, send, tap } = await setup();
    tap(17);
    tap(18);
    tap(20);
    send("onPointerdown", 17);
    send("onPointermove", 18);
    send("onPointermove", 19);
    send("onPointermove", 17);
    send("onPointerup", 17);
    send("onLostpointercapture", 17);
    await nextTick();
    expect(saved().state.excluded).toEqual([20]);
    expect(saved().state.fixedErrors).toEqual([]);
    // A new drag from the now-empty starting cell must add marks again.
    send("onPointerdown", 17);
    send("onPointermove", 18);
    send("onPointerup", 18);
    await nextTick();
    expect(saved().state.excluded).toEqual(
      expect.arrayContaining([17, 18, 20]),
    );
  });

  it("keeps a marked-cell drag in erase mode after waiting beyond the long press threshold", async () => {
    const { saved, send, tap, cell } = await setup();
    tap(17);
    tap(18);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", 17);
    await nextTick();
    expect(cell(17).props.class).not.toContain("is-holding");
    now += LONG_PRESS_MS * 2;
    send("onPointermove", 18);
    send("onPointerup", 18);
    await nextTick();
    expect(saved().state.excluded).toEqual([]);
    expect(saved().state.fixedErrors).toEqual([]);
    expect(saved().state.pieces).not.toContain(17);
  });

  it("does not treat a canceled gesture or a tap on a different cell as a double tap", async () => {
    const { saved, send, tap } = await setup();
    tap(17);
    send("onPointerdown", 17);
    send("onPointercancel", 17);
    tap(18);
    await nextTick();
    expect(saved().state.excluded).toEqual(expect.arrayContaining([17, 18]));
    expect(saved().state.excluded).toHaveLength(2);
  });

  it("switches a ready long press to drag marking and never confirms when returning before release", async () => {
    const { saved, send, cell, tap } = await setup();
    let ready!: () => void;
    vi.stubGlobal("window", {
      ...window,
      setTimeout: vi.fn((callback: () => void, delay?: number) => {
        if (delay === LONG_PRESS_MS) ready = callback;
        return 1;
      }),
    });
    send("onPointerdown", 17);
    await nextTick();
    expect(cell(17).props.class).toContain("is-holding");
    expect(cell(17).props.class).not.toContain("is-pressed");
    ready();
    await nextTick();
    expect(cell(17).props.class).not.toContain("is-holding");
    expect(cell(17).props.class).toContain("is-pressed");
    expect(saved().state.pieces).not.toContain(17);
    expect(saved().state.fixedErrors).not.toContain(17);
    send("onPointermove", 18);
    await nextTick();
    expect(cell(17).props.class).not.toContain("is-pressed");
    expect(saved().state.excluded).toEqual(expect.arrayContaining([17, 18]));
    send("onPointermove", 17);
    send("onPointerup", 17);
    await nextTick();
    expect(saved().state.pieces).not.toContain(17);
    expect(saved().state.fixedErrors).not.toContain(17);
    expect(saved().state.excluded).toEqual(expect.arrayContaining([17, 18]));
    tap(19);
    await nextTick();
    expect(saved().state.excluded).toContain(19);
  });

  it.each(["onPointermove", "onPointerleave"])(
    "cancels a ready press via %s outside the board without resuming on re-entry",
    async (eventName) => {
      const { saved, send, cell } = await setup();
      let ready!: () => void;
      vi.stubGlobal("window", {
        ...window,
        setTimeout: vi.fn((callback: () => void, delay?: number) => {
          if (delay === LONG_PRESS_MS) ready = callback;
          return 1;
        }),
      });
      send("onPointerdown", 17);
      ready();
      send(eventName, -1);
      send("onPointermove", 18);
      send("onPointerup", 17);
      await nextTick();
      expect(cell(17).props.class).not.toContain("is-pressed");
      expect(saved().state.excluded).toEqual([]);
      expect(saved().state.pieces).not.toContain(17);
      expect(saved().state.fixedErrors).not.toContain(17);
    },
  );

  it.each([
    [11, false],
    [12, true],
  ])(
    "uses displacement rather than elapsed time to distinguish ready presses from drags at %spx",
    async (dx, dragging) => {
      const { saved, send, cell } = await setup();
      let ready!: () => void;
      vi.stubGlobal("window", {
        ...window,
        setTimeout: vi.fn((callback: () => void, delay?: number) => {
          if (delay === LONG_PRESS_MS) ready = callback;
          return 1;
        }),
      });
      send("onPointerdown", 17);
      ready();
      send("onPointermove", 17, dx);
      await nextTick();
      expect(String(cell(17).props.class).includes("is-pressed")).toBe(
        !dragging,
      );
      send("onPointerup", 17, dx);
      await nextTick();
      expect(saved().state.excluded.includes(17)).toBe(dragging);
      expect(
        [...saved().state.pieces, ...saved().state.fixedErrors].includes(17),
      ).toBe(!dragging);
    },
  );

  it("retains already applied drag marks when leaving and returning to the board", async () => {
    const { saved, send } = await setup();
    send("onPointerdown", 17);
    send("onPointermove", 18);
    send("onPointermove", -1);
    send("onPointerleave", -1);
    send("onPointermove", 19);
    send("onPointerup", 19);
    await nextTick();
    expect(saved().state.excluded).toEqual(
      expect.arrayContaining([17, 18, 19]),
    );
    expect(saved().state.fixedErrors).toEqual([]);
  });

  it("cancels confirmation when released outside the starting cell without a move event", async () => {
    const { saved, send, tap } = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", 17);
    now += LONG_PRESS_MS;
    send("onPointerup", 9);
    tap(18);
    await nextTick();
    expect([
      ...saved().state.pieces,
      ...saved().state.fixedErrors,
    ]).not.toContain(17);
    expect(saved().state.excluded).toContain(18);
  });

  it("supports double-tap shortcuts without a browser dblclick event", async () => {
    const { saved, tap, send, cell } = await setup();
    const index = saved().puzzle.solution[0];
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    send("onPointerdown", index);
    now += LONG_PRESS_MS;
    send("onPointerup", index);
    send("onLostpointercapture", index);
    tap(index);
    tap(index);
    await nextTick();
    expect(saved().state.excluded.length).toBeGreaterThan(0);
    const excluded = saved().state.excluded;
    (cell(index).props.onDblclick as (e: unknown) => void)({
      preventDefault: vi.fn(),
    });
    await nextTick();
    expect(saved().state.excluded).toEqual(excluded);
  });
});

describe("sound effects", () => {
  function setup() {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const device = audioDevice();
    const constructor = vi.fn(function () {
      return device.audio;
    });
    vi.stubGlobal("window", { ...window, AudioContext: constructor });
    return { device, constructor };
  }
  async function click(container: HostNode, label: string) {
    const button = find(
      container,
      (n) =>
        n.tag === "button" &&
        (n.props["aria-label"] === label || n.text.trim() === label),
    )!;
    expect(button).toBeDefined();
    (button.props.onClick as () => void)();
    await nextTick();
  }
  const game = () =>
    JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);

  it("starts silent, persists opt-in, previews the three cues and stops on opt-out", async () => {
    const { device, constructor } = setup();
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    await click(container, "メニューを開く");
    await click(container, "設定・シード・共有");
    const checkbox = find(
      container,
      (n) => n.props["aria-describedby"] === "sound-help",
    )!;
    expect(checkbox.props.disabled).toBe(false);
    expect(
      find(container, (n) => n.text === "CLEARの音を試す")!.props.disabled,
    ).toBe(true);
    expect(constructor).not.toHaveBeenCalled();
    expect(localStorage.getItem("tako-sen:sound-enabled")).toBeNull();
    (checkbox.props["onUpdate:modelValue"] as (value: boolean) => void)(true);
    (checkbox.props.onChange as () => void)();
    await nextTick();
    expect(localStorage.getItem("tako-sen:sound-enabled")).toBe("1");
    for (const label of ["×の音を試す", "タコの音を試す", "CLEARの音を試す"])
      await click(container, label);
    expect(device.oscillators).toHaveLength(3);
    expect(constructor).toHaveBeenCalledTimes(1);
    (checkbox.props["onUpdate:modelValue"] as (value: boolean) => void)(false);
    (checkbox.props.onChange as () => void)();
    await nextTick();
    expect(localStorage.getItem("tako-sen:sound-enabled")).toBe("0");
    expect(device.oscillators.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
    renderer.render(null, container);
    renderer.render(h(App), container);
    await nextTick();
    expect(constructor).toHaveBeenCalledTimes(1);
  });
  it("plays added crosses but not deletions, and stops the sound on focus loss", async () => {
    const { device } = setup();
    localStorage.setItem("tako-sen:sound-enabled", "1");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    expect(device.oscillators).toHaveLength(0);
    await click(container, "OK");
    const index = game().puzzle.regions.findIndex(
      (_region: number, cell: number) => !game().puzzle.solution.includes(cell),
    );
    const cell = find(container, (n) => n.props["data-cell-index"] === index)!;
    (cell.props.onClick as () => void)();
    await nextTick();
    expect(device.oscillators).toHaveLength(1);
    (cell.props.onClick as () => void)();
    await nextTick();
    expect(device.oscillators).toHaveLength(1);
    const blur = (
      vi.mocked(window.addEventListener).mock.calls as unknown as [
        string,
        () => void,
      ][]
    ).find(([name]) => name === "blur")![1];
    (blur as () => void)();
    expect(device.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
  });
  it("plays only CLEAR on the last piece and never replays it on restoring the clear", async () => {
    const { device, constructor } = setup();
    localStorage.setItem("tako-sen:sound-enabled", "1");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const saved = game();
    const target = saved.puzzle.solution.find(
      (cell: number) => !(saved.puzzle.givens ?? []).includes(cell),
    );
    renderer.render(null, container);
    saved.state.pieces = saved.puzzle.solution.filter(
      (cell: number) => cell !== target,
    );
    saved.state.excluded = [];
    localStorage.setItem("tako-sen.current-game.v2", JSON.stringify(saved));
    renderer.render(h(App), container);
    await nextTick();
    await click(container, "OK");
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let ready!: () => void;
    vi.stubGlobal("window", {
      ...window,
      setTimeout: vi.fn((callback: () => void, delay?: number) => {
        if (delay === LONG_PRESS_MS) ready = callback as () => void;
        return 1;
      }),
    });
    const event = {
      isPrimary: true,
      button: 0,
      pointerId: 1,
      clientX: 14 + (target % 8) * 40 + 20,
      clientY: 104 + Math.floor(target / 8) * 40 + 20,
      currentTarget: { setPointerCapture: vi.fn() },
      preventDefault: vi.fn(),
    };
    (
      find(container, (n) => n.props.class === "board")!.props
        .onPointerdown as (event: unknown) => void
    )(event);
    ready();
    now += LONG_PRESS_MS;
    (
      find(container, (n) => n.props.class === "board")!.props.onPointerup as (
        event: unknown,
      ) => void
    )(event);
    await nextTick();
    expect(device.oscillators).toHaveLength(1);
    expect(
      device.oscillators[0].frequency.setValueAtTime,
    ).toHaveBeenCalledTimes(4);
    expect(game().state.pieces).toHaveLength(8);
    renderer.render(null, container);
    renderer.render(h(App), container);
    await nextTick();
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(device.oscillators).toHaveLength(1);
  });
});

describe("play screen navigation", () => {
  it("records actual disclosure, persists the maximum through reopening and reload, and finishes with it", async () => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.props["aria-label"] === label || n.text.trim() === label),
      )!;
      expect(button).toBeDefined();
      await (button.props.onClick as () => void | Promise<void>)();
      await nextTick();
    };
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    await click("OK");
    await click("ヒント");
    expect(game().state.maxHintStage).toBe(1);
    await click("次のヒント");
    expect(game().state.maxHintStage).toBe(2);
    await click("次のヒント");
    expect(game().state.maxHintStage).toBe(3);
    await click("閉じる");
    await click("ヒント");
    expect(game().state.maxHintStage).toBe(3);
    expect(game().state.hintsUsed).toBe(1);
    await click("閉じる");
    renderer.render(null, container);
    renderer.render(h(App), container);
    await nextTick();
    expect(game().state.maxHintStage).toBe(3);
    await click("OK");
    const saved = game();
    const wrongExclusion = saved.puzzle.solution.find(
      (cell: number) => !(saved.puzzle.givens ?? []).includes(cell),
    );
    const cell = find(
      container,
      (n) => n.props["data-cell-index"] === wrongExclusion,
    )!;
    (cell.props.onClick as () => void)();
    await nextTick();
    await click("ヒント");
    await click("次のヒント");
    await click("次のヒント");
    await click("次のヒント");
    expect(game().state.maxHintStage).toBe(4);
    await click("閉じる");
    const completeSave = game();
    renderer.render(null, container);
    completeSave.state.pieces = completeSave.puzzle.solution;
    completeSave.state.excluded = [];
    localStorage.setItem(
      "tako-sen.current-game.v2",
      JSON.stringify(completeSave),
    );
    renderer.render(h(App), container);
    await nextTick();
    const results = JSON.parse(localStorage.getItem("tako-sen.results.v2")!);
    expect(
      results.plays.find((play: PlayResult) => play.id === completeSave.playId)
        .maxHintStage,
    ).toBe(4);
    expect(
      find(container, (n) => n.props.class === "clear")?.parent?.props.class,
    ).toBe("status-bar");
  });

  it("resumes after menu dismissal but requires READY after blur or a hidden tab, including during the menu", async () => {
    let now = 10000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.props["aria-label"] === label || n.text.trim() === label),
      )!;
      expect(button).toBeDefined();
      await (button.props.onClick as () => void | Promise<void>)();
      await nextTick();
    };
    const ready = () =>
      find(container, (n) => n.props.class === "ready-overlay");
    const menu = () =>
      find(container, (n) => n.props["aria-labelledby"] === "menu-title")!;
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    // 元からREADYならメニューを閉じても計時を始めない。
    await click("メニューを開く");
    await click("メニューを閉じる");
    expect(ready()).toBeDefined();
    expect(game().hasStarted).toBe(false);
    await click("OK");
    let expectedElapsed = 0;
    for (const method of ["button", "backdrop", "escape", "return"]) {
      now += 1000;
      expectedElapsed += 1000;
      await click("メニューを開く");
      now += 60000;
      if (method === "button") await click("メニューを閉じる");
      else if (method === "return") await click("プレイに戻る");
      else if (method === "escape") {
        (menu().props.onKeydown as (e: unknown) => void)({
          key: "Escape",
          preventDefault: vi.fn(),
        });
      } else {
        const backdrop = menu().parent!;
        (backdrop.props.onClick as (e: unknown) => void)({
          target: backdrop,
          currentTarget: backdrop,
        });
      }
      await nextTick();
      expect(ready()).toBeUndefined();
      expect(game().waitingToStart).toBe(false);
      expect(game().elapsedMs).toBe(expectedElapsed);
    }
    const blur = vi
      .mocked(window.addEventListener)
      .mock.calls.find(
        ([event]) => String(event) === "blur",
      )![1] as EventListener;
    now += 2000;
    blur(new Event("blur"));
    await nextTick();
    expectedElapsed += 2000;
    expect(ready()).toBeDefined();
    expect(game().elapsedMs).toBe(expectedElapsed);
    now += 60000;
    expect(game().waitingToStart).toBe(true);
    await click("OK");
    now += 3000;
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    const visibilityListeners = vi
      .mocked(document.addEventListener)
      .mock.calls.filter(([event]) => event === "visibilitychange");
    for (const [, handler] of visibilityListeners)
      (handler as EventListener)(new Event("visibilitychange"));
    await nextTick();
    expectedElapsed += 3000;
    expect(ready()).toBeDefined();
    expect(game().elapsedMs).toBe(expectedElapsed);
    now += 60000;
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    for (const [, handler] of visibilityListeners)
      (handler as EventListener)(new Event("visibilitychange"));
    await nextTick();
    expect(ready()).toBeDefined();
    await click("OK");
    now += 1000;
    await click("メニューを開く");
    blur(new Event("blur"));
    now += 60000;
    await click("メニューを閉じる");
    expect(ready()).toBeDefined();
    expect(game().elapsedMs).toBe(expectedElapsed + 1000);
    renderer.render(null, container);
    expect(window.removeEventListener).toHaveBeenCalledWith("blur", blur);
    for (const [, handler] of visibilityListeners)
      expect(document.removeEventListener).toHaveBeenCalledWith(
        "visibilitychange",
        handler,
      );
  });

  it("pauses while browsing other screens, retains marks and resumes only with READY OK", async () => {
    let now = 10000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.text.trim() === label || n.props["aria-label"] === label),
      )!;
      expect(button).toBeDefined();
      await (button.props.onClick as () => void | Promise<void>)();
      await nextTick();
    };
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    await click("OK");
    const cell = find(container, (n) => n.props["data-cell-index"] === 0)!;
    (cell.props.onClick as () => void)();
    await nextTick();
    const markedState = game().state;
    expect(markedState.excluded).toContain(0);
    now += 3000;
    await click("メニューを開く");
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeUndefined();
    const menu = find(
      container,
      (n) => n.props["aria-labelledby"] === "menu-title",
    )!;
    expect(menu.props.role).toBe("dialog");
    expect(menu.props["aria-modal"]).toBe("true");
    expect(menu.focus).toHaveBeenCalled();
    expect(find(container, (n) => n.tag === "h1")).toBeUndefined();
    const menuItems = find(container, (n) => n.props.class === "screen-menu")!;
    expect(menuItems.children.at(-1)?.text.trim()).toBe("プレイに戻る");
    expect(game().elapsedMs).toBe(3000);
    now += 60000;
    await click("履歴・成績");
    expect(game().elapsedMs).toBe(3000);
    expect(game().state).toEqual(markedState);
    await click("プレイに戻る");
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeDefined();
    expect(game().elapsedMs).toBe(3000);
    await click("OK");
    now += 2000;
    await click("メニューを開く");
    expect(game().elapsedMs).toBe(5000);
    expect(game().state).toEqual(markedState);
    await click("設定・シード・共有");
    const restoreInput = find(
      container,
      (n) => n.props.placeholder === "TAKO:g2:easy:...",
    )!;
    const updateCode = restoreInput.props["onUpdate:modelValue"] as (
      value: string,
    ) => void;
    updateCode("invalid");
    await click("復元");
    expect(
      find(container, (n) => n.tag === "h2" && n.text === "設定・シード・共有"),
    ).toBeDefined();
    expect(game().state).toEqual(markedState);
    const oldPlayId = game().playId;
    updateCode(encodePuzzleSeed({ ...game().puzzle, generatorVersion: "g1" }));
    await click("復元");
    expect(game().puzzle.generatorVersion).toBe("g1");
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeDefined();
    expect(game().state.excluded).toEqual([]);
    expect(game().playId).not.toBe(oldPlayId);
    expect(game().elapsedMs).toBe(0);
    await click("メニューを開く");
    const reopened = find(
      container,
      (n) => n.props["aria-labelledby"] === "menu-title",
    )!;
    const preventDefault = vi.fn();
    (reopened.props.onKeydown as (e: unknown) => void)({
      key: "Escape",
      preventDefault,
    });
    await nextTick();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(
      find(container, (n) => n.props["aria-labelledby"] === "menu-title"),
    ).toBeUndefined();
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeDefined();
  });
});

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

describe("interactive tutorial", () => {
  it("keeps the active game isolated and requires READY after reopening from the menu", async () => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.text.trim() === label || n.props["aria-label"] === label),
      )!;
      expect(button).toBeDefined();
      (button.props.onClick as () => void)();
      await nextTick();
    };
    await click("OK");
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    const before = game().state;
    await click("メニューを開く");
    await click("遊び方");
    await vi.waitFor(() =>
      expect(
        find(container, (n) => n.props.id === "tutorial-title")?.text,
      ).toBe("長押しでタコを置こう"),
    );
    await click("遊び方を閉じる");
    await click("メニューを閉じる");
    expect(game().state).toEqual(before);
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeDefined();
  });

  it("offers an initial choice, remembers skipping and reopens directly from READY", async () => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v1", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const savedBefore = localStorage.getItem("tako-sen.current-game.v2");
    await vi.waitFor(() =>
      expect(
        find(container, (n) => n.props.id === "tutorial-title")?.text,
      ).toBe("チュートリアルを見ますか？"),
    );
    const click = async (label: string) => {
      const button = find(
        container,
        (n) => n.tag === "button" && n.text.trim() === label,
      )!;
      expect(button).toBeDefined();
      (button.props.onClick as () => void)();
      await nextTick();
    };
    await click("いいえ、すぐ遊ぶ");
    expect(localStorage.getItem("tako-sen.tutorial.v2")).toBe("seen");
    expect(localStorage.getItem("tako-sen.current-game.v2")).toBe(savedBefore);
    await click("遊び方");
    await vi.waitFor(() =>
      expect(
        find(container, (n) => n.props.id === "tutorial-title")?.text,
      ).toBe("長押しでタコを置こう"),
    );
  });

  it("guides real gestures through completion without saving a normal play", async () => {
    const container = root();
    const close = vi.fn();
    const autoChange = vi.fn();
    const lesson = createTutorialLesson();
    renderer.render(
      h(InteractiveTutorial, {
        open: true,
        firstVisit: true,
        onlineEnabled: false,
        autoExclusionsEnabled: true,
        onClose: close,
        onAutoExclusionsChange: autoChange,
      }),
      container,
    );
    await nextTick();
    const title = () =>
      find(container, (n) => n.props.id === "tutorial-title")?.text;
    const click = async (label: string) => {
      const button = find(
        container,
        (n) => n.tag === "button" && n.text.trim() === label,
      )!;
      expect(button).toBeDefined();
      (button.props.onClick as () => void)();
      await nextTick();
    };
    const cell = (index: number) =>
      find(container, (n) => n.props["data-tutorial-cell"] === index)!;
    const board = () =>
      find(
        container,
        (n) => n.props.class === "board interactive-tutorial-board",
      )!;
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const send = (name: string, index: number) => {
      const input = {
        isPrimary: true,
        button: 0,
        pointerId: 1,
        clientX: 34 + (index % 8) * 40,
        clientY: 124 + Math.floor(index / 8) * 40,
        currentTarget: { setPointerCapture: vi.fn() },
        preventDefault: vi.fn(),
      };
      (board().props[name] as (event: unknown) => void)(input);
    };
    const tap = (index: number) => {
      send("onPointerdown", index);
      send("onPointerup", index);
      send("onLostpointercapture", index);
    };
    expect(title()).toBe("チュートリアルを見ますか？");
    await click("はい、練習する");
    expect(title()).toBe("長押しでタコを置こう");
    expect(cell(lesson.firstPiece).props.class).toContain(
      "tutorial-place-target",
    );
    send("onPointerdown", lesson.firstPiece);
    now += LONG_PRESS_MS;
    send("onPointerup", lesson.firstPiece);
    await nextTick();
    expect(title()).toBe("ダブルタップで×を追加");
    expect(find(container, (n) => n.props.class === "mark")).toBeUndefined();
    tap(lesson.firstPiece);
    now += 100;
    tap(lesson.firstPiece);
    await nextTick();
    expect(title()).toBe("自動の×を選ぼう");
    await click("はい、自動で付ける");
    expect(autoChange).toHaveBeenCalledWith(true);
    expect(title()).toBe("指を滑らせて×を付けよう");
    send("onPointerdown", lesson.dragTargets[0]);
    for (const target of lesson.dragTargets.slice(1))
      send("onPointermove", target);
    send("onPointerup", lesson.dragTargets.at(-1)!);
    await nextTick();
    expect(title()).toBe("置けない理由を考えよう");
    (cell(lesson.reasoningTarget).props.onClick as (event: unknown) => void)({
      detail: 0,
    });
    await nextTick();
    expect(title()).toBe("ヒントを試そう");
    await click("ヒントを見る");
    expect(title()).toBe("ここからは自由に解こう");
    await click("次のヒント");
    await click("次のヒント");
    expect(
      find(
        container,
        (n) => n.tag === "p" && n.text.includes("練習中のヒント 1回"),
      ),
    ).toBeDefined();
    for (const index of lesson.puzzle.solution) {
      if (index === lesson.firstPiece) continue;
      send("onPointerdown", index);
      now += LONG_PRESS_MS;
      send("onPointerup", index);
      await nextTick();
    }
    expect(title()).toBe("チュートリアル完了！");
    expect(localStorage.getItem("tako-sen.results.v2")).toBeNull();
    await click("通常プレイへ");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("public leaderboard dialog", () => {
  it("highlights only the signed-in game name and updates on account changes", async () => {
    request.mockImplementation(async () =>
      Response.json({
        entries: ["🐙タコ", "🐙別の人"].map((displayName, index) => ({
          rank: index + 1,
          displayName,
          elapsedSeconds: 60,
          hintsUsed: 0,
          mistakes: 0,
        })),
      }),
    );
    const container = root();
    const render = async (gameName: string) => {
      renderer.render(
        h(PublicLeaderboard, { puzzle, open: true, gameName }),
        container,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
    };
    const self = () =>
      find(
        container,
        (n) => n.tag === "li" && n.props.class === "ranking-self",
      );
    await render("🐙タコ");
    expect(self()).toBeDefined();
    expect(find(self()!, (n) => n.props.class === "ranking-you")?.text).toBe(
      "あなた",
    );
    expect(find(self()!, (n) => n.props.class === "ranking-place")?.text).toBe(
      "1位",
    );
    await render("🐙別の人");
    expect(find(self()!, (n) => n.props.class === "ranking-place")?.text).toBe(
      "2位",
    );
    await render("");
    expect(self()).toBeUndefined();
    expect(
      find(container, (n) => n.props.class === "ranking-you"),
    ).toBeUndefined();
    await render("🐙未参加");
    expect(self()).toBeUndefined();
  });

  it("decorates the ranking title with the shared octopus without changing its accessible label", async () => {
    const container = root();
    renderer.render(h(PublicLeaderboard, { puzzle, open: true }), container);
    await nextTick();
    const title = find(
      container,
      (n) => n.props.id === "public-leaderboard-title",
    )!;
    expect(find(title, (n) => n.tag === "img")!.props).toMatchObject({
      src: "/tako.svg",
      alt: "",
      "aria-hidden": "true",
    });
    expect(find(title, (n) => n.tag === "span")!.text).toBe(
      "この問題のランキング",
    );
    expect(
      find(container, (n) => n.props.id === "public-leaderboard")!.props[
        "aria-labelledby"
      ],
    ).toBe("public-leaderboard-title");
  });

  it("places the ranking button after Next and pauses only while its dialog is open", async () => {
    let now = 10000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const actions = find(container, (n) => n.props.class === "actions")!;
    const labels = actions.children.map((child) => child.props["aria-label"]);
    expect(labels.indexOf("この問題のランキング")).toBe(
      labels.indexOf("新しい問題") + 1,
    );
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.text.trim() === label || n.props["aria-label"] === label),
      )!;
      expect(button).toBeDefined();
      await (button.props.onClick as () => void | Promise<void>)();
      await nextTick();
    };
    await click("OK");
    now += 3000;
    await click("この問題のランキング");
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    expect(game().elapsedMs).toBe(3000);
    now += 60000;
    await click("閉じる");
    expect(game().elapsedMs).toBe(3000);
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeUndefined();
  });

  it("opens from the menu without leaving play and resumes timing after closing", async () => {
    let now = 10000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    const click = async (label: string) => {
      const button = find(
        container,
        (n) =>
          n.tag === "button" &&
          (n.text.trim() === label || n.props["aria-label"] === label),
      )!;
      expect(button).toBeDefined();
      await (button.props.onClick as () => void | Promise<void>)();
      await nextTick();
    };
    await click("OK");
    now += 3000;
    await click("メニューを開く");
    const game = () =>
      JSON.parse(localStorage.getItem("tako-sen.current-game.v2")!);
    expect(game().elapsedMs).toBe(3000);
    await click("この問題のランキング");
    expect(
      find(container, (n) => n.props.id === "public-leaderboard"),
    ).toBeDefined();
    expect(
      find(container, (n) => n.props["aria-labelledby"] === "menu-title"),
    ).toBeUndefined();
    expect(
      find(container, (n) => n.props.class === "screen-header"),
    ).toBeUndefined();
    now += 60000;
    await click("閉じる");
    expect(
      find(container, (n) => n.props.id === "public-leaderboard"),
    ).toBeUndefined();
    expect(
      find(container, (n) => n.props.class === "ready-overlay"),
    ).toBeUndefined();
    expect(game().elapsedMs).toBe(3000);
  });

  it("loads on opening and closes with Escape", async () => {
    const container = root();
    const open = ref(false);
    const close = vi.fn(() => {
      open.value = false;
    });
    renderer.render(
      h({
        setup: () => () =>
          h(PublicLeaderboard, {
            puzzle,
            open: open.value,
            onClose: close,
          }),
      }),
      container,
    );
    expect(request).not.toHaveBeenCalled();
    open.value = true;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const dialog = find(container, (n) => n.props.id === "public-leaderboard")!;
    expect(dialog.props.role).toBe("dialog");
    expect(dialog.props["aria-modal"]).toBe("true");
    expect(dialog.focus).toHaveBeenCalled();
    const preventDefault = vi.fn();
    (dialog.props.onKeydown as (event: unknown) => void)({
      key: "Escape",
      preventDefault,
    });
    await nextTick();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    open.value = true;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
  it("refreshes on completion, upload acknowledgement and visibility only while open", async () => {
    const container = root();
    const complete = ref(false);
    const revision = ref(0);
    const open = ref(true);
    const app = renderer.createApp({
      setup: () => () =>
        h(PublicLeaderboard, {
          puzzle,
          open: open.value,
          complete: complete.value,
          revision: revision.value,
        }),
    });
    app.mount(container);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(
      find(container, (n) => n.props.id === "public-leaderboard"),
    ).toBeDefined();
    complete.value = true;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    revision.value += 1;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    const visible = vi
      .mocked(document.addEventListener)
      .mock.calls.find(
        ([event]) => event === "visibilitychange",
      )![1] as EventListener;
    visible(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    open.value = false;
    await nextTick();
    visible(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(4);
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
      setup: () => () =>
        h(PublicLeaderboard, { puzzle: selected.value, open: true }),
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
  it("opens a non-dismissible name setup after a first login without account controls", async () => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("Document", class {});
    vi.stubGlobal("ShadowRoot", class {});
    auth.user!.value = null;
    localStorage.setItem("tako-sen.tutorial.v2", "seen");
    request.mockImplementation(async (path: string) =>
      Response.json(
        path === "/api/profile"
          ? { profile: null }
          : path === "/api/plays"
            ? { plays: [] }
            : { entries: [] },
      ),
    );
    const container = root();
    renderer.render(h(App), container);
    await nextTick();
    auth.user!.value = "new-account";
    await vi.waitFor(() =>
      expect(
        find(container, (n) => n.props["aria-labelledby"] === "account-title"),
      ).toBeDefined(),
    );
    const dialog = find(
      container,
      (n) => n.props["aria-labelledby"] === "account-title",
    )!;
    expect(find(dialog, (n) => n.tag === "h2")?.text).toBe("ゲーム名を設定");
    expect(find(dialog, (n) => n.tag === "input")).toBeDefined();
    expect(find(dialog, (n) => n.text === "ログアウト")).toBeUndefined();
    expect(
      find(dialog, (n) => n.text === "退会してオンライン履歴を削除"),
    ).toBeUndefined();
    expect(
      find(dialog, (n) => n.props["aria-label"] === "アカウントを閉じる"),
    ).toBeUndefined();
    const preventDefault = vi.fn();
    (dialog.props.onKeydown as (event: unknown) => void)({
      key: "Escape",
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(
      find(container, (n) => n.props["aria-labelledby"] === "account-title"),
    ).toBeDefined();
  });

  it("shows online history separately without opening the account dialog", async () => {
    const container = root();
    const historyOpen = ref(false);
    renderer.render(
      h({
        setup: () => () =>
          h(AccountHistory, {
            plays: [],
            open: false,
            historyOpen: historyOpen.value,
          }),
      }),
      container,
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("/api/plays", expect.anything()),
    );
    request.mockClear();
    historyOpen.value = true;
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("/api/plays", expect.anything()),
    );
    expect(find(container, (n) => n.props.role === "dialog")).toBeUndefined();
    expect(
      find(container, (n) => n.tag === "h3" && n.text === "オンライン履歴"),
    ).toBeDefined();
    historyOpen.value = false;
    await nextTick();
    expect(
      find(container, (n) => n.tag === "h3" && n.text === "オンライン履歴"),
    ).toBeUndefined();
  });
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
