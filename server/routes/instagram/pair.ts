import type { ApiRequest,ApiResponse } from '../../maps/shared.js';
import { body,send,serviceClient } from '../../maps/shared.js';
import { exchangePairing,executorStatus,numericId,startPairing } from '../../tools/executor.js';
import { normalizeInstagramProfile } from '../../instagram/token.js';

export default async function handler(req:ApiRequest,res:ApiResponse){
  if(req.method!=='POST')return send(req,res,405,{ok:false,error:'method_not_allowed'});
  try{
    const input=body(req);const profile=normalizeInstagramProfile(input.profile_username??input.profile);
    if(!profile)throw new Error('instagram_profile_required');
    const organizationId=numericId(input.organizationId??Object.entries(req.headers??{}).find(([k])=>k.toLowerCase()==='x-vinsansi-organization-id')?.[1]);
    const externalInstallationId=String(input.externalInstallationId??input.installation_id??`instagram-${crypto.randomUUID()}`).trim();
    const pairing=await startPairing(req,{toolId:'vinsansi_instagram',organizationId,externalInstallationId,version:input.version??'1.7.0',capabilities:['organization.context','member.context','settings.read','presence.heartbeat','activity.report','instagram.queue.execute','instagram.dm.send','instagram.media.send','instagram.result.report']});
    const admin=serviceClient();const profiles=await admin.from('socials').select('socials_id,socials_username').eq('organizations_id',organizationId);
    if(profiles.error)throw new Error(`instagram_profile_authorization_failed:${profiles.error.message}`);
    if(!(profiles.data??[]).some((row)=>normalizeInstagramProfile(row.socials_username)===profile)){await admin.from('tool_executor_pairings').update({revoked_at:new Date().toISOString()}).eq('tool_executor_pairings_id',pairing.pairingId);throw new Error('instagram_profile_not_available_for_organization');}
    const issued=await exchangePairing({pairingCode:pairing.pairingCode});
    await admin.from('organization_tool_installations').update({metadata:{instagramProfile:profile,pairing:'stage4'}}).eq('organizations_id',organizationId).eq('tool_id','vinsansi_instagram').eq('external_installation_id',externalInstallationId);
    const bundle=JSON.stringify({version:1,userSession:issued.userSession,installationCredential:issued.installationCredential,organizationId:issued.organizationId,memberId:issued.memberId,externalInstallationId,profile});
    return send(req,res,200,{ok:true,token:bundle,user_session:issued.userSession,installation_credential:issued.installationCredential,organization_id:issued.organizationId,member_id:issued.memberId,profile_username:profile});
  }catch(error){const message=error instanceof Error?error.message:String(error);return send(req,res,executorStatus(error),{ok:false,error:message,message});}
}
