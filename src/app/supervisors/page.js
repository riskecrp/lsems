import { getSupervisors, getSupTaskStats, getPageAccess } from '../actions';
import SupervisorsClient from './SupervisorsClient';
export const dynamic = 'force-dynamic';
export default async function SupervisorsPage() {
  const [supervisors, stats, access] = await Promise.all([getSupervisors(), getSupTaskStats(), getPageAccess('supervisors')]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <SupervisorsClient supervisors={supervisors} stats={stats} perms={access} />;
}
