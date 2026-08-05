import { DISCORD_CLIENT_ID, REDIRECT_URI } from '@/lib/auth';

export function GET() {
  const params = new URLSearchParams({
    client_id:    DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
  });
  return Response.redirect(
    `https://discord.com/api/oauth2/authorize?${params}`,
    302
  );
}
