/**
 * Realtime vs offline gaze accuracy — the Phase 0 measurement.
 *
 * Both pipelines are scored on the SAME held-out validation dots in the SAME
 * unit (px of screen error), which makes them directly comparable:
 *
 *   realtime  Session.validationErrors[]  — per-dot error of the in-browser
 *             MediaPipe + regression prediction (App.tsx, at capture time)
 *   offline   config.offlineGaze.report.validation.overall_px — RMSE of the
 *             OpenFace 3.0 + polynomial mapping re-fitted from the recording
 *
 * Until this table exists, "is offline more accurate?" is an opinion. It also
 * splits by glasses, which is the other question that has never been measured.
 *
 * Usage:
 *   npx tsx scripts/compare-gaze-accuracy.ts               # table + summary
 *   npx tsx scripts/compare-gaze-accuracy.ts --json        # machine-readable
 *   npx tsx scripts/compare-gaze-accuracy.ts --limit 50
 *
 * Requires DATABASE_URL (read from .env like the other scripts).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const asJson = process.argv.includes('--json');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 100 : 100;

/** Default physical screen width (cm) when a session didn't record one. */
const FALLBACK_SCREEN_WIDTH_CM = 34.5;
const FALLBACK_VIEWING_DISTANCE_CM = 60;

interface Row {
  id: string;
  createdAt: string;
  glasses: boolean | null;
  nCalibrationDots: number | null;
  realtimeRmsePx: number | null;
  realtimeDeg: number | null;
  /** True when degrees came from this session's own px↔deg ratio, not the fallback screen. */
  realtimeDegExact: boolean;
  offlinePx: number | null;
  offlineDeg: number | null;
  offlineRawPx: number | null;
  headCompGain: number | null;
  personalizationKept: boolean | null;
  cleanDeg: number | null;
  glareDeg: number | null;
  cameraWidth: number | null;
  offlineStatus: string | null;
}

function rmse(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length);
}

/**
 * Screen pixels per degree of visual angle.
 * 1° subtends `distance * tan(1°)` cm at the eye; convert that to px.
 */
function pxPerDeg(widthPx: number, widthCm: number, distanceCm: number): number {
  const cmPerPx = widthCm / widthPx;
  const cmPerDeg = distanceCm * Math.tan((1 * Math.PI) / 180);
  return cmPerDeg / cmPerPx;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmt(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toFixed(digits);
}

async function main() {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: {
      id: true, createdAt: true, config: true, validationErrors: true, demographics: true,
    },
  });

  const rows: Row[] = sessions.map((s) => {
    const cfg = (s.config ?? {}) as Record<string, any>;
    const demo = (s.demographics ?? cfg.demographics ?? {}) as Record<string, any>;
    const offline = cfg.offlineGaze ?? null;
    const report = offline?.report ?? null;
    const val = report?.validation ?? null;

    const rtPx = rmse((s.validationErrors ?? []).filter((e) => Number.isFinite(e)));
    const offPx = num(val?.overall_px);
    const offDeg = num(val?.overall_deg);

    // Converting realtime px → degrees needs the physical screen width, which
    // sessions don't record. When the offline report exists it supplies both
    // units for the *same* session, so its own px→deg ratio converts the
    // realtime figure exactly — no geometry assumption, and the two pipelines
    // are then compared on a single consistent scale. Only unpaired sessions
    // fall back to the nominal screen below.
    const degPerPx =
      offPx && offDeg && offPx > 0
        ? offDeg / offPx
        : 1 / pxPerDeg(num(cfg.viewportWidth) ?? 1920, FALLBACK_SCREEN_WIDTH_CM,
                       num(cfg.faceDistance) ?? FALLBACK_VIEWING_DISTANCE_CM);

    const byQ = val?.by_quality ?? {};

    return {
      id: s.id,
      createdAt: s.createdAt.toISOString().slice(0, 10),
      glasses: typeof demo.wearsGlasses === 'boolean' ? demo.wearsGlasses : null,
      nCalibrationDots: num(report?.calibration_dots_used) ?? num(cfg.calibrationPointsCount),
      realtimeRmsePx: rtPx,
      realtimeDeg: rtPx === null ? null : rtPx * degPerPx,
      realtimeDegExact: offPx !== null && offDeg !== null,
      offlinePx: offPx,
      offlineDeg: offDeg,
      offlineRawPx: num(val?.overall_px_raw),
      headCompGain: num(report?.head_comp_gain),
      personalizationKept: typeof report?.personalization?.kept === 'boolean'
        ? report.personalization.kept
        : null,
      cleanDeg: num(byQ.clean?.deg),
      glareDeg: num(byQ.glare?.deg),
      cameraWidth: num(cfg.camera?.settings?.width),
      offlineStatus: offline?.status ?? null,
    };
  });

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const paired = rows.filter((r) => r.realtimeDeg !== null && r.offlineDeg !== null);

  console.log(`\n${rows.length} sessions (most recent first), ${paired.length} with both pipelines scored\n`);
  console.log(
    'session      date        glasses  dots  realtime°  offline°   Δ      raw°   gain  person.  cam'
  );
  console.log('─'.repeat(104));
  for (const r of rows) {
    const delta =
      r.realtimeDeg !== null && r.offlineDeg !== null ? r.offlineDeg - r.realtimeDeg : null;
    const rawDeg =
      r.offlineRawPx !== null && r.offlinePx !== null && r.offlineDeg !== null
        ? (r.offlineRawPx / r.offlinePx) * r.offlineDeg
        : null;
    console.log(
      [
        r.id.slice(0, 10).padEnd(12),
        r.createdAt.padEnd(11),
        (r.glasses === null ? '?' : r.glasses ? 'yes' : 'no').padEnd(8),
        String(r.nCalibrationDots ?? '—').padStart(4),
        fmt(r.realtimeDeg).padStart(10),
        fmt(r.offlineDeg).padStart(9),
        (delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(2)).padStart(7),
        fmt(rawDeg).padStart(7),
        fmt(r.headCompGain, 2).padStart(6),
        (r.personalizationKept === null ? '—' : r.personalizationKept ? 'kept' : 'no').padStart(8),
        (r.cameraWidth ? `${r.cameraWidth}p` : '—').padStart(6),
      ].join(' ')
    );
  }

  const mean = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  console.log('\n── Summary (mean degrees) ──────────────────────────────────');
  const groups: [string, Row[]][] = [
    ['all sessions', paired],
    ['glasses', paired.filter((r) => r.glasses === true)],
    ['no glasses', paired.filter((r) => r.glasses === false)],
  ];
  for (const [label, g] of groups) {
    if (!g.length) {
      console.log(`  ${label.padEnd(14)} no sessions`);
      continue;
    }
    const rt = mean(g.map((r) => r.realtimeDeg));
    const off = mean(g.map((r) => r.offlineDeg));
    const winner =
      rt !== null && off !== null ? (off < rt ? 'offline wins' : 'realtime wins') : '';
    console.log(
      `  ${label.padEnd(14)} n=${String(g.length).padEnd(3)} realtime ${fmt(rt)}°   offline ${fmt(off)}°   ${winner}`
    );
  }

  const withQuality = rows.filter((r) => r.cleanDeg !== null && r.glareDeg !== null);
  if (withQuality.length) {
    console.log('\n── Glare impact (within glasses sessions) ──────────────────');
    console.log(
      `  clean frames ${fmt(mean(withQuality.map((r) => r.cleanDeg)))}°   ` +
      `glare frames ${fmt(mean(withQuality.map((r) => r.glareDeg)))}°   (n=${withQuality.length})`
    );
  }

  const noOffline = rows.filter((r) => r.offlineDeg === null).length;
  if (noOffline) {
    console.log(
      `\n  ${noOffline} session(s) have no offline validation — run them with ` +
      `NEXT_PUBLIC_OFFLINE_HANDLING=1, or reprocess the recording with ` +
      `\`python -m app.reprocess\`.`
    );
  }
  console.log(
    `\n  Degrees assume a ${FALLBACK_SCREEN_WIDTH_CM} cm wide screen where the session ` +
    `didn't record one; pixel columns are unaffected by that assumption.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
