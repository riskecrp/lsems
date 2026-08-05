import { getEmployees, getPageAccess } from './actions';
import { getSession } from '@/lib/auth';
import RosterClient from './RosterClient';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const [employees, session, access] = await Promise.all([
    getEmployees(),
    getSession(),
    getPageAccess('roster'),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return (
    <RosterClient
      employees={employees}
      userLevel={session?.level ?? 1}
      perms={access}
    />
  );
}
