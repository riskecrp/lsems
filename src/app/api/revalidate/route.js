import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'crypto';

function secretOk(given) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req) {
  const { secret } = await req.json().catch(() => ({}));
  if (!secretOk(secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  revalidatePath('/');
  revalidatePath('/hours');
  revalidatePath('/bonuses');
  revalidatePath('/past-employees');
  revalidatePath('/history');
  return Response.json({ ok: true, revalidated: true });
}
