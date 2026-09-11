import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { RoutedRequest, RoutedResponse } from '../dispatch.js';
import { notifyInboundWhatsappMessage } from '../../mobile/push.js';

type Row=Record<string,unknown>;
const text=(v:unknown)=>String(v??'').trim();
const record=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
function header(req:RoutedRequest,name:string){const value=req.headers?.[name]??req.headers?.[name.toLowerCase()];return text(Array.isArray(value)?value[0]:value);}
function serviceClient(){const url=text(process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL);const key=text(process.env.SUPABASE_SERVICE_ROLE_KEY);if(!url||!key)throw new Error('control_plane_supabase_not_configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
function constantTimeHex(left:string,right:string){if(!/^[a-f0-9]{64}$/i.test(left)||!/^[a-f0-9]{64}$/i.test(right))return false;const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');return a.length===b.length&&timingSafeEqual(a,b);}
function jsonDepth(v:unknown,depth=0):number{if(depth>24)return depth;if(!v||typeof v!=='object')return depth;if(Array.isArray(v))return v.reduce<number>((m,x)=>Math.max(m,jsonDepth(x,depth+1)),depth+1);return Object.values(v as Row).reduce<number>((m,x)=>Math.max(m,jsonDepth(x,depth+1)),depth+1);}
function directJid(v:unknown){const jid=text(v).toLowerCase().replace(/@c\.us$/,'@s.whatsapp.net');return /^\d+@(s\.whatsapp\.net|lid)$/.test(jid)?jid:'';}
function nonDirect(v:unknown){const jid=text(v).toLowerCase();return jid==='status@broadcast'||jid.endsWith('@g.us')||jid.endsWith('@broadcast')||jid.endsWith('@newsletter');}
function normalizeStatus(v:unknown){const s=text(v).toLowerCase();if(['read','read_receipt','played'].includes(s))return'read';if(['delivered','delivery','delivered_to_user'].includes(s))return'delivered';if(['sent','server_ack','accepted'].includes(s))return'sent';if(['failed','error'].includes(s))return'failed';if(['pending','sending'].includes(s))return s;return'';}
function isoTimestamp(v:unknown){const n=Number(v);if(Number.isFinite(n)&&n>0){const ms=n<10_000_000_000?n*1000:n;return new Date(ms).toISOString();}const d=new Date(text(v));return Number.isNaN(d.getTime())?null:d.toISOString();}
function messageShape(data:Row){const key=record(data.key??data.Key);const message=record(data.message??data.Message);const remote=directJid(key.remoteJid??key.remote_jid);const alt=directJid(key.remoteJidAlt??key.remote_jid_alt);const fromMe=key.fromMe===true||key.from_me===true;const id=text(key.id??key.ID);let type='text',body='';
 if(typeof message.conversation==='string')body=text(message.conversation);
 else if(record(message.extendedTextMessage).text){body=text(record(message.extendedTextMessage).text);}
 else if(message.imageMessage){type='image';body='[Imagem]';}
 else if(message.audioMessage){type='audio';body='[Áudio]';}
 else if(message.stickerMessage){type='sticker';body='[Figurinha]';}
 else if(message.documentMessage){type='document';body='[Documento]';}
 else {const mt=text(data.messageType??data.message_type).toLowerCase();if(['image','audio','sticker','document'].includes(mt)){type=mt;body=mt==='image'?'[Imagem]':mt==='audio'?'[Áudio]':mt==='sticker'?'[Figurinha]':'[Documento]';}}
 return{id,remote,alt,fromMe,type,body,pushName:text(data.pushName??data.push_name),timestamp:isoTimestamp(data.messageTimestamp??data.timestamp),status:normalizeStatus(data.status)};
}

export default async function handler(req:RoutedRequest,res:RoutedResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
 try{
  const instanceIdRaw=req.query?.instance_id;const instanceId=text(Array.isArray(instanceIdRaw)?instanceIdRaw[0]:instanceIdRaw);if(!/^\d+$/.test(instanceId))return res.status(400).json({ok:false,error:'instance_id_required'});
  const signature=header(req,'x-evolution-signature'),headerInstance=header(req,'x-evolution-instance-id');if(!signature||headerInstance!==instanceId)return res.status(401).json({ok:false,error:'evolution_webhook_headers_invalid'});
  const payload=record(req.body);const encoded=Buffer.byteLength(JSON.stringify(payload));if(encoded>524_288||jsonDepth(payload)>24)return res.status(413).json({ok:false,error:'evolution_webhook_payload_too_large'});
  const admin=serviceClient();const instance=await admin.from('instances').select('instances_id,users_id,organizations_id,instances_name').eq('instances_id',Number(instanceId)).maybeSingle();if(instance.error||!instance.data)return res.status(404).json({ok:false,error:'instance_not_found'});
  const credentials=await admin.rpc('service_get_evolution_instances',{p_users_id:Number(instance.data.users_id),p_instances_id:Number(instanceId),p_instance_name:null});if(credentials.error)throw new Error('instance_credential_lookup_failed');
  const row=(Array.isArray(credentials.data)?credentials.data[0]:credentials.data) as Row|undefined;const apiKey=text(row?.api_key);if(!apiKey)throw new Error('instance_credential_unavailable');
  const expected=createHmac('sha256',apiKey).update(`${instanceId}:${text(instance.data.instances_name)}`).digest('hex');if(!constantTimeHex(signature,expected))return res.status(401).json({ok:false,error:'evolution_webhook_signature_invalid'});

  const event=text(payload.event??payload.type??payload.eventType).toLowerCase().replace(/-/g,'_');const data=record(payload.data??payload.Data);const msg=messageShape(data);
  if(nonDirect(msg.remote)||['contacts.update','contacts_upsert','contacts_update','pushname','push_name','presence','status','newsletter','chats.upsert','chats.update'].includes(event))return res.status(200).json({ok:true,ignored:true,reason:'non_operational_event'});
  if(['messages.upsert','message','messages_upsert','send.message','send_message','sendmessage'].includes(event)){
    if(!msg.id||!msg.remote)return res.status(200).json({ok:true,ignored:true,reason:'non_direct_or_missing_identity'});
    const rawForIdentity={key:{remoteJid:msg.remote,...(msg.alt?{remoteJidAlt:msg.alt}:{})}};
    const result=await admin.rpc('service_ingest_evolution_message',{p_instances_id:Number(instanceId),p_event_type:event,p_external_message_id:msg.id,p_remote_jid:msg.remote,p_from_me:msg.fromMe,p_message_type:msg.type,p_message_body:msg.body,p_message_status:msg.status||null,p_contact_name:msg.pushName||null,p_provider_timestamp:msg.timestamp,p_raw_payload:rawForIdentity,p_media_url:null,p_media_mime_type:null,p_media_file_name:null,p_quoted_external_message_id:null});if(result.error)throw new Error(result.error.message);
    const outcome=record(result.data);if(!msg.fromMe&&outcome.ignored!==true&&outcome.duplicate!==true){try{await notifyInboundWhatsappMessage({instanceId:Number(instanceId),externalMessageId:msg.id});}catch(error){console.warn('[mobile-push]',error instanceof Error?error.message:'push_failed');}}
    return res.status(200).json({ok:true,...outcome});
  }
  if(['messages.update','messages_update','receipt','read_receipt','message_status','status_update'].includes(event)){
    const key=record(data.key??data.Key);const externalId=text(key.id??key.ID??data.id??data.ID??(Array.isArray(data.MessageIDs)?data.MessageIDs[0]:''));const status=normalizeStatus(data.status??data.Type??data.type);if(!externalId||!status)return res.status(200).json({ok:true,ignored:true,reason:'status_identity_missing'});
    const result=await admin.rpc('service_update_evolution_message_status',{p_instances_id:Number(instanceId),p_external_message_id:externalId,p_message_status:status,p_event_type:event,p_raw_payload:{},p_provider_timestamp:isoTimestamp(data.timestamp??data.Timestamp)});if(result.error)throw new Error(result.error.message);return res.status(200).json({ok:true,...record(result.data)});
  }
  if(['connection.update','connection_update','connected','disconnected','loggedout','logged_out'].includes(event)){
    const state=text(data.state??data.status??event);const result=await admin.rpc('service_update_evolution_connection_state_r60',{p_instances_id:Number(instanceId),p_provider_state:state});if(result.error)throw new Error(result.error.message);return res.status(200).json({ok:true,...record(result.data)});
  }
  return res.status(200).json({ok:true,ignored:true,reason:'unsupported_event'});
 }catch(error){return res.status(500).json({ok:false,error:error instanceof Error?error.message:'evolution_webhook_failed'});}
}
