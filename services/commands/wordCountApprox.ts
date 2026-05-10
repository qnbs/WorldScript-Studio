import type { ProjectData } from '../../features/project/projectSlice';

export function approximateManuscriptWordCount(data: ProjectData | undefined): number {
  if (!data?.manuscript?.length) return 0;
  let n = 0;
  for (const s of data.manuscript) {
    const text = (s.content ?? '').replace(/<[^>]+>/g, ' ');
    const words = text.split(/\s+/).filter(Boolean);
    n += words.length;
  }
  return n;
}
