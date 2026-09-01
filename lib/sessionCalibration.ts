/**
 * Calibration quality for a set of sessions, read straight from the database.
 *
 * This exists because the same three lines were about to live in three places,
 * and did briefly live in two — with the result that the runs list and the run
 * detail page reported different angular errors for the same session. The list
 * pulled the real geometry; the detail route never selected `config` at all, so
 * `sessionGeometry` fell back to 60 cm and the CSS reference pixel and produced
 * a plausible-looking number that was wrong by a third. Nothing failed. The two
 * screens simply disagreed, quietly, and only a side-by-side comparison would
 * ever have caught it.
 *
 * So the query, the fallbacks and the conversion are all here, once.
 *
 * Read by JSON path rather than by selecting `config`: that column also carries
 * `testTrajectories` and `dotConvergence`, which are large enough that pulling a
 * page of them to read four scalars would be wasteful.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { angularErrorDegOrNull, sessionGeometry } from '@/lib/resultScoring';

export interface CalibrationSummary {
  /** Mean validation error, CSS pixels — the raw number, exactly as recorded. */
  meanErrorPx: number;
  /**
   * The same error as visual angle, or **null** when the geometry it would need
   * was never measured.
   *
   * Null rather than a number derived from a stand-in distance. A session run at
   * an unknown distance has no angular error, and inventing one from the
   * configured target reports 40 cm for a participant who sat at 35.
   */
  angularErrorDeg: number | null;
  /** Distance, when measured. Null when nothing measured it. */
  distanceCm: number | null;
  /** Display scale, when measured. Null when the card step never ran. */
  pxPerCm: number | null;
}

interface GeoRow {
  id: string;
  meanErrorPx: number | null;
  anchorCm: number | null;
  anchorSource: string | null;
  calCm: number | null;
  calMethod: string | null;
  pxPerCm: number | null;
}

/**
 * Calibration summaries keyed by session id. Sessions with no recorded
 * validation error are absent from the map rather than present-and-null, so
 * callers cannot accidentally render a zero.
 *
 * `jsonb_typeof` guards every cast. Without it a single malformed config takes
 * the whole listing down with a Postgres cast error, and a screen whose job is
 * to show a column of numbers should degrade to a dash instead.
 */
export async function calibrationForSessions(
  sessionIds: string[],
): Promise<Map<string, CalibrationSummary>> {
  const ids = sessionIds.filter(Boolean);
  const out = new Map<string, CalibrationSummary>();
  if (!ids.length) return out;

  const rows = await prisma.$queryRaw<GeoRow[]>`
    SELECT id,
           "meanErrorPx",
           CASE WHEN jsonb_typeof(config->'positionAnchor'->'distanceCm') = 'number'
                THEN (config->'positionAnchor'->>'distanceCm')::float8 END AS "anchorCm",
           config->'positionAnchor'->>'distanceSource'                       AS "anchorSource",
           CASE WHEN jsonb_typeof(config->'distanceCalibration'->'distanceCm') = 'number'
                THEN (config->'distanceCalibration'->>'distanceCm')::float8 END AS "calCm",
           config->'distanceCalibration'->>'method'                          AS "calMethod",
           CASE WHEN jsonb_typeof(config->'distanceCalibration'->'pxPerCm') = 'number'
                THEN (config->'distanceCalibration'->>'pxPerCm')::float8 END AS "pxPerCm"
    FROM "Session"
    WHERE id IN (${Prisma.join(ids)})
  `;

  for (const g of rows) {
    if (g.meanErrorPx == null) continue;
    // Rebuilt into the shape sessionGeometry expects, so the precedence rules
    // for which distance counts stay in exactly one place.
    const geometry = sessionGeometry({
      ...(g.anchorCm != null
        ? { positionAnchor: { distanceCm: g.anchorCm, distanceSource: g.anchorSource ?? undefined } }
        : {}),
      ...(g.calCm != null || g.pxPerCm != null
        ? {
            distanceCalibration: {
              distanceCm: g.calCm ?? undefined,
              pxPerCm: g.pxPerCm ?? undefined,
              method: g.calMethod ?? undefined,
            },
          }
        : {}),
      // The configured target is deliberately NOT passed. It is what was asked
      // for, not what happened, and letting it stand in here is exactly the
      // substitution this module exists to prevent.
    });
    out.set(g.id, {
      meanErrorPx: g.meanErrorPx,
      angularErrorDeg: angularErrorDegOrNull(g.meanErrorPx, geometry),
      distanceCm: geometry.measured ? geometry.distanceCm : null,
      pxPerCm: geometry.measured ? geometry.pxPerCm : null,
    });
  }
  return out;
}

/** Convenience for the single-session case. */
export async function calibrationForSession(
  sessionId: string | null | undefined,
): Promise<CalibrationSummary | null> {
  if (!sessionId) return null;
  const map = await calibrationForSessions([sessionId]);
  return map.get(sessionId) ?? null;
}
