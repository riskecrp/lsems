import './globals.css';
import Navbar from './Navbar';
import { getSession } from '@/lib/auth';
import { getAppSettings } from './actions';
import { cookies } from 'next/headers';

export const metadata = {
  title: 'LSEMS Dashboard',
  description: 'Los Santos Emergency Medical Services — Internal Management Suite',
  icons: { icon: '/lsems-logo.png' },
};

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const viewAsRaw   = cookieStore.get('lsems_viewas')?.value;
  const viewAs      = viewAsRaw ? parseInt(viewAsRaw) : null;

  const [session, settings] = await Promise.all([getSession(), getAppSettings()]);
  const pp = settings.page_permissions || {};

  // Minimum view level required per nav path (for navbar visibility)
  const pageViewLevels = {
    '/':               pp.roster?.view  ?? 1,
    '/hours':          pp.hours?.view   ?? 1,
    '/payroll':        pp.payroll?.view ?? 2,
    '/bonuses':        pp.bonuses?.view ?? 2,
    '/tasks':          pp.tasks?.view   ?? 1,
    '/history':        pp.history?.view ?? 1,
    '/past-employees': pp.history?.view ?? 1,
    '/admin':          pp.admin?.view   ?? 2,
  };

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: "(function(){var t=localStorage.getItem('lsems-theme')||'dark';document.documentElement.setAttribute('data-theme',t);})()" }} />
      </head>
      <body className="min-h-screen font-sans antialiased" style={{ color: 'var(--text-2)' }}>
        <Navbar session={session} viewAs={viewAs} pageViewLevels={pageViewLevels} />
        <main className="relative z-10">{children}</main>
      </body>
    </html>
  );
}
