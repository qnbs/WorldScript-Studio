/**
 * Unified Markdown for Pandoc (Tauri) — broadly mirrors the compileProfile body.
 * QNBS-v3: Desktop-Export mit Fallback auf JS-EPUB im Browser.
 */

import type { StoryProject } from '../types';

export function buildPandocMarkdownFromProject(project: StoryProject): string {
  const lines: string[] = [];
  lines.push(`# ${project.title.replace(/\n/g, ' ')}`);
  if (project.author?.trim()) {
    lines.push('');
    lines.push(`*${project.author.trim()}*`);
  }
  lines.push('');
  const cp = project.compileProfile;
  if (cp?.titlePageMarkdown?.trim()) {
    lines.push(cp.titlePageMarkdown.trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  if (cp?.dedicationMarkdown?.trim()) {
    lines.push(cp.dedicationMarkdown.trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  for (const block of cp?.frontMatter ?? []) {
    if (block.bodyMarkdown?.trim()) {
      lines.push(`## ${block.title.replace(/\n/g, ' ')}`);
      lines.push(block.bodyMarkdown.trim());
      lines.push('');
    }
  }
  for (const sec of project.manuscript) {
    lines.push(`## ${sec.title.replace(/\n/g, ' ')}`);
    lines.push(sec.content ?? '');
    lines.push('');
  }
  for (const block of cp?.backMatter ?? []) {
    if (block.bodyMarkdown?.trim()) {
      lines.push(`## ${block.title.replace(/\n/g, ' ')}`);
      lines.push(block.bodyMarkdown.trim());
      lines.push('');
    }
  }
  if (cp?.acknowledgementsMarkdown?.trim()) {
    lines.push(cp.acknowledgementsMarkdown.trim());
    lines.push('');
  }
  if (cp?.imprintMarkdown?.trim()) {
    lines.push(cp.imprintMarkdown.trim());
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
