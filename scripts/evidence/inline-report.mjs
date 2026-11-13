// Evidence only (never merged), #1272: lists worker files and decodes the start of every data:video/mp2t URL in dist.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const assets = join(dist, 'assets');
const files = readdirSync(assets);
console.log(`[evidence] worker files: ${JSON.stringify(files.filter((f) => /worker/i.test(f)))}`);
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(join(assets, file), 'utf8');
  for (const match of text.matchAll(/data:video\/mp2t;base64,([A-Za-z0-9+/=]{0,400})/g)) {
    const head = Buffer.from(match[1], 'base64')
      .toString('utf8')
      .split('\n')
      .slice(0, 3)
      .join(' | ');
    console.log(`[evidence] ${file}: data:video/mp2t → ${head.slice(0, 220)}`);
  }
  for (const match of text.matchAll(/new Worker\(new URL\(["'`]([^"'`]{0,120})/g)) {
    console.log(`[evidence] ${file}: new Worker(new URL(${match[1].slice(0, 100)}`);
  }
}
