import Link from 'next/link';
import { currentPortalUser } from '@/lib/current-user';
import PortalLogoutButton from '@/components/portal/PortalLogoutButton';

export default async function DoctorShell({ children }: { children: React.ReactNode }) {
  const user = await currentPortalUser();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-8">
            <Link href="/doctor" className="font-bold tracking-tight text-white">Neurotree Clinical</Link>
            <nav className="flex items-center gap-5 text-sm text-slate-300">
              <Link href="/doctor" className="hover:text-white">Dashboard</Link>
              <Link href="/doctor/patients" className="hover:text-white">Patients</Link>
              <Link href="/doctor/sessions" className="hover:text-white">Test results</Link>
              <Link href="/doctor/invitations" className="hover:text-white">Test links</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-400 sm:inline">Dr {user?.name ?? ''}</span>
            <PortalLogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
