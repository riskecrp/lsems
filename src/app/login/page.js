import Image from 'next/image';

const ERRORS = {
  denied: 'Authorization was denied.',
  token:  'Failed to get access token from Discord. Please wait a moment and try again.',
  guild:  'You must be a member of the LSEMS Discord server.',
  role:   'You do not have the required role to access this dashboard.',
  state:  'Your login session expired or was started in another browser. Please try again.',
  server: 'Discord returned an unexpected response — this is usually a temporary rate-limit. Wait 60 seconds then try again.',
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = ERRORS[params?.error] || null;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-page)',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, margin: '0 auto', padding: '0 16px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
      }}>
        {/* Logo + title */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Image src="/lsems-logo.png" alt="LSEMS" width={64} height={64} style={{ borderRadius: 12 }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              LSEMS
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', marginTop: 2 }}>
              Management Suite
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="surface" style={{ width: '100%', padding: '28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6 }}>
            Sign in to continue
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 24, lineHeight: 1.5 }}>
            Access is restricted to authorized LSEMS personnel. Sign in with your Discord account to verify your role.
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: 'var(--c-danger-bg)', border: '1px solid var(--c-danger-glow)',
              color: 'var(--c-danger)', fontSize: 12,
            }}>
              {error}
            </div>
          )}

          <a href="/api/auth/login" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '11px 20px', borderRadius: 10, textDecoration: 'none',
            background: '#5865F2', color: '#fff',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
            boxShadow: '0 4px 20px rgba(88,101,242,0.40)',
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={undefined}
          >
            <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="#fff">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
            </svg>
            Sign in with Discord
          </a>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-4)', textAlign: 'center' }}>
          Los Santos Emergency Medical Services — Internal Use Only
        </div>
      </div>
    </div>
  );
}
