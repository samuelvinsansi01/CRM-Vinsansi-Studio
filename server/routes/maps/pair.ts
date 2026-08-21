import { MAPS_EXTENSION_SCOPES, sha256 } from '../../maps/token.js';
import { issueExecutorCredentials } from '../../tools/executor.js';
import { authenticatedUser, body, send, serviceClient, setCors, statusForError, text, type ApiRequest, type ApiResponse } from '../../maps/shared.js';

declare const process: { env: Record<string, string | undefined> };

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function panelUrl() {
  return text(process.env.PUBLIC_APP_URL ?? process.env.VITE_PUBLIC_APP_URL) || 'https://crm-vinsansi-studio.vercel.app';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') { setCors(req, res); res.status(204).end(); return; }
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, code: 'method_not_allowed' });
  try {
    const input = body(req);
    const action = text(input.action);
    const client = serviceClient();
    if (action === 'initiate') {
      const installationId = text(input.installationId);
      if (installationId.length < 16 || installationId.length > 200) throw new Error('installation_id_invalid');
      const pairingSecret = randomSecret();
      const pairingId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const created = await client.from('maps_extension_pairings').insert({
        maps_extension_pairings_id: pairingId,
        installation_id: installationId,
        pairing_secret_hash: await sha256(pairingSecret),
        status: 'pending',
        expires_at: expiresAt,
      });
      if (created.error) throw new Error(`pairing_create_failed:${created.error.message}`);
      const authorizationUrl = new URL(panelUrl());
      authorizationUrl.searchParams.set('maps_pairing', pairingId);
      return send(req, res, 200, { ok: true, pairingId, pairingSecret, authorizationUrl: authorizationUrl.toString(), expiresAt });
    }

    if (action === 'authorize') {
      const organizationId = Number(input.organizationId);
      const auth = await authenticatedUser(req, organizationId);
      const pairingId = text(input.pairingId);
      const current = await client.from('maps_extension_pairings').select('*').eq('maps_extension_pairings_id', pairingId).maybeSingle();
      if (current.error || !current.data) throw new Error('pairing_not_found');
      if (current.data.status !== 'pending' || Date.parse(String(current.data.expires_at)) <= Date.now()) throw new Error('pairing_not_pending');
      const updated = await client.from('maps_extension_pairings').update({
        users_id: auth.usersId,
        organizations_id: auth.organizationId,
        authorized_by_member_id: auth.memberId,
        authorized_auth_user_id: auth.authUserId,
        authorized_actor_users_id: auth.actorUsersId,
        status: 'authorized',
        authorized_at: new Date().toISOString(),
      }).eq('maps_extension_pairings_id', pairingId).eq('status', 'pending').select('maps_extension_pairings_id').maybeSingle();
      if (updated.error || !updated.data) throw new Error('pairing_authorization_conflict');
      console.info('[executor-context] maps-pairing-authorized', JSON.stringify({ pairingId, authUserId: auth.authUserId, organizationId: auth.organizationId, usersId: auth.actorUsersId, memberId: auth.memberId }));
      return send(req, res, 200, { ok: true, pairingId, authorized: true });
    }

    if (action === 'exchange') {
      const pairingId = text(input.pairingId);
      const pairingSecret = text(input.pairingSecret);
      const installationId = text(input.installationId);
      const installedVersion = text(input.installedVersion);
      const current = await client.from('maps_extension_pairings').select('*').eq('maps_extension_pairings_id', pairingId).maybeSingle();
      if (current.error || !current.data) throw new Error('pairing_not_found');
      if (current.data.installation_id !== installationId || current.data.pairing_secret_hash !== await sha256(pairingSecret)) throw new Error('pairing_secret_invalid');
      if (Date.parse(String(current.data.expires_at)) <= Date.now()) throw new Error('pairing_expired');
      if (current.data.status !== 'authorized' || !current.data.users_id) return send(req, res, 202, { ok: true, pending: true });
      if (!current.data.authorized_auth_user_id || !current.data.authorized_actor_users_id || !current.data.authorized_by_member_id || !current.data.organizations_id) throw new Error('pairing_context_incomplete');
      const issued = await issueExecutorCredentials({client,toolId:'vinsansi_capture',organizationId:Number(current.data.organizations_id),externalInstallationId:installationId,authUserId:String(current.data.authorized_auth_user_id),expectedUsersId:Number(current.data.authorized_actor_users_id),expectedMemberId:Number(current.data.authorized_by_member_id),version:/^\d+\.\d+\.\d+$/.test(installedVersion)?installedVersion:null,capabilities:['capture.maps']});
      const installation = await client.from('maps_extension_installations').upsert({
        users_id: Number(current.data.users_id),
        organizations_id: Number(current.data.organizations_id),
        extension_type: 'google_maps',
        installation_id: installationId,
        scopes: [...MAPS_EXTENSION_SCOPES],
        status: 'active',
        revoked_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'users_id,extension_type,installation_id' }).select('maps_extension_installations_id').single();
      if (installation.error) throw new Error(`installation_upsert_failed:${installation.error.message}`);
      const canonical = await client.rpc('service_register_tool_installation', {
        p_organizations_id: Number(current.data.organizations_id),
        p_tool_id: 'vinsansi_capture',
        p_external_installation_id: installationId,
        p_installed_version: /^\d+\.\d+\.\d+$/.test(installedVersion) ? installedVersion : null,
        p_reported_capabilities: ['capture.maps'],
        p_registered_by_member_id: current.data.authorized_by_member_id ? Number(current.data.authorized_by_member_id) : null,
        p_metadata: {
          legacyMapsInstallationId: String(installation.data.maps_extension_installations_id),
          legacyBridge: 'maps_extension_installations',
          removeInStage: 8,
        },
      });
      if (canonical.error || !canonical.data) throw new Error(`canonical_installation_register_failed:${canonical.error?.message ?? 'missing_id'}`);
      const linked = await client.from('maps_extension_installations').update({
        organization_tool_installations_id: canonical.data,
      }).eq('maps_extension_installations_id', installation.data.maps_extension_installations_id);
      if (linked.error) throw new Error(`canonical_installation_link_failed:${linked.error.message}`);
      const consumed = await client.from('maps_extension_pairings').update({ status: 'consumed', consumed_at: new Date().toISOString() }).eq('maps_extension_pairings_id', pairingId).eq('status', 'authorized').select('maps_extension_pairings_id').maybeSingle();
      if (consumed.error || !consumed.data) throw new Error('pairing_exchange_conflict');
      console.info('[executor-context] maps-pairing-exchanged', JSON.stringify({ pairingId, authUserId: String(current.data.authorized_auth_user_id), organizationId: issued.organizationId, usersId: issued.usersId, memberId: issued.memberId, installationId }));
      return send(req, res, 200, {
        ok: true,
        token: issued.userSession,
        userSession: issued.userSession,
        installationCredential: issued.installationCredential,
        organizationId: issued.organizationId,
        memberId: issued.memberId,
        installationId,
        scopes: [...MAPS_EXTENSION_SCOPES],
      });
    }

    return send(req, res, 400, { ok: false, code: 'pairing_action_invalid' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'maps_pairing_failed';
    return send(req, res, statusForError(message), { ok: false, code: message.split(':')[0], message });
  }
}
