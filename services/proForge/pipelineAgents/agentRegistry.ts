/**
 * ProForge Agent Registry — single stage→agent resolver shared by the orchestrator and the
 * Core Capability Layer.
 * QNBS-v3: Was inlined in proForgeOrchestrator.loadAgent; extracted so the capability layer can
 * run a single stage programmatically (in-app or via MCP) without duplicating the mapping.
 * Agents are dynamically imported so each stage's chunk loads lazily.
 */

import type { PipelineStage } from '../../../features/proForge/types';
import type { OrchestratorContext } from '../proForgeOrchestrator';
import type { BaseAgent } from './baseAgent';

// QNBS-v3: Constructable BaseAgent — every stage agent extends BaseAgent and takes the context.
export type AgentConstructor = new (context: OrchestratorContext) => BaseAgent;

/** Stages that have an executable agent (excludes idle/archived control states). */
export const EXECUTABLE_STAGES: ReadonlyArray<PipelineStage> = [
  'intake',
  'structural',
  'lineProse',
  'copyEdit',
  'proof',
  'production',
  'publishing',
  'analytics',
];

/**
 * Resolve and lazily import the agent class for a pipeline stage.
 * Throws for control-only stages (idle/archived) or unknown stages.
 */
export async function loadAgent(stage: PipelineStage): Promise<AgentConstructor> {
  switch (stage) {
    case 'intake':
      return (await import('./diagnosticAgent')).DiagnosticAgent;
    case 'structural':
      return (await import('./structuralAgent')).StructuralAgent;
    case 'lineProse':
      return (await import('./proseAgent')).ProseAgent;
    case 'copyEdit':
      return (await import('./copyEditAgent')).CopyEditAgent;
    case 'proof':
      return (await import('./proofAgent')).ProofAgent;
    case 'production':
      return (await import('./productionAgent')).ProductionAgent;
    case 'publishing':
      return (await import('./publishingAgent')).PublishingAgent;
    case 'analytics':
      return (await import('./analyticsAgent')).AnalyticsAgent;
    default:
      throw new Error(`No agent registered for stage: ${stage}`);
  }
}
