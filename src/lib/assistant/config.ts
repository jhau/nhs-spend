export function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v == null || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function getOptionalEnv(
  name: string,
  fallback?: string
): string | undefined {
  const v = process.env[name] ?? fallback;
  return v && v.length > 0 ? v : undefined;
}

export function getOpenRouterConfig() {
  return {
    apiKey: getEnv("OPENROUTER_API_KEY"),
    baseURL: getOptionalEnv(
      "OPENROUTER_BASE_URL",
      "https://openrouter.ai/api/v1"
    )!,
    model: getOptionalEnv("AI_MODEL", "google/gemini-3-pro-preview")!,
    referer: getOptionalEnv("OPENROUTER_HTTP_REFERER"),
    title: getOptionalEnv("OPENROUTER_X_TITLE", "nhs-spend"),
  };
}
