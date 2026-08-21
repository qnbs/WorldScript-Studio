const task = process.argv.slice(2).join(' ') || 'This task';

// QNBS-v3: Keep expensive mutation runs off the constrained development workstation.
if (process.env.CI !== 'true') {
  console.error(
    `${task} is CI-only on this constrained workstation. Use: gh workflow run mutation.yml`,
  );
  process.exit(1);
}
