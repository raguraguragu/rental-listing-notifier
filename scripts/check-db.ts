import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { data, error } = await client
  .from('line_users')
  .select('user_id, display_name, event_type');

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`line_users レコード数: ${data.length}`);
for (const row of data) {
  console.log(`  ${row.display_name} | user_id: ${row.user_id} | event: ${row.event_type || '(空)'}`);
}
