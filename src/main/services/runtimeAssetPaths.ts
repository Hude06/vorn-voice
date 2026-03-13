import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { detectDesktopPlatform } from "../../shared/platform";

const DEV_RUNTIME_ROOT = path.join(process.cwd(), "build", "runtime");

export function getBundledAssetCandidates(...segments: string[]): string[] {
  const segmentVariants = expandExecutableSegments(segments);
  const candidates = [
    ...segmentVariants.map((variant) => path.join(process.resourcesPath, ...variant)),
    ...segmentVariants.map((variant) => path.join(DEV_RUNTIME_ROOT, ...variant))
  ];

  return Array.from(new Set(candidates));
}

export async function resolveBundledExecutable(...segments: string[]): Promise<string | undefined> {
  for (const candidate of getBundledAssetCandidates(...segments)) {
    try {
      await fs.access(candidate, detectDesktopPlatform(process.platform) === "windows" ? fsConstants.F_OK : fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function expandExecutableSegments(segments: string[]): string[][] {
  if (segments.length === 0) {
    return [segments];
  }

  const platform = detectDesktopPlatform(process.platform);
  if (platform !== "windows") {
    return [segments];
  }

  const fileName = segments[segments.length - 1];
  if (path.extname(fileName) !== "") {
    return [segments];
  }

  return [
    segments,
    [...segments.slice(0, -1), `${fileName}.exe`]
  ];
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
