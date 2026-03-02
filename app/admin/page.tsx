import { prisma } from '@/lib/prisma';
import AdminDashboardCharts from '@/components/AdminDashboardCharts';
import { computeFeatureAnalytics } from '@/lib/featureAnalytics';

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDay(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function AdminDashboardPage() {
  const from7 = daysAgo(7);
  const from14 = daysAgo(14);

  const [total, last7, last14, withVideo, withCalibrationImages, avgError, recentSessions, sessionsForFeatures, sessionsForDemographics] =
    await Promise.all([
      prisma.session.count(),
      prisma.session.count({ where: { createdAt: { gte: from7 } } }),
      prisma.session.count({ where: { createdAt: { gte: from14 } } }),
      prisma.session.count({ where: { videoUrl: { not: null } } }),
      prisma.session.count({ where: { calibrationImageUrls: { not: { equals: null } } } }),
      prisma.session.aggregate({
        _avg: { meanErrorPx: true },
        where: { meanErrorPx: { not: null } },
      }),
      prisma.session.findMany({
        where: { createdAt: { gte: from14 } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.session.findMany({
        take: 200,
        orderBy: { createdAt: 'desc' },
        select: {
          calibrationGazeSamples: true,
          validationErrors: true,
          meanErrorPx: true,
        },
      }),
      prisma.session.findMany({
        select: { demographics: true, config: true },
      }),
    ]);

  const meanErrorAvg = avgError._avg.meanErrorPx ?? null;

  // Build sessions by day for last 14 days (fill missing days with 0)
  const dayCounts: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = daysAgo(i);
    const key = d.toISOString().slice(0, 10);
    dayCounts[key] = 0;
  }
  for (const s of recentSessions) {
    const key = s.createdAt.toISOString().slice(0, 10);
    if (key in dayCounts) dayCounts[key]++;
  }
  const sessionsByDay = Object.entries(dayCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date,
      count,
      label: formatDay(new Date(date)),
    }));

  type Demographics = { age?: number; gender?: string; country?: string; eyeConditions?: string[] };
  const getDemographics = (s: { demographics: unknown; config: unknown }): Demographics | null => {
    const d = s.demographics ?? (s.config as Record<string, unknown> | null)?.demographics;
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Demographics) : null;
  };

  const byAgeBucket: Record<string, number> = {
    '0-17': 0,
    '18-25': 0,
    '26-35': 0,
    '36-45': 0,
    '46-55': 0,
    '56-65': 0,
    '65+': 0,
  };
  const byCountry: Record<string, number> = {};
  const byEyeCondition: Record<string, number> = {};

  for (const s of sessionsForDemographics) {
    const d = getDemographics(s);
    if (!d) continue;
    if (typeof d.age === 'number') {
      if (d.age <= 17) byAgeBucket['0-17']++;
      else if (d.age <= 25) byAgeBucket['18-25']++;
      else if (d.age <= 35) byAgeBucket['26-35']++;
      else if (d.age <= 45) byAgeBucket['36-45']++;
      else if (d.age <= 55) byAgeBucket['46-55']++;
      else if (d.age <= 65) byAgeBucket['56-65']++;
      else byAgeBucket['65+']++;
    }
    if (d.country && d.country !== 'not_specified') {
      byCountry[d.country] = (byCountry[d.country] ?? 0) + 1;
    }
    if (Array.isArray(d.eyeConditions)) {
      for (const c of d.eyeConditions) {
        if (c && c !== 'none') {
          byEyeCondition[c] = (byEyeCondition[c] ?? 0) + 1;
        }
      }
    }
  }

  const sessionsByAge = Object.entries(byAgeBucket)
    .map(([range, count]) => ({ range, count }))
    .filter((d) => d.count > 0);
  const sessionsByCountry = Object.entries(byCountry)
    .sort(([, a], [, b]) => b - a)
    .map(([country, count]) => ({ country, count }));
  const topEyeConditions = Object.entries(byEyeCondition)
    .sort(([, a], [, b]) => b - a)
    .map(([condition, count]) => ({ condition, count }));

  const stats = {
    total,
    last7,
    last14,
    withVideo,
    withCalibrationImages,
    meanErrorAvg,
    sessionsByDay,
    sessionsByAge,
    sessionsByCountry,
    topEyeConditions,
    featureAnalytics: computeFeatureAnalytics(sessionsForFeatures),
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          Overview and analytics for eye tracking sessions.
        </p>
      </div>
      <AdminDashboardCharts stats={stats} />
    </div>
  );
}
