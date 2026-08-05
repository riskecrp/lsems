import { getTreasury, getEmployees, getBonusPayments, getPageAccess, getAppSettings } from '../actions';
import PayrollClient from './PayrollClient';

export const revalidate = 0;

export default async function PayrollPage() {
  const [{ transactions, balance }, employees, bonusPayments, access, settings] = await Promise.all([
    getTreasury(),
    getEmployees(),
    getBonusPayments(),
    getPageAccess('payroll'),
    getAppSettings(),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <PayrollClient transactions={transactions} currentBalance={balance} employees={employees} bonusPayments={bonusPayments} bonusCycle={settings.bonus_cycle} perms={access} />;
}
