// This fork inherits an unreadable production BETTER_AUTH_SECRET. Alchemy
// reconciles the entire secret set and cannot preserve that binding safely.
// Keep the legacy command disabled regardless of local configuration.
console.error(
  "deploy:selfhost is disabled in this fork: Alchemy can overwrite the inherited production secrets and invalidate existing Google connections.",
);
console.error(
  "Use the secret-inheriting Wrangler deployment procedure in docs/maintainers/existing-selfhost-upgrade.md. Never replace BETTER_AUTH_SECRET.",
);
process.exit(1);
