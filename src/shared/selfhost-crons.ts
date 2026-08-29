export function resolveSelfHostCrons(
  stage: string,
  configuredCrons: readonly string[],
  enableSelfHostCrons: boolean,
): string[] {
  if (stage === "selfhost" && !enableSelfHostCrons) {
    return [];
  }

  return [...configuredCrons];
}
