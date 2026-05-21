import { isTauriRuntime } from './tauriRuntime';

/** Show or hide the main window (system tray integration on desktop). */
export async function setTauriMainWindowVisible(visible: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (visible) {
      await win.show();
      await win.setFocus();
    } else {
      await win.hide();
    }
  } catch {
    /* tray/window API unavailable */
  }
}
