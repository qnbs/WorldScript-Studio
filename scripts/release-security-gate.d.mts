export interface ReleaseGateFailure {
  file: string;
  message: string;
}

export const GITHUB_SHA: string;
export const PROOF_INPUT_SHA: string;
export const AUDITED_SHA_OUTPUT: string;

export const REQUIRED_TAG_PUSH_CONDITIONS: readonly string[];
export const REQUIRED_PROTECTED_TAG_PUSH_CONDITIONS: readonly string[];
export const REQUIRED_VERIFIED_TAG_PUBLISH_CONDITIONS: readonly string[];
export const REQUIRED_PROOF_SIMULATION_CONDITIONS: readonly string[];

export const RELEASE_GATED_WORKFLOWS: Readonly<
  Record<
    string,
    {
      gatedJobs: string[];
      expectedSha: string;
      requiredEventConditions?: readonly string[];
      requiredNeeds?: readonly string[];
      verifyTagJob?: boolean;
      exactCheckoutRef?: string;
    }
  >
>;

export const REQUIRED_GATE_CONDITIONS: readonly string[];
export const REQUIRED_SCAN_ARGS: readonly string[];

export function checkReleaseSecurityWorkflow(
  fileName: string,
  source: string,
): ReleaseGateFailure[];

export function checkReleaseSecurityGates(root?: string): ReleaseGateFailure[];
