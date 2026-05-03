import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  let event: any;
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key, { apiVersion: '2023-10-16' as any });
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }
  const supabase = createServerClient();
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    await supabase.from('customers').update({ stripe_subscription_id: event.data.object.id }).eq('stripe_customer_id', event.data.object.customer);
  }
  if (event.type === 'customer.subscription.deleted') {
    await supabase.from('customers').update({ system_active: false }).eq('stripe_customer_id', event.data.object.customer);
  }
  return NextResponse.json({ received: true });
}
