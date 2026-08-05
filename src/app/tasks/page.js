import { getSupTasks, getSupervisors, getSupTaskStats, getDiscussions, getEmployees, getPageAccess } from '../actions';
import OperationsClient from './OperationsClient';
export const dynamic = 'force-dynamic';

const SUPERVISOR_RANKS = new Set(['Lead Paramedic', 'Senior Paramedic', 'Paramedic', 'Junior Paramedic']);

export default async function OperationsPage() {
  const [tasks, supervisors, stats, discussions, employees, taskPerms, discPerms] = await Promise.all([
    getSupTasks(false), getSupervisors(), getSupTaskStats(), getDiscussions(), getEmployees(),
    getPageAccess('tasks'), getPageAccess('discussions'),
  ]);
  if (taskPerms.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  const loaMap = {};
  const assignees = [];
  for (const e of employees) {
    loaMap[e.name] = { isOnLoa: e.isOnLoa, loaEnd: e.loaEnd };
    if (SUPERVISOR_RANKS.has(e.rank)) assignees.push({ name: e.name, rank: e.rank, isOnLoa: e.isOnLoa });
  }
  return <OperationsClient tasks={tasks} supervisors={supervisors} assignees={assignees} stats={stats} discussions={discussions} loaMap={loaMap} taskPerms={taskPerms} discPerms={discPerms} />;
}
