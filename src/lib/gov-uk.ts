import { PipelineLogger } from "@/pipeline/types";

export type GovUkOrganisation = {
  title: string;
  slug: string;
  acronym?: string;
  organisation_type: string;
  organisation_state: string;
  link: string;
  logo_url?: string;
  content_id: string;
  parent_organisations?: string[];
  child_organisations?: string[];
};

export type GovUkSearchResponse = {
  results: Array<{
    title: string;
    slug: string;
    link: string;
    description: string;
    organisations: Array<GovUkOrganisation>;
  }>;
  total: number;
};

/**
 * Simple rate limiter to ensure max 1 request per second.
 */
class RateLimiter {
  private lastRequestTime = 0;
  private minInterval = 1000; // 1 second

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      const waitTime = this.minInterval - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }
}

const limiter = new RateLimiter();

/**
 * Search for a government organisation using the GOV.UK Search API.
 * Adheres to 1 request/second limit and provides detailed logging.
 */
export async function searchGovUkOrganisation(
  query: string,
  logger?: PipelineLogger
): Promise<GovUkOrganisation | null> {
  await limiter.wait();

  const url = new URL("https://www.gov.uk/api/search.json");
  url.searchParams.set("filter_format", "organisation");
  url.searchParams.set("q", query);

  const startTime = Date.now();
  
  if (logger) {
    await logger({
      level: "debug",
      message: `Calling GOV.UK API: ${url.toString()}`,
      meta: { query, url: url.toString() },
    });
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "NHS-Spend-Pipeline/1.0",
      },
    });

    const duration = Date.now() - startTime;

    if (logger) {
      await logger({
        level: "debug",
        message: `GOV.UK API response: ${response.status} ${response.statusText}`,
        meta: { 
          status: response.status, 
          statusText: response.statusText, 
          durationMs: duration,
          url: url.toString() 
        },
      });
    }

    if (response.status === 429) {
      // Basic backoff for 429
      if (logger) {
        await logger({
          level: "warn",
          message: "GOV.UK API Rate limit hit (429), waiting 5s...",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return searchGovUkOrganisation(query, logger); // Retry once
    }

    if (!response.ok) {
      if (logger) {
        await logger({
          level: "error",
          message: `GOV.UK API failed: ${response.status}`,
          meta: { status: response.status, url: url.toString() },
        });
      }
      return null;
    }

    const data = (await response.json()) as GovUkSearchResponse;

    if (!data.results || data.results.length === 0) {
      return null;
    }

    // Return the first organisation from the first result
    const firstResult = data.results[0];
    if (firstResult.organisations && firstResult.organisations.length > 0) {
      return firstResult.organisations[0];
    }

    return null;
  } catch (error) {
    if (logger) {
      await logger({
        level: "error",
        message: `GOV.UK API request error: ${error instanceof Error ? error.message : String(error)}`,
        meta: { error, url: url.toString() },
      });
    }
    return null;
  }
}
