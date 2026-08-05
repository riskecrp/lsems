import { revalidatePath } from 'next/cache';

export async function POST(req) {
  const { secret } = await req.json().catch(() => ({}));
  if (secret !== process.env.REVALIDATE_SECRET && secret !== 'lsems-loa-revalidate') {
    return Response.json({ ok: false }, { status: 401 });
  }
  revalidatePath('/');
  revalidatePath('/hours');
  revalidatePath('/bonuses');
  revalidatePath('/past-employees');
  revalidatePath('/history');
  return Response.json({ ok: true, revalidated: true });
}
