import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createServerClient();
  const { data: customer } = await supabase.from('customers').select('id')
    .eq('id', params.id).eq('owner_id', user.id).single();
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const fmt = (ts: string) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const [mr, sr] = await Promise.all([
    supabase.from('missed_calls').select('id, caller_phone, called_at')
      .eq('customer_id', params.id).order('called_at', { ascending: false }).limit(40),
    supabase.from('sms_messages').select('id, from_phone, to_phone, body, direction, created_at')
      .eq('customer_id', params.id).order('created_at', { ascending: false }).limit(40),
  ]);
  const events = [
    ...(mr.data ?? []).map(m => ({ id: m.id, type: 'missed' as const, caller: m.caller_phone, detail: 'Recovery SMS sent immediately', time: fmt(m.called_at), ts: m.called_at })),
    ...(sr.data ?? []).map(s => ({ id: s.id, type: (s.direction === 'inbound' ? 'received' : 'sent') as 'received' | 'sent', caller: s.direction === 'inbound' ? s.from_phone : s.to_phone, detail: s.body.length > 80 ? s.body.slice(0, 80) + '…' : s.body, time: fmt(s.created_at), ts: s.created_at })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 40);
  return NextResponse.json({ events });
}
