import { DurableObject } from "cloudflare:workers";

// Keep the retired namespaces provisioned during this installation's upgrade.
// Neither class is bound by the new app; stored state survives a code rollback.
export class LegacyAuditScratchpad extends DurableObject {}
export class LegacyOnboardingChatAgent extends DurableObject {}
