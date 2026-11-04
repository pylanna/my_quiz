import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

// The pages load these as plain browser scripts. Evaluate them CommonJS-style (package.json says "type": "module").
function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const qrcode = load("../public/vendor/qrcode.js");
const { matrix, pathData, viewBoxSize, QUIET_ZONE } = load("../public/qr.js");

/** Rasterise the SVG path data the page draws, then decode it like a phone camera would. */
function decode(text, scale = 8) {
  const rows = matrix(qrcode, text);
  const n = rows.length;
  const size = viewBoxSize(n);
  const grid = Array.from({ length: size }, () => Array(size).fill(false));
  for (const m of pathData(rows).matchAll(/M(\d+) (\d+)h1v1h-1z/g)) grid[Number(m[2])][Number(m[1])] = true;
  const px = size * scale;
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255); // white, opaque
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      if (!grid[Math.floor(y / scale)][Math.floor(x / scale)]) continue;
      const i = (y * px + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  return jsQR(rgba, px, px)?.data ?? null;
}

describe("QR code for the join link", () => {
  it("decodes back to the join URL", () => {
    const url = "https://my-quiz.tech-on-the-rock.workers.dev/?pin=123456";
    expect(decode(url)).toBe(url);
  });

  it("decodes for short, long and non-ASCII-free URLs alike", () => {
    for (const url of ["http://localhost:8787/?pin=000001", "https://a.b/?pin=999999", "https://example.com/" + "x".repeat(150) + "?pin=123456"]) {
      expect(decode(url)).toBe(url);
    }
  });

  it("has a quiet zone of at least 4 modules on every side", () => {
    expect(QUIET_ZONE).toBeGreaterThanOrEqual(4);
    const rows = matrix(qrcode, "https://a.b/?pin=123456");
    expect(viewBoxSize(rows.length)).toBe(rows.length + 2 * QUIET_ZONE);
  });

  it("path data is only digits and path commands, never page content", () => {
    expect(pathData(matrix(qrcode, "https://a.b/?pin=123456"))).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});
