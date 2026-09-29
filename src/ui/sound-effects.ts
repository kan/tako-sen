import type { CellFeedback } from "./feedback";

export type SoundEffectKind = "excluded-add" | "piece-place" | "clear";

export function soundEffectForFeedback(
  feedbacks: readonly CellFeedback[],
  justCleared: boolean,
): SoundEffectKind | undefined {
  if (justCleared) return "clear";
  if (feedbacks.some((feedback) => feedback.kind === "fixed-error")) return;
  if (feedbacks.some((feedback) => feedback.kind === "piece-place"))
    return "piece-place";
  if (
    feedbacks.some(
      (feedback) =>
        feedback.kind === "excluded-add" ||
        feedback.kind === "shortcut-exclude",
    )
  )
    return "excluded-add";
  return undefined;
}

const sounds = {
  "excluded-add": {
    waveform: "sine",
    frequencies: [660, 440],
    duration: 0.045,
    gain: 0.035,
  },
  "piece-place": {
    waveform: "triangle",
    frequencies: [660, 880],
    duration: 0.1,
    gain: 0.05,
  },
  clear: {
    waveform: "sine",
    frequencies: [523.25, 659.25, 783.99, 1046.5],
    duration: 0.42,
    gain: 0.05,
  },
} satisfies Record<
  SoundEffectKind,
  {
    waveform: OscillatorType;
    frequencies: readonly number[];
    duration: number;
    gain: number;
  }
>;

/** 音声API・自動再生制限・端末の出力状態に、ゲームの進行を依存させない。 */
export function createSoundEffects(
  createContext: () => AudioContext | undefined,
  isForeground: () => boolean,
) {
  let enabled = false;
  let disposed = false;
  let context: AudioContext | undefined;
  let resuming: Promise<boolean> | undefined;
  let lastExclusionTime = -Infinity;
  const voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();

  function cleanup(voice: {
    oscillator: OscillatorNode;
    gain: GainNode;
  }): void {
    if (!voices.delete(voice)) return;
    try {
      voice.oscillator.disconnect();
    } catch {
      /* 任意の演出なので失敗しても継続する。 */
    }
    try {
      voice.gain.disconnect();
    } catch {
      /* 同上。 */
    }
  }

  function stop(): void {
    for (const voice of voices) {
      try {
        voice.oscillator.stop();
      } catch {
        /* 終了済みの場合も片付ける。 */
      }
      cleanup(voice);
    }
    lastExclusionTime = -Infinity;
  }

  function setEnabled(value: boolean): void {
    enabled = value;
    if (!value) stop();
  }

  // ユーザー操作内から呼ぶ。resume中の操作音はキューに溜めず、後から再生しない。
  function unlock(): Promise<boolean> {
    if (!enabled || disposed || !isForeground()) return Promise.resolve(false);
    try {
      context ??= createContext();
      if (!context || context.state === "closed") return Promise.resolve(false);
      if (context.state === "running") return Promise.resolve(true);
      resuming ??= context
        .resume()
        .then(() => context?.state === "running")
        .catch(() => false)
        .finally(() => {
          resuming = undefined;
        });
      return resuming;
    } catch {
      return Promise.resolve(false);
    }
  }

  function play(kind: SoundEffectKind): boolean {
    if (!enabled || disposed || !isForeground()) return false;
    void unlock(); // contextの生成・resume要求自体は同期的に行う。
    if (!context || context.state !== "running") return false;
    const now = context.currentTime;
    // ドラッグ中の×や一括配置で音を重ねすぎない。
    if (kind === "excluded-add" && now - lastExclusionTime < 0.045)
      return false;
    if (kind === "clear" || voices.size >= 3) stop();
    const sound = sounds[kind];
    let voice: { oscillator: OscillatorNode; gain: GainNode } | undefined;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      voice = { oscillator, gain };
      voices.add(voice);
      oscillator.type = sound.waveform;
      sound.frequencies.forEach((frequency, index) => {
        oscillator.frequency.setValueAtTime(
          frequency,
          now + (index * sound.duration) / sound.frequencies.length,
        );
      });
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(sound.gain, now + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + sound.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      const activeVoice = voice;
      oscillator.onended = () => cleanup(activeVoice);
      oscillator.start(now);
      oscillator.stop(now + sound.duration);
      if (kind === "excluded-add") lastExclusionTime = now;
      return true;
    } catch {
      if (voice) {
        try {
          voice.oscillator.stop();
        } catch {
          /* 開始前の失敗も無音で継続する。 */
        }
        cleanup(voice);
      }
      return false;
    }
  }

  function dispose(): void {
    disposed = true;
    stop();
    try {
      void context?.close().catch(() => {});
    } catch {
      /* 終了失敗を伝播させない。 */
    }
    context = undefined;
  }

  return { setEnabled, unlock, play, stop, dispose };
}
