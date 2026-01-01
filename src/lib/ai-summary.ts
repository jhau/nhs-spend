import { db } from "@/db";
import { entities } from "@/db/schema";
import { eq } from "drizzle-orm";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface AISummaryResult {
  summary: string;
  news: { title: string; link: string; date?: string }[];
}

/**
 * Refreshes the AI summary for an entity if it's missing or older than 24 hours.
 */
export async function refreshAISummary(
  entityId: number,
  entityName: string,
  currentUpdatedAt: Date | null
): Promise<AISummaryResult | null> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (currentUpdatedAt && currentUpdatedAt > twentyFourHoursAgo) {
    return null; // No refresh needed
  }

  if (!OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not configured.");
    return null;
  }

  try {
    const prompt = `Provide a summary of the company "${entityName}" in less than 200 words. 
Also find the latest 5 news articles about this company with their links and publication dates.
Return the response in strict JSON format:
{
  "summary": "the summary text...",
  "news": [
    {"title": "news title 1", "link": "https://...", "date": "YYYY-MM-DD"},
    ...
  ]
}`;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview", // Using Gemini 3 Flash as requested
        plugins: [{ id: "web", max_results: 5 }], // Adding the web plugin for search
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter API error: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    const result = JSON.parse(
      data.choices[0].message.content
    ) as AISummaryResult;

    // Update database
    await db
      .update(entities)
      .set({
        aiSummary: result.summary,
        aiNews: result.news,
        aiSummaryUpdatedAt: now,
      })
      .where(eq(entities.id, entityId));

    return result;
  } catch (error) {
    console.error("Error refreshing AI summary:", error);
    return null;
  }
}
