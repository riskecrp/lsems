import { getHoursGrid, getAppSettings, getMyProfile, getPageAccess } from '../actions';
import HoursClient from './HoursClient';

export const dynamic = 'force-dynamic';

export default async function HoursPage() {
  const [{ employees, weeks, map }, settings, userProfile, access] = await Promise.all([
    getHoursGrid(),
    getAppSettings(),
    getMyProfile(),
    getPageAccess('hours'),
  ]);
  if (access.view === false) return (
    <div className="p-8 text-center" style={{ color:'var(--text-3)', fontStyle:'italic' }}>You don't have permission to view this page.</div>
  );
  return (
    <HoursClient
      employees={employees}
      weeks={weeks}
      hoursMap={map}
      hourReqs={settings.hour_requirements}
      userProfile={userProfile}
      bbcodeTemplates={settings.bbcode_templates}
      perms={access}
    />
  );
}
