/**
 * Production Agent — Phase 6: Production & Formatting
 * QNBS-v3: Generate PDF, EPUB, DOCX, and other production artifacts.
 */

import type {
  ProductionArtifact,
  ProductionManifest,
  ReviewItem,
  StageResult,
} from '../../../features/proForge/types';
import { logger } from '../../logger';
import { BaseAgent } from './baseAgent';

export class ProductionAgent extends BaseAgent {
  async execute(
    signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    const startTime = performance.now();
    const project = this.requireProject();

    // Lazy-load heavy export libraries
    const artifacts: ProductionArtifact[] = [];

    try {
      // Generate Markdown
      const { formattedOutput } = await this.generateMarkdown(project);
      const mdBlob = new Blob([formattedOutput], { type: 'text/markdown' });
      artifacts.push({
        id: 'md',
        format: 'md',
        fileName: `${this.sanitizeFileName(project.title)}.md`,
        blob: mdBlob,
        sizeBytes: mdBlob.size,
        generatedAt: new Date().toISOString(),
      });

      if (signal.aborted) throw new Error('Production aborted');

      // Generate PDF (if jspdf available)
      try {
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF();
        const lines = formattedOutput.split('\n');
        let y = 20;
        for (const line of lines.slice(0, 500)) {
          // Limit for MVP
          if (y > 280) {
            pdf.addPage();
            y = 20;
          }
          pdf.text(line.substring(0, 120), 20, y);
          y += 6;
        }
        const pdfBlob = pdf.output('blob');
        artifacts.push({
          id: 'pdf',
          format: 'pdf',
          fileName: `${this.sanitizeFileName(project.title)}.pdf`,
          blob: pdfBlob,
          sizeBytes: pdfBlob.size,
          generatedAt: new Date().toISOString(),
        });
      } catch {
        logger.warn('ProductionAgent: PDF generation skipped (jspdf not available)');
      }

      if (signal.aborted) throw new Error('Production aborted');

      // Generate EPUB (if epubApiService available)
      try {
        const { generateEpub } = await import('../../epubApiService');
        const epubBlob = await generateEpub(project, project.compileProfile);
        artifacts.push({
          id: 'epub',
          format: 'epub',
          fileName: `${this.sanitizeFileName(project.title)}.epub`,
          blob: epubBlob,
          sizeBytes: epubBlob.size,
          generatedAt: new Date().toISOString(),
        });
      } catch {
        logger.warn('ProductionAgent: EPUB generation skipped');
      }
    } catch (err) {
      logger.error('ProductionAgent: Artifact generation failed:', err);
    }

    const manifest: ProductionManifest = {
      artifacts,
      compileProfileUsed: !!project.compileProfile,
      typographySettings: {
        font: 'Times',
        fontSize: '12pt',
        lineSpacing: '1.5',
      },
      generatedAt: new Date().toISOString(),
    };

    const durationMs = this.elapsed(startTime);

    const reviewItems: ReviewItem[] = artifacts.map((a) => ({
      id: `prod-${a.id}`,
      stage: 'production',
      type: 'technicalIssue',
      severity: 'info',
      description: `${a.format.toUpperCase()} artifact generated: ${a.fileName} (${(a.sizeBytes / 1024).toFixed(1)} KB)`,
      rationale: 'Production artifact ready for download',
      confidence: 1.0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }));

    return {
      reviewItems,
      metrics: {
        aiCalls: 0,
        tokensConsumed: 0,
        durationMs,
        itemsFound: reviewItems.length,
        itemsAccepted: 0,
        itemsRejected: 0,
      },
      agentOutput: manifest,
    };
  }

  private async generateMarkdown(project: {
    title: string;
    logline: string;
    manuscript: Array<{ title: string; content: string }>;
    compileProfile?: unknown;
  }): Promise<{ formattedOutput: string }> {
    let output = `# ${project.title}\n\n`;
    if (project.logline) {
      output += `> ${project.logline}\n\n`;
    }
    output += `---\n\n`;

    for (const section of project.manuscript) {
      output += `## ${section.title}\n\n${section.content ?? ''}\n\n`;
    }

    return { formattedOutput: output };
  }

  private sanitizeFileName(title: string): string {
    return title.replace(/[^a-z0-9\u00C0-\u017F]+/gi, '_').substring(0, 50) || 'manuscript';
  }
}
