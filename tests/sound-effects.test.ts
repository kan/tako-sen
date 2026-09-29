import { describe, expect, it, vi } from "vitest";
import {
  createSoundEffects,
  soundEffectForFeedback,
  type SoundEffectKind,
} from "../src/ui/sound-effects";
import type { CellFeedbackKind } from "../src/ui/feedback";
import { audioDevice } from "./audio-device";

describe("sound feedback selection", () => {
  const feedback = (kind: CellFeedbackKind) => ({ kind, cell: 1, order: 0 });
  it.each([
    ["excluded-add", "excluded-add"],
    ["shortcut-exclude", "excluded-add"],
    ["piece-place", "piece-place"],
    ["excluded-remove", undefined],
    ["fixed-error", undefined],
  ] as const)(
    "selects %s without adding deletion or error sounds",
    (kind, expected) => {
      expect(soundEffectForFeedback([feedback(kind)], false)).toBe(expected);
    },
  );
  it("prioritizes a single CLEAR cue over placement and associated crosses", () => {
    const feedbacks = [feedback("piece-place"), feedback("excluded-add")];
    expect(soundEffectForFeedback(feedbacks, false)).toBe("piece-place");
    expect(soundEffectForFeedback(feedbacks, true)).toBe("clear");
    expect(soundEffectForFeedback([], false)).toBeUndefined();
    expect(
      soundEffectForFeedback(
        [feedback("fixed-error"), feedback("excluded-add")],
        false,
      ),
    ).toBeUndefined();
  });
});

describe("optional synthesized sound effects", () => {
  it("defaults off, creates only on a gesture, and reuses one context", async () => {
    const device = audioDevice();
    const factory = vi.fn(() => device.audio);
    const player = createSoundEffects(factory, () => true);
    expect(player.play("clear")).toBe(false);
    expect(await player.unlock()).toBe(false);
    player.setEnabled(true);
    expect(factory).not.toHaveBeenCalled();
    expect(await player.unlock()).toBe(true);
    expect(device.oscillators).toHaveLength(0);
    expect(player.play("piece-place")).toBe(true);
    expect(player.play("clear")).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it.each(["excluded-add", "piece-place", "clear"] as SoundEffectKind[])(
    "schedules a short low-gain %s cue and releases its nodes",
    (kind) => {
      const device = audioDevice();
      const player = createSoundEffects(
        () => device.audio,
        () => true,
      );
      player.setEnabled(true);
      expect(player.play(kind)).toBe(true);
      const oscillator = device.oscillators[0];
      const gain = device.gains[0];
      expect(oscillator.start).toHaveBeenCalledWith(1);
      expect(oscillator.stop.mock.calls[0][0]).toBeLessThanOrEqual(1.5);
      expect(
        gain.gain.linearRampToValueAtTime.mock.calls[0][0],
      ).toBeLessThanOrEqual(0.05);
      expect(gain.gain.linearRampToValueAtTime.mock.calls.at(-1)![0]).toBe(0);
      oscillator.onended!();
      expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    },
  );
  it("does not queue old cues while resume is pending or rejected", async () => {
    const device = audioDevice();
    device.context.state = "suspended";
    let resolve!: () => void;
    device.context.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const player = createSoundEffects(
      () => device.audio,
      () => true,
    );
    player.setEnabled(true);
    expect(player.play("piece-place")).toBe(false);
    expect(player.play("clear")).toBe(false);
    expect(device.context.resume).toHaveBeenCalledTimes(1);
    const pending = player.unlock();
    player.setEnabled(false);
    device.context.state = "running";
    resolve();
    await pending;
    expect(device.oscillators).toHaveLength(0);
    expect(player.play("clear")).toBe(false);
    device.context.state = "suspended";
    device.context.resume.mockRejectedValue(new Error("autoplay denied"));
    player.setEnabled(true);
    expect(await player.unlock()).toBe(false);
    expect(device.oscillators).toHaveLength(0);
  });
  it("throttles drag crosses, limits polyphony and stops existing voices on CLEAR", () => {
    const device = audioDevice();
    const player = createSoundEffects(
      () => device.audio,
      () => true,
    );
    player.setEnabled(true);
    expect(player.play("excluded-add")).toBe(true);
    expect(player.play("excluded-add")).toBe(false);
    device.context.currentTime += 0.05;
    expect(player.play("excluded-add")).toBe(true);
    player.play("piece-place");
    player.play("piece-place");
    expect(device.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    const preceding = device.oscillators.at(-1)!;
    player.play("clear");
    expect(preceding.disconnect).toHaveBeenCalledTimes(1);
  });
  it("stops on mute/background and closes on disposal without later playback", async () => {
    const device = audioDevice();
    let foreground = true;
    const player = createSoundEffects(
      () => device.audio,
      () => foreground,
    );
    player.setEnabled(true);
    player.play("clear");
    player.setEnabled(false);
    expect(device.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    player.setEnabled(true);
    foreground = false;
    expect(player.play("clear")).toBe(false);
    expect(await player.unlock()).toBe(false);
    foreground = true;
    player.play("piece-place");
    player.stop();
    expect(device.oscillators[1].disconnect).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(device.context.close).toHaveBeenCalledTimes(1);
    expect(player.play("clear")).toBe(false);
  });
  it("fails silently for missing APIs, constructor errors and node errors", async () => {
    for (const factory of [
      () => undefined,
      () => {
        throw new Error("unsupported");
      },
    ]) {
      const player = createSoundEffects(factory, () => true);
      player.setEnabled(true);
      expect(await player.unlock()).toBe(false);
      expect(player.play("clear")).toBe(false);
    }
    const device = audioDevice();
    device.context.createGain.mockImplementation(() => {
      throw new Error("device unavailable");
    });
    const player = createSoundEffects(
      () => device.audio,
      () => true,
    );
    player.setEnabled(true);
    expect(player.play("piece-place")).toBe(false);
    player.dispose();
  });
});
