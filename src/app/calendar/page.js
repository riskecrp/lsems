import { getEvents, getPageAccess } from '../actions';
import CalendarClient from './CalendarClient';
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const [events, access] = await Promise.all([getEvents(), getPageAccess('calendar')]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <CalendarClient events={events} perms={access} />;
}
