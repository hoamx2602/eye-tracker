import { redirect } from 'next/navigation';

export default function AdminNeurologicalConfigPage() {
  redirect('/admin/config?tab=neuro');
}
