import type { ChildProcess } from "node:child_process";
import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";

type TerminateChildProcessOptions = {
  platform?: DesktopPlatform;
  gracefulSignal?: NodeJS.Signals;
  gracefulTimeoutMs?: number;
  forceSignal?: NodeJS.Signals;
  totalTimeoutMs?: number;
};

const DEFAULT_GRACEFUL_SIGNAL: NodeJS.Signals = "SIGINT";
const DEFAULT_FORCE_SIGNAL: NodeJS.Signals = "SIGKILL";
const DEFAULT_GRACEFUL_TIMEOUT_MS = 1_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 3_000;

export async function terminateChildProcess(
  child: ChildProcess | undefined,
  options: TerminateChildProcessOptions = {}
): Promise<boolean> {
  if (!child || child.exitCode !== null || child.killed) {
    return true;
  }

  const platform = options.platform ?? detectDesktopPlatform(process.platform);
  const gracefulSignal = options.gracefulSignal ?? DEFAULT_GRACEFUL_SIGNAL;
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
  const forceSignal = options.forceSignal ?? DEFAULT_FORCE_SIGNAL;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;

    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      clearTimeout(totalTimer);
      child.removeListener("exit", handleExit);
      child.removeListener("error", handleError);
      resolve(value);
    };

    const handleExit = (): void => finish(true);
    const handleError = (): void => finish(false);

    const totalTimer = setTimeout(() => {
      finish(false);
    }, totalTimeoutMs);

    child.once("exit", handleExit);
    child.once("error", handleError);

    if (platform === "windows") {
      tryKill(child, forceSignal);
      return;
    }

    tryKill(child, gracefulSignal);
    forceTimer = setTimeout(() => {
      tryKill(child, forceSignal);
    }, gracefulTimeoutMs);
  });
}

function tryKill(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // Best-effort termination.
  }
}
