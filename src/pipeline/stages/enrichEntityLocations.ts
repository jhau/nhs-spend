import type { PipelineStage } from "../types";
import { enrichEntityLocationsFromPostcodesIo } from "@/lib/entity-location-enrichment";

export type EnrichEntityLocationsInput = {
  /**
   * Max entities to scan for enrichment in this run.
   * (Optional; the overall pipeline input object may include many other fields.)
   */
  enrichMaxEntities?: number;
  /**
   * Max distinct postcodes to enrich in this run.
   */
  enrichMaxDistinctPostcodes?: number;
};

export const enrichEntityLocationsStage: PipelineStage<EnrichEntityLocationsInput> =
  {
    id: "enrichEntityLocations",
    title: "Enrich entities with UK region + lat/lon from postcode (postcodes.io)",
    validate(input) {
      if (!input) return;
      if (
        input.enrichMaxEntities !== undefined &&
        (!Number.isInteger(input.enrichMaxEntities) || input.enrichMaxEntities <= 0)
      ) {
        throw new Error("enrichMaxEntities must be a positive integer");
      }
      if (
        input.enrichMaxDistinctPostcodes !== undefined &&
        (!Number.isInteger(input.enrichMaxDistinctPostcodes) ||
          input.enrichMaxDistinctPostcodes <= 0 ||
          input.enrichMaxDistinctPostcodes > 100)
      ) {
        throw new Error(
          "enrichMaxDistinctPostcodes must be a positive integer <= 100"
        );
      }
    },
    async run(ctx, input) {
      if (ctx.dryRun) {
        return {
          status: "succeeded",
          metrics: { dryRun: true },
        };
      }

      const result = await enrichEntityLocationsFromPostcodesIo(ctx.db, {
        maxEntities: input?.enrichMaxEntities,
        maxDistinctPostcodes: input?.enrichMaxDistinctPostcodes,
        logger: ctx.log,
      });

      return {
        status: "succeeded",
        metrics: result,
      };
    },
  };


