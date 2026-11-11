export function logicalLines(text: string): string[];
export function dockerfileCopySources(text: string): { sources: string[]; errors: string[] };
export function dockerignoreExcludes(dockerignoreText: string, path: string): boolean;
export function checkDockerfileContext(input: {
  dockerfile: string;
  dockerignore: string;
  exists: (path: string) => boolean;
}): { ok: boolean; errors: string[]; sources: string[] };
