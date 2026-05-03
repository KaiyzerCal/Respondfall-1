import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { callerPhone } = await req.json();
  if (!callerPhone) return NextResponse.json({ error: 'callerPhone required' }, { status: 400 });
  const supabase = createServerClient();
  const { data: c } = await supabase.from('customers')
    .select('id, business_name, twilio_number, google_review_link')
    .eq('id', params.id).eq('owner_id', user.id).single();
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const now = new Date();
  const reviewAt = new Date(now.getTime() + 2 * 3600 * 1000);
  const referralAt = new Date(now.getTime() + 30 * 60 * 1000);
  const reviewMsg = c.google_review_link
    ? `Hi! It was great serving you. If you have a moment, we'd love a Google review: ${c.google_review_link} — ${c.business_name}`
    : `Hi! It was great serving you today. We'd really appreciate your feedback! — ${c.business_name}`;
  const referralMsg = `Hey! Thanks for choosing ${c.business_name}. Know anyone who might need our help? Send us their name and we'll take care of them!`;
  await Promise.all([
    supabase.from('scheduled_messages').insert({ customer_id: c.id, to_phone: callerPhone, body: reviewMsg, send_at: reviewAt.toISOString(), sequence_step: 1 }),
    supabase.from('scheduled_messages').insert({ customer_id: c.id, to_phone: callerPhone, body: referralMsg, send_at: referralAt.toISOString(), sequence_step: 1 }),
    supabase.from('analytics_events').insert({ customer_id: c.id, event_type: 'job_complete', metadata: { caller_phone: callerPhone } }),
    supabase.from('audit_log').insert({ customer_id: c.id, action: 'mark_job_complete', actor: user.email, metadata: { caller_phone: callerPhone } }),
  ]);
  if (process.env.N8N_TWILIO_PROVISION_WEBHOOK) {
    fetch(process.env.N8N_TWILIO_PROVISION_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'job_complete', customer_id: c.id, caller_phone: callerPhone, twilio_number: c.twilio_number, review_link: c.google_review_link }) }).catch(console.error);
  }
  return NextResponse.json({ ok: true, reviewScheduledAt: reviewAt, referralScheduledAt: referralAt });
}
