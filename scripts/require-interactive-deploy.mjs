// Wrangler automatically permits custom-domain conflict replacement without a TTY.
// Keep interactive conflict prompts available until CI has explicit conflict checks.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    'Deploy from an interactive terminal. Non-interactive Wrangler deployment can replace conflicting DNS records without prompting.',
  );
  process.exit(1);
}
