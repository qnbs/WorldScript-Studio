import { execFileSync } from 'node:child_process';
import process from 'node:process';

try {
  execFileSync('git', ['diff', '--check', 'HEAD'], { cwd: process.cwd(), stdio: 'inherit' });
} catch {
  process.exit(1);
}
