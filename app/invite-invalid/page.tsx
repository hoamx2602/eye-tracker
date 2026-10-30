import Link from 'next/link';

export default function InvalidInvitePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
        <h1 className="text-2xl font-bold">This test link is unavailable</h1>
        <p className="mt-3 text-slate-400">It may have expired, reached its usage limit, or been disabled. Ask your doctor for a new link.</p>
        <Link href="/" className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Back to home</Link>
      </div>
    </main>
  );
}
