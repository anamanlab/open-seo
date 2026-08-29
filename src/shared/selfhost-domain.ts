const invalidDomainMessage =
  "SELF_HOST_DOMAIN must be a hostname such as seo.optvoo.com";

export function parseSelfHostDomain(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";

  try {
    const parsed = new URL(`https://${candidate}`);
    if (
      candidate.includes(":") ||
      parsed.hostname !== candidate.toLowerCase() ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(invalidDomainMessage);
    }
    return parsed.hostname;
  } catch {
    throw new Error(invalidDomainMessage);
  }
}

export function resolveSelfHostHostname(
  customDomain: string,
  fallbackHostname: string,
): string {
  return customDomain || fallbackHostname;
}
