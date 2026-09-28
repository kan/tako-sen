import type { KeyValueStorage } from "./storage";

const TUTORIAL_KEY = "tako-sen.tutorial.v1";

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
