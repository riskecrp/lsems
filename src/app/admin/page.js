import { getAppSettings, getAuditLog, getSupervisorStats } from '../actions';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import AdminClient from './AdminClient';
import { RANK_ORDER } from '../constants';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const cookieStore = await cookies();
  const [settings, session, auditLog, supStats] = await Promise.all([
    getAppSettings(),
    getSession(),
    getAuditLog(),
    getSupervisorStats(),
  ]);
  const viewAs    = parseInt(cookieStore.get('lsems_viewas')?.value || '0') || null;
  const realLevel = session?.level ?? 1;

  return (
    <AdminClient
      settings={settings}
      rankOrder={RANK_ORDER}
      realLevel={realLevel}
      viewAs={viewAs}
      auditLog={auditLog}
      supStats={supStats}
    />
  );
}
