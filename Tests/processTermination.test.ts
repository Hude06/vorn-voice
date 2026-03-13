import { afterEach, describe, expect, it, vi } from "vitest";
import { terminateChildProcess } from "../src/main/services/processTermination";

type FakeChildProcess = {
  exitCode: number | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

describe("terminateChildProcess", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses graceful then forceful termination on macOS before timing out", async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();

    const resultPromise = terminateChildProcess(child as never, {
      platform: "macos",
      gracefulTimeoutMs: 100,
      totalTimeoutMs: 250
    });

    expect(child.kill).toHaveBeenCalledWith("SIGINT");

    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(150);
    await expect(resultPromise).resolves.toBe(false);
  });

  it("does not rely on graceful POSIX signals on Windows", async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();

    const resultPromise = terminateChildProcess(child as never, {
      platform: "windows",
      totalTimeoutMs: 200
    });

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(200);
    await expect(resultPromise).resolves.toBe(false);
  });

  it("resolves true when the child exits during shutdown", async () => {
    const child = createFakeChildProcess();

    const resultPromise = terminateChildProcess(child as never, {
      platform: "macos",
      totalTimeoutMs: 500
    });

    const exitListener = child.once.mock.calls.find(([event]) => event === "exit")?.[1] as (() => void) | undefined;
    expect(exitListener).toBeTypeOf("function");

    exitListener?.();
    await expect(resultPromise).resolves.toBe(true);
  });
});

function createFakeChildProcess(): FakeChildProcess {
  return {
    exitCode: null,
    killed: false,
    kill: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn()
  };
}
