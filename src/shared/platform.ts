export type DesktopPlatform = "macos" | "windows" | "linux";

type GlobalProcess = {
  process?: {
    platform?: unknown;
  };
};

type GlobalNavigator = {
  navigator?: {
    userAgent?: string;
  };
};

export function detectDesktopPlatform(explicitPlatform?: string): DesktopPlatform {
  const platform = explicitPlatform ?? readRuntimePlatform();

  if (platform === "darwin") {
    return "macos";
  }

  if (platform === "win32") {
    return "windows";
  }

  return "linux";
}

export function desktopPlatformLabel(platform: DesktopPlatform = detectDesktopPlatform()): string {
  switch (platform) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    default:
      return "Linux";
  }
}

function readRuntimePlatform(): string {
  const processPlatform = (globalThis as GlobalProcess).process?.platform;
  if (typeof processPlatform === "string") {
    return processPlatform;
  }

  const userAgent = (globalThis as GlobalNavigator).navigator?.userAgent;
  if (typeof userAgent === "string") {
    if (/Windows/i.test(userAgent)) {
      return "win32";
    }

    if (/Macintosh|Mac OS X/i.test(userAgent)) {
      return "darwin";
    }
  }

  return "darwin";
}
