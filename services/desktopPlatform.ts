/**
 * DesktopPlatform selector — resolves once (mirrors services/storageService.ts's StorageManager
 * resolve-once-and-delegate shape), so every call site imports `desktopPlatform` and never needs
 * its own isTauriRuntime() branch. See packages/desktop-contracts for the contract + both adapters.
 */

import type { DesktopPlatform } from '@domain/desktop-contracts';
import { tauriDesktopPlatform, webDesktopPlatform } from '@domain/desktop-contracts';
import { isTauriRuntime } from './tauriRuntime';

class DesktopPlatformManager {
  readonly platform: DesktopPlatform;

  constructor() {
    this.platform = isTauriRuntime() ? tauriDesktopPlatform : webDesktopPlatform;
  }
}

export const desktopPlatform: DesktopPlatform = new DesktopPlatformManager().platform;
