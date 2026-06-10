/**
 * ProForge Capability Layer — the single source of truth for all ProForge operations.
 * QNBS-v3: One typed, validated, observable API consumed by every runtime: the in-app Copilot/UI
 * (browser adapter) and external AI agents over MCP (Node adapter). Business logic lives here and in
 * the existing services — adapters only supply ports. Each op: Zod-validate → permission gate →
 * structured log → delegate to ports/pure core → normalize errors to ProForgeError.
 *
 * Layering rule: this file imports ONLY types, pure modules, and the agent registry. No Redux/IDB.
 */

import type { MemoryBankEntry, PipelineRun, ReviewItem } from '../../features/proForge/types';
import { createLogger } from '../logger';
import { loadAgent } from './pipelineAgents/agentRegistry';
import { SupervisorAgent } from './pipelineAgents/supervisorAgent';
import {
  type ApplyEditsResultSummary,
  applyEditsPure,
  buildAgentContext,
  type ProForgeCapabilityPorts,
  type RunStageResult,
  resolveConfig,
  type SupervisorStatusEntry,
  selectRun,
  supervisorStatusFromRun,
} from './proForgeCapabilityCore';
import {
  type ApplyEditsInput,
  applyEditsInputSchema,
  type GetHistoryInput,
  type GetSupervisorStatusInput,
  getHistoryInputSchema,
  getSupervisorStatusInputSchema,
  ProForgeError,
  parseOrThrow,
  type RagQueryInput,
  type RunStageInput,
  ragQueryInputSchema,
  runStageInputSchema,
} from './proForgeCapabilitySchemas';

const log = createLogger('proforge.capability');

export class ProForgeCapabilityLayer {
  private readonly ports: ProForgeCapabilityPorts;

  constructor(ports: ProForgeCapabilityPorts) {
    this.ports = ports;
  }

  // -------------------------------------------------------------------------
  // Cross-cutting helpers
  // -------------------------------------------------------------------------

  /** Permission/feature-flag gate. Throws PERMISSION_DENIED when ProForge is disabled. */
  private assertEnabled(op: string): void {
    if (!this.ports.isEnabled()) {
      throw ProForgeError.permissionDenied(`ProForge is disabled; cannot run "${op}".`);
    }
  }

  /** Run a unit of work with structured logging + error normalization. */
  private async run<T>(op: string, ctx: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const scoped = log.withContext({ op, ...ctx });
    scoped.info(`proforge.${op} start`);
    try {
      const result = await fn();
      scoped.info(`proforge.${op} ok`);
      return result;
    } catch (err) {
      if (err instanceof ProForgeError) {
        scoped.warn(`proforge.${op} rejected`, { code: err.code, message: err.message });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      scoped.error(`proforge.${op} failed`, { message });
      throw ProForgeError.internal(`ProForge "${op}" failed: ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Op 1: runStage — execute a single pipeline stage agent + supervisor gate
  // -------------------------------------------------------------------------

  async runStage(rawInput: RunStageInput | unknown): Promise<RunStageResult> {
    const input = parseOrThrow(runStageInputSchema, rawInput, 'runStage');
    return this.run('runStage', { stage: input.stage, projectId: input.projectId }, async () => {
      this.assertEnabled('runStage');

      const snapshot = this.ports.project.get(input.projectId);
      if (!snapshot) throw ProForgeError.notFound(`Project not found: ${input.projectId}`);

      const config = resolveConfig(input.config);
      const context = buildAgentContext(snapshot, config, this.ports.gateway);

      const AgentClass = await loadAgent(input.stage);
      const agent = new AgentClass(context);

      const controller = new AbortController();
      let result: Awaited<ReturnType<typeof agent.execute>>;
      try {
        result = await agent.execute(controller.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw ProForgeError.stageFailed(`Stage "${input.stage}" agent failed: ${message}`);
      }

      // QNBS-v3: heuristic quality gate (no AI) — same gate the orchestrator applies between stages.
      const supervisor = new SupervisorAgent(context);
      const supervisorDecision = supervisor.evaluate(input.stage, result);

      return {
        stage: input.stage,
        reviewItems: result.reviewItems,
        metrics: result.metrics,
        agentOutput: result.agentOutput,
        supervisorDecision,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Op 2: getHistory — completed/aborted runs for a project
  // -------------------------------------------------------------------------

  async getHistory(rawInput: GetHistoryInput | unknown): Promise<PipelineRun[]> {
    const input = parseOrThrow(getHistoryInputSchema, rawInput, 'getHistory');
    return this.run('getHistory', { projectId: input.projectId }, async () => {
      this.assertEnabled('getHistory');
      const all = await this.ports.history.load(input.projectId);
      const filtered = input.runId ? all.filter((r) => r.id === input.runId) : all;
      return filtered.slice(0, input.limit);
    });
  }

  // -------------------------------------------------------------------------
  // Op 3: applyEdits — pure, offset-safe manuscript edit application
  // -------------------------------------------------------------------------

  async applyEdits(rawInput: ApplyEditsInput | unknown): Promise<ApplyEditsResultSummary> {
    const input = parseOrThrow(applyEditsInputSchema, rawInput, 'applyEdits');
    return this.run('applyEdits', { items: input.items.length, dryRun: input.dryRun }, async () => {
      this.assertEnabled('applyEdits');
      // QNBS-v3: editItemSchema is the lean subset planAcceptedManuscriptEdits actually reads.
      const items = input.items as unknown as ReviewItem[];
      return applyEditsPure(input.manuscript, items, input.dryRun);
    });
  }

  // -------------------------------------------------------------------------
  // Op 4: ragQuery — memory-bank retrieval (lexical / semantic / hybrid)
  // -------------------------------------------------------------------------

  async ragQuery(rawInput: RagQueryInput | unknown): Promise<MemoryBankEntry[]> {
    const input = parseOrThrow(ragQueryInputSchema, rawInput, 'ragQuery');
    return this.run('ragQuery', { projectId: input.projectId, mode: input.mode }, async () => {
      this.assertEnabled('ragQuery');
      return this.ports.memory(input.projectId).search(input.query, input.k, input.mode);
    });
  }

  // -------------------------------------------------------------------------
  // Op 5: getSupervisorStatus — per-stage heuristic gate results for a run
  // -------------------------------------------------------------------------

  async getSupervisorStatus(
    rawInput: GetSupervisorStatusInput | unknown,
  ): Promise<SupervisorStatusEntry[]> {
    const input = parseOrThrow(getSupervisorStatusInputSchema, rawInput, 'getSupervisorStatus');
    return this.run('getSupervisorStatus', { projectId: input.projectId }, async () => {
      this.assertEnabled('getSupervisorStatus');
      const runs = await this.ports.history.load(input.projectId);
      const run = selectRun(runs, input.runId);
      if (!run) {
        if (input.runId) throw ProForgeError.notFound(`Run not found: ${input.runId}`);
        return [];
      }
      return supervisorStatusFromRun(run);
    });
  }
}

/** Convenience factory. */
export function createProForgeCapabilityLayer(
  ports: ProForgeCapabilityPorts,
): ProForgeCapabilityLayer {
  return new ProForgeCapabilityLayer(ports);
}
