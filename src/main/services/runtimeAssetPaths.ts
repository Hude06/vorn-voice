import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEV_RUNTIME_ROOT = path.join(process.cwd(), "build", "runtime");

export function getBundledAssetCandidates(...segments: string[]): string[] {
  const candidates = [
    path.join(process.resourcesPath, ...segments),
    path.join(DEV_RUNTIME_ROOT, ...segments)
  ];

  return Array.from(new Set(candidates));
}

export async function resolveBundledExecutable(...segments: string[]): Promise<string | undefined> {
  for (const candidate of getBundledAssetCandidates(...segments)) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function resolveBundledFile(minBytes: number, ...segments: string[]): Promise<string | undefined> {
  for (const candidate of getBundledAssetCandidates(...segments)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.size >= minBytes) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}
