import fs from 'node:fs';
const files = [
  'PATCH-CORRETIVO-CRM-2.4.0-R15.sql',
  'supabase/migrations/20260824213000_r15_multichannel_atomic_queue_preparation.sql',
];
for (const file of files) {
  const s = fs.readFileSync(file, 'utf8');
  const must = [
    'prepare_queue_items_rbac_inner',
    "v_channel_name NOT IN ('whatsapp', 'instagram')",
    "v_channel_name = 'instagram'",
    'qi.socials_id = p_resource_id',
    "CASE WHEN v_channel_name = 'instagram' THEN p_resource_id ELSE NULL END",
    "length(trim(coalesce(t.templates_message_1, ''))) > 0",
    'regexp_replace(lower(public.unaccent(trim(tc.template_channels_name)))',
  ];
  for (const token of must) if (!s.includes(token)) throw new Error(`${file}: missing ${token}`);
  if (s.includes("IF v_channel_name <> 'whatsapp'")) throw new Error(`${file}: legacy WhatsApp-only guard remains`);
  if (s.includes('AND length(trim(t.templates_message_4)) > 0')) throw new Error(`${file}: four-message requirement remains`);
}
const page = fs.readFileSync('src/pages/ConfigTablePage.tsx', 'utf8');
if (!page.includes("{ key: 'status', label: 'Status', width: '10%' },")) throw new Error('template status header not fixed');
console.log('R15 multichannel queue verification: OK');
