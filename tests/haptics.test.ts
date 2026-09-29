import { describe, expect, it, vi } from "vitest";
import {
  requestVibration,
  vibrationApiAvailable,
  vibrateForFeedback,
} from "../src/ui/feedback";

describe("optional vibration requests", () => {
  it("detects the API without assuming hardware vibration or making a request", () => {
    const vibrate = vi.fn(() => true);
    expect(vibrationApiAvailable({})).toBe(false);
    expect(vibrationApiAvailable({ vibrate })).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();
  });
  it("does nothing on unsupported browsers", () => {
    expect(requestVibration({}, 100, true)).toBe("unavailable");
    expect(vibrateForFeedback({}, "piece-place", true)).toBe(false);
  });
  it("does not request vibration when disabled", () => {
    const vibrate = vi.fn(() => true);
    expect(requestVibration({ vibrate }, 100, false)).toBe("disabled");
    expect(vibrateForFeedback({ vibrate }, "clear", false)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "reports API acceptance %s, not actual motor feedback",
    (accepted) => {
      const vibrate = vi.fn(() => accepted);
      expect(requestVibration({ vibrate }, 100, true)).toBe(
        accepted ? "accepted" : "rejected",
      );
      expect(vibrate).toHaveBeenCalledWith(100);
      expect(vibrateForFeedback({ vibrate }, "piece-place", true)).toBe(
        accepted,
      );
    },
  );
  it("contains device exceptions so optional haptics cannot interrupt play", () => {
    const vibrate = vi.fn(() => {
      throw new Error("blocked by browser");
    });
    expect(requestVibration({ vibrate }, 100, true)).toBe("failed");
    expect(vibrateForFeedback({ vibrate }, "fixed-error", true)).toBe(false);
  });
  it("keeps the Navigator receiver and copies readonly patterns", () => {
    const pattern = Object.freeze([20, 28, 45]);
    const device = {
      vibrate(value: VibratePattern) {
        expect(this).toBe(device);
        expect(value).toEqual(pattern);
        expect(value).not.toBe(pattern);
        if (Array.isArray(value)) value[0] = 999;
        return true;
      },
    };
    expect(requestVibration(device, pattern, true)).toBe("accepted");
    expect(pattern).toEqual([20, 28, 45]);
  });
});
