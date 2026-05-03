import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth';

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { areaCode } = await req.json();
  if (!areaCode) return NextResponse.json({ error: 'areaCode required' }, { status: 400 });
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return NextResponse.json({ error: 'Twilio not configured' }, { status: 503 });
  const creds = Buffer.from(`${sid}:${token}`).toString('base64');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const searchRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&Capabilities=SMS&Capabilities=Voice`,
    { headers: { Authorization: `Basic ${creds}` } }
  );
  const sd = await searchRes.json();
  const available = sd.available_phone_numbers?.[0];
  if (!available) return NextResponse.json({ error: `No numbers available in area code ${areaCode}` }, { status: 404 });
  const buyRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`,
    { method: 'POST', headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ PhoneNumber: available.phone_number, VoiceUrl: `${appUrl}/api/webhooks/twilio/incoming-call`, VoiceMethod: 'POST', SmsUrl: `${appUrl}/api/webhooks/twilio/incoming-sms`, SmsMethod: 'POST' }).toString() }
  );
  if (!buyRes.ok) { const e = await buyRes.json(); return NextResponse.json({ error: e.message ?? 'Failed to provision' }, { status: 500 }); }
  const bd = await buyRes.json();
  return NextResponse.json({ phoneNumber: bd.phone_number });
}
