import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendSMS } from '@/lib/twilio/sms';

// Called by Railway cron every minute.
// Reads pending scheduled_messages where send_at <= now, respects blackout hours, sends via Twilio.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const now = new Date();

  // Fetch pending messages due to send
  const { data: messages, error } = await supabase
    .from('scheduled_messages')
    .select('*, customers(twilio_number, business_name, blackout_start, blackout_end, system_active)')
    .eq('status', 'pending')
    .lte('send_at', now.toISOString())
    .limit(50);

  if (error) {
    console.error('cron fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const msg of messages) {
    const customer = msg.customers as {
      twilio_number: string;
      business_name: string;
      blackout_start: number;
      blackout_end: number;
      system_active: boolean;
    } | null;

    if (!customer) {
      await supabase.from('scheduled_messages').update({ status: 'failed', error: 'customer not found' }).eq('id', msg.id);
      continue;
    }

    // Skip if system is paused
    if (!customer.system_active) {
      skipped++;
      continue;
    }

    // Check opt-out
    const { data: optOut } = await supabase
      .from('sms_messages')
      .select('id')
      .eq('customer_id', msg.customer_id)
      .eq('caller_phone', msg.to_phone)
      .eq('opt_out', true)
      .limit(1)
      .maybeSingle();

    if (optOut) {
      await supabase.from('scheduled_messages').update({ status: 'cancelled', error: 'opted out' }).eq('id', msg.id);
      skipped++;
      continue;
    }

    // Blackout hours check (use customer local hour approximation via UTC)
    const hour = now.getUTCHours();
    const { blackout_start: bs, blackout_end: be } = customer;
    const inBlackout = bs > be
      ? (hour >= bs || hour < be)   // wraps midnight e.g. 22-7
      : (hour >= bs && hour < be);  // same day e.g. 0-6

    if (inBlackout) {
      // Reschedule to end of blackout
      const sendDate = new Date(now);
      sendDate.setUTCHours(be, 0, 0, 0);
      if (sendDate <= now) sendDate.setUTCDate(sendDate.getUTCDate() + 1);
      await supabase.from('scheduled_messages').update({ send_at: sendDate.toISOString() }).eq('id', msg.id);
      skipped++;
      continue;
    }

    // For multi-step booking sequences: skip if customer replied
    if (msg.sequence_type === 'booking' && msg.step > 1) {
      const { data: reply } = await supabase
        .from('sms_messages')
        .select('id')
        .eq('customer_id', msg.customer_id)
        .eq('caller_phone', msg.to_phone)
        .eq('direction', 'inbound')
        .gte('created_at', msg.created_at)
        .limit(1)
        .maybeSingle();

      if (reply) {
        await supabase.from('scheduled_messages').update({ status: 'cancelled', error: 'customer replied' }).eq('id', msg.id);
        skipped++;
        continue;
      }
    }

    try {
      await sendSMS(customer.twilio_number, msg.to_phone, msg.body);

      // Log outbound
      await supabase.from('sms_messages').insert({
        customer_id: msg.customer_id,
        caller_phone: msg.to_phone,
        direction: 'outbound',
        body: msg.body,
        sequence_type: msg.sequence_type,
        step: msg.step,
      });

      await supabase.from('scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', msg.id);
      sent++;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'send failed';
      console.error('SMS send error:', errMsg);
      await supabase.from('scheduled_messages').update({ status: 'failed', error: errMsg }).eq('id', msg.id);
    }
  }

  return NextResponse.json({ processed: messages.length, sent, skipped });
}
