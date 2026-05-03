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
  const { data: messages } = await supabase.from('sms_messages').select('*')
    .eq('customer_id', params.id).order('created_at', { ascending: true });
  const threads = new Map<string, { phone: string; msgs: any[]; lastTs: string; unread: number }>();
  for (const msg of (messages ?? [])) {
    const phone = msg.direction === 'inbound' ? msg.from_phone : msg.to_phone;
    if (!threads.has(phone)) threads.set(phone, { phone, msgs: [], lastTs: msg.created_at, unread: 0 });
    const t = threads.get(phone)!;
    t.msgs.push(msg); t.lastTs = msg.created_at;
    if (msg.direction === 'inbound') t.unread++;
  }
  const fmt = (ts: string) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const conversations = Array.from(threads.values())
    .sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime())
    .map(t => ({ id: t.phone, phone: t.phone, name: t.phone, preview: t.msgs[t.msgs.length - 1]?.body ?? '', time: fmt(t.lastTs), unread: t.unread, messages: t.msgs.map(m => ({ id: m.id, from: m.direction === 'inbound' ? 'customer' : 'ai', text: m.body, time: fmt(m.created_at) })) }));
  return NextResponse.json({ conversations });
}
