import { getDiscussions, getSupervisors, getEmployees, getPageAccess } from '../actions';
import DiscussionsClient from './DiscussionsClient';
export const dynamic = 'force-dynamic';
export default async function DiscussionsPage() {
  const [discussions, supervisors, employees, access] = await Promise.all([
    getDiscussions(), getSupervisors(), getEmployees(), getPageAccess('discussions'),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  const loaMap = {};
  for (const e of employees) loaMap[e.name] = { isOnLoa: e.isOnLoa, loaEnd: e.loaEnd };
  return <DiscussionsClient discussions={discussions} supervisors={supervisors} loaMap={loaMap} perms={access} />;
}
