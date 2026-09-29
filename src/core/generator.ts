import {
  generatePuzzleWithAnalysis as generateG1,
  type GenerateOptions as LegacyGenerateOptions,
  type GeneratedPuzzle,
} from "./generator-g1";
import { generateG2 } from "./generator-g2";
import type { Puzzle } from "./model";

export type { GeneratedPuzzle } from "./generator-g1";
export interface GenerateOptions extends LegacyGenerateOptions {
  readonly version?: string;
}

export const GENERATOR_VERSION = "g2";

export function isSupportedGeneratorVersion(version: string): boolean {
  return version === "g1" || version === "g2";
}

export function generatePuzzleWithAnalysis(
  options: GenerateOptions = {},
): GeneratedPuzzle {
  const version = options.version ?? GENERATOR_VERSION;
  if (version === "g1") return generateG1(options);
  if (version === "g2") return generateG2(options);
  throw new Error(`Unsupported generator version: ${version}`);
}

export function generatePuzzle(options: GenerateOptions = {}): Puzzle {
  return generatePuzzleWithAnalysis(options).puzzle;
}
