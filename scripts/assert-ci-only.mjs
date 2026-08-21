const task = process.argv.slice(2).join(' ') || 'This task';

if (process.env.CI !== 'true') {
  console.error(
    `${task} is CI-only on this constrained workstation. Use: gh workflow run mutation.yml`,
  );
  process.exit(1);
}
