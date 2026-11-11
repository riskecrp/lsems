import { getTreasury, getEmployees, getBonusPayments, getBonusResolutions, getPageAccess, getAppSettings } from '../actions';
import PayrollClient from './PayrollClient';

export const revalidate = 0;

export default async function PayrollPage() {
  const [{ transactions, balance }, employees, bonusPayments, access, settings, bonusResolutions] = await Promise.all([
    getTreasury(),
    getEmployees(),
    getBonusPayments(),
    getPageAccess('payroll'),
    getAppSettings(),
    getBonusResolutions(),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <PayrollClient transactions={transactions} currentBalance={balance} employees={employees} bonusPayments={bonusPayments} bonusResolutions={bonusResolutions} bonusCycle={settings.bonus_cycle} perms={access} />;
}
