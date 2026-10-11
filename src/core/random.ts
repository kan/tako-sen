export interface RandomSource {
  next(): number;
}

export function createSeededRandom(seed: string): RandomSource {
  let state = hashSeed(seed);
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * For generator versions from g3 on. createSeededRandom folds the seed into
 * 32 bits and reads only half of each surrogate pair, so distinct seeds can
 * share a board; g1 and g2 keep it because their boards must not change.
 * This one hashes whole code points into 128 bits (cyrb128) and steps them
 * with sfc32, using 32-bit integer arithmetic only.
 */
export function createWideSeededRandom(seed: string): RandomSource {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (const char of seed) {
    const code = char.codePointAt(0)!;
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  let a = h1 | 0;
  let b = (h2 ^ h1) | 0;
  let c = (h3 ^ h1) | 0;
  let d = (h4 ^ h1) | 0;
  const source = {
    next() {
      const sum = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + sum) | 0;
      return (sum >>> 0) / 4294967296;
    },
  };
  // Discard the first outputs, which still correlate with the hash.
  for (let i = 0; i < 15; i += 1) source.next();
  return source;
}

export function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
