import { desktopPlatform } from './desktopPlatform';

/** Show or hide the main window (system tray integration on desktop). */
export async function setTauriMainWindowVisible(visible: boolean): Promise<void> {
  try {
    if (visible) {
      await desktopPlatform.window.show();
      await desktopPlatform.window.setFocus();
    } else {
      await desktopPlatform.window.hide();
    }
  } catch {
    /* tray/window API unavailable */
  }
}
