import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createServerClient();
  const { data: customer } = await supabase.from('customers').select('id, job_value')
    .eq('id', params.id).eq('owner_id', user.id).single();
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const ago30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [mt, st, m30] = await Promise.all([
    supabase.from('missed_calls').select('id', { count: 'exact', head: true })
      .eq('customer_id', params.id).gte('called_at', todayStart.toISOString()),
    supabase.from('sms_messages').select('id', { count: 'exact', head: true })
      .eq('customer_id', params.id).eq('direction', 'outbound').gte('created_at', todayStart.toISOString()),
    supabase.from('missed_calls').select('id', { count: 'exact', head: true })
      .eq('customer_id', params.id).gte('called_at', ago30.toISOString()),
  ]);
  const missed30 = m30.count ?? 0;
  return NextResponse.json({
    missedToday: mt.count ?? 0,
    smsSentToday: st.count ?? 0,
    missed30Days: missed30,
    revenueProtected: missed30 * (customer.job_value ?? 300),
  });
}
