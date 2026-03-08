import { PrivacyPane } from "../../shared/types";
import { shell, systemPreferences } from "electron";

export class PermissionService {
  async requestMicrophonePermission(): Promise<boolean> {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") {
      return true;
    }
    return systemPreferences.askForMediaAccess("microphone");
  }

  checkAccessibilityPermission(prompt: boolean): boolean {
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  getMicrophonePermissionStatus(): "granted" | "denied" | "restricted" | "not-determined" | "unknown" {
    const status = systemPreferences.getMediaAccessStatus("microphone");

    if (status === "granted" || status === "denied" || status === "restricted" || status === "not-determined") {
      return status;
    }

    return "unknown";
  }

  openPrivacySettings(pane: PrivacyPane = "accessibility"): void {
    const suffix = pane === "microphone" ? "Privacy_Microphone" : "Privacy_Accessibility";
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${suffix}`);
  }
}
