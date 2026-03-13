import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";
import { resolveBundledExecutable } from "./runtimeAssetPaths";

export type RuntimeExecutableLookup = {
  path?: string;
  checkedPaths: string[];
  pathEnv: string;
};

type RuntimeExecutableOptions = {
  baseNames: string[];
  envKeys?: string[];
  fixedCandidates?: string[];
};

export async function locateRuntimeExecutable(options: RuntimeExecutableOptions): Promise<RuntimeExecutableLookup> {
  const platform = detectDesktopPlatform(process.platform);
  const pathEnv = process.env.PATH ?? "";
  const checkedPaths: string[] = [];
  const seenPaths = new Set<string>();

  const checkPath = async (candidate: string): Promise<boolean> => {
    if (!candidate || seenPaths.has(candidate)) {
      return false;
    }

    seenPaths.add(candidate);
    checkedPaths.push(candidate);
    return isRunnableFile(candidate, platform);
  };

  for (const envKey of options.envKeys ?? []) {
    const candidate = process.env[envKey];
    if (typeof candidate === "string" && (await checkPath(candidate))) {
      return { path: candidate, checkedPaths, pathEnv };
    }
  }

  for (const baseName of options.baseNames) {
    const bundledPath = await resolveBundledExecutable("bin", baseName);
    if (bundledPath && (await checkPath(bundledPath))) {
      return { path: bundledPath, checkedPaths, pathEnv };
    }
  }

  for (const candidate of options.fixedCandidates ?? []) {
    if (await checkPath(candidate)) {
      return { path: candidate, checkedPaths, pathEnv };
    }
  }

  const pathDirectories = pathEnv.split(path.delimiter).filter((segment) => segment.length > 0);
  const executableNames = executableFileNames(options.baseNames, platform);
  for (const directory of pathDirectories) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (await checkPath(candidate)) {
        return { path: candidate, checkedPaths, pathEnv };
      }
    }
  }

  const shellResolvedPath = await resolveFromSystemLookup(executableNames, platform);
  if (shellResolvedPath && (await checkPath(shellResolvedPath))) {
    return { path: shellResolvedPath, checkedPaths, pathEnv };
  }

  return { checkedPaths, pathEnv };
}

export async function isRunnableFile(
  candidate: string,
  platform: DesktopPlatform = detectDesktopPlatform(process.platform)
): Promise<boolean> {
  try {
    await fs.access(candidate, platform === "windows" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function executableFileName(
  baseName: string,
  platform: DesktopPlatform = detectDesktopPlatform(process.platform)
): string {
  if (platform === "windows" && path.extname(baseName) === "") {
    return `${baseName}.exe`;
  }

  return baseName;
}

function executableFileNames(
  baseNames: string[],
  platform: DesktopPlatform = detectDesktopPlatform(process.platform)
): string[] {
  return Array.from(new Set(baseNames.map((baseName) => executableFileName(baseName, platform))));
}

async function resolveFromSystemLookup(
  executableNames: string[],
  platform: DesktopPlatform
): Promise<string | undefined> {
  const lookupCommand = platform === "windows" ? "where" : "which";

  for (const executableName of executableNames) {
    const resolved = await new Promise<string | undefined>((resolve) => {
      const child = spawn(lookupCommand, [executableName], { stdio: ["ignore", "pipe", "ignore"] });

      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });

      child.on("error", () => resolve(undefined));
      child.on("exit", (code) => {
        if (code !== 0) {
          resolve(undefined);
          return;
        }

        const firstLine = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);

        resolve(firstLine);
      });
    });

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}
