// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { APP_DATA_ADMISSION_CONTRACT_VERSION } from '../../../packages/desktop-contracts/src/types';
import { APP_DATA_WRITERS_LOCK_FILE, PROJECT_LOCKS_DIR_NAME } from '../../../services/fs/fsCore';

// #831: the Rust reclaim must target exactly the files the TypeScript project lock creates.
const rust = readFileSync('src-tauri/src/instance_lock.rs', 'utf8');
const fsCore = readFileSync('services/fs/fsCore.ts', 'utf8');
const command = readFileSync('src-tauri/src/commands/app_data_instance.rs', 'utf8');

describe('app-data writers lock contract (#831)', () => {
  it('uses the writers lock file Factory Reset keeps', () => {
    expect(rust).toContain(`pub const WRITERS_LOCK_FILE: &str = "${APP_DATA_WRITERS_LOCK_FILE}";`);
  });

  it('reclaims in the directory the project lock writes to', () => {
    expect(rust).toContain(`pub const PROJECT_LOCKS_DIR: &str = "${PROJECT_LOCKS_DIR_NAME}";`);
  });

  it('reclaims only files with the project lock suffix', () => {
    const suffix = /const LOCK_SUFFIX = '([^']+)';/.exec(fsCore)?.[1];
    expect(suffix).toBe('.lock');
    expect(rust).toContain(`pub const PROJECT_LOCK_SUFFIX: &str = "${suffix}";`);
  });

  it('uses one admission contract version on both sides of the native boundary', () => {
    expect(command).toContain(
      `pub const APP_DATA_ADMISSION_CONTRACT_VERSION: &str = "${APP_DATA_ADMISSION_CONTRACT_VERSION}";`,
    );
  });

  it('is proven on every desktop platform by compiling the std-only module on its own', () => {
    const workflow = parse(
      readFileSync('.github/workflows/instance-lock-platforms.yml', 'utf8'),
    ) as {
      on: { pull_request: { paths: string[] }; push: { paths: string[] } };
      jobs: Record<string, { strategy: { matrix: { os: string[] } }; steps: { run?: string }[] }>;
    };
    for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
      expect(trigger.paths).toContain('src-tauri/src/instance_lock.rs');
    }
    const job = Object.values(workflow.jobs)[0]!;
    expect(job.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest', 'macos-latest']);
    const run = job.steps.map((step) => step.run ?? '').join('\n');
    expect(run).toContain('rustc --edition 2021 --test src-tauri/src/instance_lock.rs');
  });
});
