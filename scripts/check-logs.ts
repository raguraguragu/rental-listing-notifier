import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const c = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { data: logs } = await c
  .from('notification_logs')
  .select('line_user_id, status, created_at')
  .order('created_at', { ascending: false })
  .limit(10);

console.log('notification_logs (最新10件):');
console.log(JSON.stringify(logs, null, 2));

const { data: props } = await c
  .from('notified_properties')
  .select('line_user_id, property_fingerprint, created_at')
  .order('created_at', { ascending: false })
  .limit(10);

console.log('\nnotified_properties (最新10件):');
console.log(JSON.stringify(props, null, 2));
