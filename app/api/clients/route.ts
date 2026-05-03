import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, business_name, business_phone, twilio_number, system_active, tier')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { businessName, businessPhone, ownerEmail, twilioNumber, tier } = await req.json();
  if (!businessName || !businessPhone || !ownerEmail)
    return NextResponse.json({ error: 'businessName, businessPhone, ownerEmail required' }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('customers')
    .insert({ owner_id: user.id, business_name: businessName, business_phone: businessPhone, owner_email: ownerEmail, twilio_number: twilioNumber ?? null, tier: tier ?? 'starter' })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}
