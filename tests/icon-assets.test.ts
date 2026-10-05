import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared octopus assets", () => {
  it("provides a square, font-independent SVG for the board, tutorial and favicon", () => {
    const svg = readFileSync("public/tako.svg", "utf8");
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toMatch(/<text|🐙|<script|<image/);
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('type="image/svg+xml" href="/tako.svg"');
  });

  it.each([
    ["favicon-32.png", 32, 6],
    ["apple-touch-icon.png", 180, 2],
  ])("provides a correctly sized PNG for %s", (name, size, colorType) => {
    const png = readFileSync(`public/${name}`);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    // Transparent favicon (RGBA); opaque home-screen icon (RGB).
    expect(png[25]).toBe(colorType);
    expect(readFileSync("index.html", "utf8")).toContain(`href="/${name}"`);
  });
});
