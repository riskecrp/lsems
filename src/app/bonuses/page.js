import { getBonuses, getBonusPayments, getBonusResolutions, getDivisionalData, getAppSettings, getPageAccess } from '../actions';
import BonusesClient from './BonusesClient';
export const dynamic = 'force-dynamic';
export default async function BonusesPage() {
  const [bonuses, payments, divData, settings, access, resolutions] = await Promise.all([
    getBonuses(), getBonusPayments(), getDivisionalData(), getAppSettings(), getPageAccess('bonuses'), getBonusResolutions(),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return <BonusesClient bonuses={bonuses} payments={payments} resolutions={resolutions} divData={divData} bbcodeTemplates={settings.bbcode_templates} bonusCycle={settings.bonus_cycle} perms={access} />;
}
