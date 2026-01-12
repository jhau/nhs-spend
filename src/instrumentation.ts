export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundMatcher } = await import("./lib/background-matcher");
    startBackgroundMatcher();

    const { startBackgroundEntityEnricher } = await import(
      "./lib/background-entity-enricher"
    );
    startBackgroundEntityEnricher();
  }
}

