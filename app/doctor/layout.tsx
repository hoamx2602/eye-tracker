import DoctorShell from '@/components/doctor/DoctorShell';

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return <DoctorShell>{children}</DoctorShell>;
}
