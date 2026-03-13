import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";
import { shell, systemPreferences } from "electron";
import { type MicrophoneAccessStatus, type PermissionsSnapshot, type SystemSettingsTarget } from "../../shared/types";

export type AutoPasteSupport = {
  supported: boolean;
  statusMessage?: string;
};

export type MicrophonePreflightStatus = "granted" | "requestable" | "blocked" | "retryable";

export class PermissionService {
  constructor(private readonly platform: DesktopPlatform = detectDesktopPlatform(process.platform)) {}

  async requestMicrophonePermission(): Promise<boolean> {
    const status = this.getMicrophonePermissionStatus();
    if (status === "granted") {
      return true;
    }

    if (this.platform === "macos") {
      return systemPreferences.askForMediaAccess("microphone");
    }

    this.openSystemSettings("microphone");
    return false;
  }

  getMicrophonePreflightStatus(): MicrophonePreflightStatus {
    const status = this.getMicrophonePermissionStatus();

    if (status === "granted") {
      return "granted";
    }

    if (this.platform === "macos") {
      return status === "denied" || status === "restricted" ? "blocked" : "requestable";
    }

    return status === "denied" || status === "restricted" ? "blocked" : "retryable";
  }

  checkAutoPasteAccess(prompt: boolean): boolean {
    if (this.platform !== "macos") {
      return true;
    }

    return systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  getMicrophonePermissionStatus(): MicrophoneAccessStatus {
    let status: string;
    try {
      status = systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      return "unknown";
    }

    if (status === "granted" || status === "denied" || status === "restricted" || status === "not-determined") {
      return status;
    }

    return "unknown";
  }

  openSystemSettings(target: SystemSettingsTarget = "auto-paste"): boolean {
    if (this.platform === "macos") {
      const suffix = target === "microphone" ? "Privacy_Microphone" : "Privacy_Accessibility";
      void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${suffix}`);
      return true;
    }

    if (this.platform === "windows") {
      if (target === "microphone") {
        void shell.openExternal("ms-settings:privacy-microphone");
        return true;
      }

      return false;
    }

    return false;
  }

  getPermissionsSnapshot(autoPasteSupport: AutoPasteSupport = { supported: true }, hotkeyMessage?: string): PermissionsSnapshot {
    return {
      platform: this.platform,
      microphone: this.getMicrophonePermissionStatus(),
      autoPasteAccessGranted: this.checkAutoPasteAccess(false),
      autoPasteAccessRequired: this.platform === "macos",
      autoPasteAccessLabel: this.platform === "macos" ? "Accessibility" : "Auto-paste access",
      autoPasteSupported: autoPasteSupport.supported,
      autoPasteStatusMessage: autoPasteSupport.statusMessage,
      canOpenMicrophoneSettings: this.platform === "macos" || this.platform === "windows",
      canOpenAutoPasteSettings: this.platform === "macos",
      hotkeyReady: !hotkeyMessage,
      hotkeyMessage
    };
  }

  getMicrophoneDeniedMessage(): string {
    if (this.platform === "windows") {
      return "Microphone access is blocked in system settings.";
    }

    return "Microphone permission is required";
  }

  getAutoPasteAccessDeniedMessage(): string {
    if (this.platform === "macos") {
      return "Accessibility permission is required for paste automation";
    }

    return "Auto-paste could not be prepared on this system.";
  }
}
