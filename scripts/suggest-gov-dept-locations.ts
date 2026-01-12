import dotenv from "dotenv";
import fs from "fs";

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { getOpenRouterConfig } from "../src/lib/assistant/config";
import { db } from "../src/db";
import { entities, governmentDepartments } from "../src/db/schema";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi;

function normalizePostcode(p: string) {
  return p.toUpperCase().replace(/\s+/g, " ").trim();
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyUnhelpfulExternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "www.gov.uk" ||
    h.endsWith(".gov.uk") ||
    h === "twitter.com" ||
    h === "x.com" ||
    h === "facebook.com" ||
    h === "www.facebook.com" ||
    h === "linkedin.com" ||
    h === "www.linkedin.com" ||
    h === "youtube.com" ||
    h === "www.youtube.com" ||
    h === "instagram.com" ||
    h === "www.instagram.com"
  );
}

function extractExternalWebsitesFromHtml(html: string): string[] {
  // Very lightweight extraction: collect https? links that are not GOV.UK.
  const urls = new Set<string>();
  const re = /href="(https?:\/\/[^"'<>\s]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1]);
      if (isLikelyUnhelpfulExternalHost(u.hostname)) continue;
      // ignore obvious assets
      if (/\.(pdf|jpg|jpeg|png|gif|svg|webp)(\?|#|$)/i.test(u.pathname))
        continue;
      urls.add(u.toString());
    } catch {
      // ignore malformed
    }
    if (urls.size >= 5) break;
  }
  return Array.from(urls);
}

function findLikelyContactUrlsFromHtml(
  html: string,
  baseUrl: string
): string[] {
  const out = new Set<string>();
  // Try to find anchors with "contact" in href
  const re = /href="([^"'<>\s]*contact[^"'<>\s]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      const u = new URL(href, baseUrl);
      out.add(u.toString());
    } catch {
      // ignore
    }
    if (out.size >= 5) break;
  }
  return Array.from(out);
}

function extractPostcodesWithSnippets(text: string, maxSnippets = 20) {
  const out: Array<{ postcode: string; snippet: string }> = [];
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = UK_POSTCODE_RE.exec(text)) !== null) {
    const raw = m[1];
    const pc = normalizePostcode(raw);
    const idx = m.index;
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + raw.length + 60);
    const snippet = text.slice(start, end).trim();
    out.push({ postcode: pc, snippet });
    count++;
    if (count >= maxSnippets) break;
  }
  return out;
}

let lastFetchAt = 0;
function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableFetchError(e: unknown) {
  const err = e as any;
  const code = err?.cause?.code || err?.code;
  // undici / node fetch network errors
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN"
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetch(url: string, minIntervalMs: number) {
  const now = Date.now();
  const wait = Math.max(0, minIntervalMs - (now - lastFetchAt));
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastFetchAt = Date.now();

  const timeoutMs = envNumber("GOV_UK_FETCH_TIMEOUT_MS", 25_000);
  const maxRetries = envNumber("GOV_UK_FETCH_MAX_RETRIES", 3);
  const backoffBaseMs = envNumber("GOV_UK_FETCH_BACKOFF_BASE_MS", 1_000);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "nhs-spend/1.0 (location-enrichment)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (resp.ok) return resp;

      if (!isRetryableStatus(resp.status) || attempt > maxRetries) {
        return resp;
      }

      const retryAfter = resp.headers.get("retry-after");
      const retryAfterMs =
        retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : null;
      const backoffMs =
        retryAfterMs ??
        Math.min(60_000, backoffBaseMs * Math.pow(2, attempt - 1));
      await sleep(backoffMs);
    } catch (e) {
      // AbortError or network timeout
      const abortOrNetwork =
        (e instanceof Error && e.name === "AbortError") ||
        isRetryableFetchError(e);
      if (!abortOrNetwork || attempt > maxRetries) {
        throw e;
      }

      const backoffMs = Math.min(
        60_000,
        backoffBaseMs * Math.pow(2, attempt - 1)
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(t);
    }
  }

  // Unreachable, but TS wants it.
  throw new Error(`Failed to fetch ${url}`);
}

function findContactUrl(html: string, slug: string): string | null {
  const direct = `/government/organisations/${slug}/contact`;
  if (html.includes(direct)) return `https://www.gov.uk${direct}`;
  const m =
    html.match(
      new RegExp(
        `href=\"(\\/government\\/organisations\\/${slug}\\/contact[^\"]*)\"`,
        "i"
      )
    ) ||
    html.match(/href=\"(\/government\/organisations\/[^/]+\/contact[^\"]*)\"/i);
  if (m?.[1]) return `https://www.gov.uk${m[1]}`;
  return null;
}

const llmOutputSchema = z.object({
  postcode: z.string().min(3),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      url: z.string().min(5),
      snippet: z.string().min(5),
    })
  ),
  notes: z.string().optional(),
});

function extractJsonObject(text: string): string {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in LLM output");
  }
  return text.slice(firstBrace, lastBrace + 1);
}

type Suggestion = {
  entityId: number;
  slug: string;
  name: string;
  suggestedPostcode: string | null;
  confidence: number | null;
  evidence: Array<{ url: string; snippet: string }>;
  candidates: Array<{ postcode: string; url: string; snippet: string }>;
  approved: boolean;
  createdAt: string;
};

async function main() {
  const outPath = process.env.GOV_DEPT_LOCATION_SUGGESTIONS_PATH
    ? String(process.env.GOV_DEPT_LOCATION_SUGGESTIONS_PATH)
    : "data/gov-dept-location-suggestions.json";

  const minIntervalMs = process.env.GOV_UK_FETCH_INTERVAL_MS
    ? Number(process.env.GOV_UK_FETCH_INTERVAL_MS)
    : 1000;

  const cfg = getOpenRouterConfig();
  const llm = new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: 0,
    configuration: {
      baseURL: cfg.baseURL,
      defaultHeaders: {
        ...(cfg.referer ? { "HTTP-Referer": cfg.referer } : {}),
        ...(cfg.title ? { "X-Title": cfg.title } : {}),
      },
    },
  });

  const depts = await db
    .select({
      entityId: governmentDepartments.entityId,
      slug: governmentDepartments.slug,
      name: entities.name,
    })
    .from(governmentDepartments)
    .innerJoin(entities, eq(governmentDepartments.entityId, entities.id));

  const suggestions: Suggestion[] = [];

  for (const dept of depts) {
    const orgUrl = `https://www.gov.uk/government/organisations/${dept.slug}`;
    console.log(`[gov-dept] fetching ${orgUrl}`);

    let orgHtml: string | null = null;
    try {
      const orgResp = await rateLimitedFetch(orgUrl, minIntervalMs);
      orgHtml = await orgResp.text();
    } catch (e) {
      // We'll fall back to external website if we can discover one.
      console.warn(
        `[gov-dept] failed to fetch GOV.UK org page for ${dept.slug}`,
        e
      );
    }

    const urls: string[] = [orgUrl];
    if (orgHtml) {
      const contactUrl = findContactUrl(orgHtml, dept.slug);
      if (contactUrl) {
        urls.push(contactUrl);
      }
    }

    const candidates: Array<{
      postcode: string;
      url: string;
      snippet: string;
    }> = [];

    for (const url of urls) {
      if (url !== orgUrl) {
        console.log(`[gov-dept] fetching ${url}`);
      }
      try {
        // If orgHtml is null (orgUrl failed), skip trying orgUrl here.
        if (url === orgUrl && !orgHtml) continue;

        const resp =
          url === orgUrl
            ? { text: async () => orgHtml as string }
            : await rateLimitedFetch(url, minIntervalMs);
        const html = url === orgUrl ? (orgHtml as string) : await resp.text();
        const text = stripHtml(html);
        for (const c of extractPostcodesWithSnippets(text, 30)) {
          candidates.push({ postcode: c.postcode, url, snippet: c.snippet });
        }
      } catch (e) {
        console.warn(`[gov-dept] failed to fetch ${url}`, e);
      }
    }

    // Official website fallback:
    // If GOV.UK pages were unavailable or yielded no postcodes, try external website(s)
    // discovered from GOV.UK org page HTML (when present).
    if (candidates.length === 0 && orgHtml) {
      const externalSites = extractExternalWebsitesFromHtml(orgHtml);
      for (const site of externalSites) {
        console.log(`[gov-dept] fallback website: ${site}`);
        try {
          const resp = await rateLimitedFetch(site, minIntervalMs);
          const html = await resp.text();
          const text = stripHtml(html);
          for (const c of extractPostcodesWithSnippets(text, 30)) {
            candidates.push({
              postcode: c.postcode,
              url: site,
              snippet: c.snippet,
            });
          }

          // Also try contact-like links and common contact paths on the same domain.
          const contactLinks = findLikelyContactUrlsFromHtml(html, site);
          const base = new URL(site);
          const commonPaths = [
            "/contact",
            "/contact-us",
            "/contactus",
            "/contact-details",
            "/about/contact",
            "/about-us/contact",
          ].map((p) => new URL(p, base).toString());
          const toTry = Array.from(
            new Set([...contactLinks, ...commonPaths])
          ).slice(0, 6);

          for (const u of toTry) {
            console.log(`[gov-dept] fallback website fetch: ${u}`);
            try {
              const r2 = await rateLimitedFetch(u, minIntervalMs);
              const h2 = await r2.text();
              const t2 = stripHtml(h2);
              for (const c of extractPostcodesWithSnippets(t2, 30)) {
                candidates.push({
                  postcode: c.postcode,
                  url: u,
                  snippet: c.snippet,
                });
              }
            } catch (e) {
              console.warn(`[gov-dept] failed to fetch fallback url ${u}`, e);
            }
          }
        } catch (e) {
          console.warn(`[gov-dept] failed to fetch fallback site ${site}`, e);
        }

        if (candidates.length > 0) break;
      }
    }

    // de-dupe candidates by postcode (keep first evidence)
    const byPc = new Map<
      string,
      { postcode: string; url: string; snippet: string }
    >();
    for (const c of candidates) {
      if (!byPc.has(c.postcode)) byPc.set(c.postcode, c);
    }
    const uniqueCandidates = Array.from(byPc.values());

    let suggestedPostcode: string | null = null;
    let confidence: number | null = null;
    let evidence: Array<{ url: string; snippet: string }> = [];

    if (uniqueCandidates.length === 1) {
      suggestedPostcode = uniqueCandidates[0].postcode;
      confidence = 0.8;
      evidence = [
        { url: uniqueCandidates[0].url, snippet: uniqueCandidates[0].snippet },
      ];
    } else if (uniqueCandidates.length > 1) {
      const prompt = [
        "You are helping enrich a UK government department record with its official postal address postcode.",
        "You are given candidate UK postcodes extracted from GOV.UK pages, with snippets.",
        "Pick the single best postcode for the organisation's main contact/address location.",
        "Return STRICT JSON (no markdown) with keys: postcode, confidence (0..1), evidence (array of {url,snippet}), notes (optional).",
        "",
        `Organisation: ${dept.name} (slug: ${dept.slug})`,
        "Candidates:",
        ...uniqueCandidates.map(
          (c, i) => `${i + 1}. ${c.postcode} | ${c.url} | ${c.snippet}`
        ),
      ].join("\n");

      const raw = await llm.invoke([
        {
          role: "system",
          content:
            "You return machine-readable JSON only. Do not include any extra keys.",
        },
        { role: "user", content: prompt },
      ]);

      const content =
        typeof raw.content === "string"
          ? raw.content
          : JSON.stringify(raw.content);
      const json = extractJsonObject(content);
      const parsed = llmOutputSchema.parse(JSON.parse(json));
      suggestedPostcode = normalizePostcode(parsed.postcode);
      confidence = parsed.confidence;
      evidence = parsed.evidence.map((e) => ({
        url: e.url,
        snippet: e.snippet,
      }));
    }

    suggestions.push({
      entityId: dept.entityId,
      slug: dept.slug,
      name: dept.name,
      suggestedPostcode,
      confidence,
      evidence,
      candidates: uniqueCandidates,
      approved: false,
      createdAt: new Date().toISOString(),
    });
  }

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(suggestions, null, 2), "utf-8");
  console.log(
    `[gov-dept] wrote ${suggestions.length} suggestions to ${outPath}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
