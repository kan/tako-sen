import type { KeyValueStorage } from "./storage";

// v1 は紙芝居版の既読記録。操作型チュートリアルは既読を引き継がない。
const TUTORIAL_KEY = "tako-sen.tutorial.v2";

export function shouldShowTutorial(storage: KeyValueStorage): boolean {
  try {
    return storage.getItem(TUTORIAL_KEY) !== "seen";
  } catch {
    return true;
  }
}

export function rememberTutorial(storage: KeyValueStorage): void {
  try {
    storage.setItem(TUTORIAL_KEY, "seen");
  } catch {
    // 保存できない環境でもチュートリアルを閉じてプレイできる。
  }
}
