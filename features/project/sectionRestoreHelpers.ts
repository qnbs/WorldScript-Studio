import type { StorySection } from '../../types';

// QNBS-v3: Partial ohne explizites undefined — kompatibel mit exactOptionalPropertyTypes beim Section-Restore.
export function partialStorySectionFromSnapshot(patch: StorySection): Partial<StorySection> {
  const out: Partial<StorySection> = {
    title: patch.title,
    content: patch.content,
  };
  if (patch.summary !== undefined) out.summary = patch.summary;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.prompt !== undefined) out.prompt = patch.prompt;
  return out;
}
