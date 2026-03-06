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

  openPrivacySettings(): void {
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy");
  }
}
