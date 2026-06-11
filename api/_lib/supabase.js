import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel.');
  return createClient(url, key, { auth: { persistSession: false } });
}

export function normalizePhone(raw = '') {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}

export function isChipConnected(chip = {}) {
  const s = String(chip.connection_state || chip.connectionState || chip.status || '').toLowerCase();
  return chip.active !== false && ['open','connected','active'].includes(s);
}

export const defaultChips = [
  { label:'8352', name:'8352', instance:'chip-8352', base_url:'https://evolution.samuelvinsansi.com.br', api_key:'vinsansi8352', status:'open', connection_state:'open', active:true, daily_limit:120, block_size:30, interval_seconds:120, blocks:['08:00','10:00','12:00','14:00'] },
  { label:'6846', name:'6846', instance:'chip-6846', base_url:'https://evolution.samuelvinsansi.com.br', api_key:'vinsansi6846', status:'open', connection_state:'open', active:true, daily_limit:120, block_size:30, interval_seconds:120, blocks:['08:00','10:00','12:00','14:00'] },
  { label:'8457', name:'8457', instance:'chip-8457', base_url:'https://evolution.samuelvinsansi.com.br', api_key:'vinsansi8457', status:'saved', connection_state:'saved', active:true, daily_limit:120, block_size:30, interval_seconds:120, blocks:['08:00','10:00','12:00','14:00'] }
];
