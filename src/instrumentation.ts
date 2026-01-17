export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundMatcher } = await import("./lib/background-matcher.js");
    startBackgroundMatcher();

    const { startBackgroundEntityEnricher } = await import(
      "./lib/background-entity-enricher.js"
    );
    startBackgroundEntityEnricher();
  }
}

