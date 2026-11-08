export type ReleaseAssetKind =
  | 'linuxDeb'
  | 'linuxRpm'
  | 'linuxAppImage'
  | 'windowsSetup'
  | 'windowsMsi'
  | 'macDmg'
  | 'macUpdater'
  | 'linuxSbom'
  | 'linuxNotices'
  | 'windowsSbom'
  | 'windowsNotices'
  | 'macSbom'
  | 'macNotices';

export interface AssetValidationResult {
  ok: boolean;
  errors: string[];
  selected: Partial<Record<ReleaseAssetKind, string>>;
}

export interface ReleaseAssetRecord {
  name: string;
  size: number;
  digest: string;
}

export interface RemoteReleaseAssetRecord {
  name: string;
  size: number | string;
  digest: string;
}

export function validateReleaseAssetNames(
  assetNames: readonly string[],
  version: string,
): AssetValidationResult;

export function validateLatestManifest(input: {
  manifest: unknown;
  version: string;
  repository: string;
  assetNames: readonly string[];
  signatures?: Readonly<Record<string, string>>;
}): { ok: boolean; errors: string[] };

export function validateRemoteAssetRecords(
  localAssets: readonly ReleaseAssetRecord[],
  remoteAssets: readonly RemoteReleaseAssetRecord[],
): { ok: boolean; errors: string[] };
