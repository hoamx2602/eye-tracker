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

  const [total, last7, last14, withVideo, withCalibrationImages, avgError, recentSessions, sessionsForFeatures] =
    await Promise.all([
      prisma.session.count(),
      prisma.session.count({ where: { createdAt: { gte: from7 } } }),
      prisma.session.count({ where: { createdAt: { gte: from14 } } }),
      prisma.session.count({ where: { videoUrl: { not: null } } }),
      prisma.session.count({ where: { calibrationImageUrls: { not: null } } }),
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

  const stats = {
    total,
    last7,
    last14,
    withVideo,
    withCalibrationImages,
    meanErrorAvg,
    sessionsByDay,
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
