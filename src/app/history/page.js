import { getRankHistory, getPageAccess } from '../actions';
import HistoryClient from './HistoryClient';
export const dynamic = 'force-dynamic';
export default async function HistoryPage() {
  const [rankHistory, access] = await Promise.all([getRankHistory(), getPageAccess('history')]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <HistoryClient rankHistory={rankHistory} />;
}
