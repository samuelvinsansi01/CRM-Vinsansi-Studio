class SupabaseAdapter {
  constructor(client) {
    this.client = client;
  }

  async getUser() {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error) {
      console.warn('[supabase-adapter] getUser:', error.message);
      return null;
    }
    return data?.user || null;
  }

  normalizeLead(lead = {}, userId, userEmail = '') {
    const crmData = lead.crmData || lead.crm_data || lead.leadCrm || null;
    const payload = {
      id: String(lead.id || '').trim(),
      user_id: userId,
      company_name: lead.companyName || lead.nome || lead.title || 'Lead sem nome',
      phone: lead.phone || lead.whatsapp || lead.telefone || '',
      instagram: lead.instagram || lead.instagramUrl || '',
      website: lead.website || lead.site || '',
      maps_url: lead.mapsUrl || lead.googleUrl || lead.url || '',
      status: lead.status || 'Não enviada',
      pipeline_status: lead.pipelineStatus || lead.pipeline_status || 'contato_enviado',
      updated_at: new Date().toISOString()
    };

    if (userEmail) payload.user_email = String(userEmail).trim().toLowerCase();
    if (crmData && typeof crmData === 'object') payload.crm_data = crmData;

    return payload;
  }

  async saveLead(lead = {}) {
    const user = await this.getUser();
    if (!user?.id || !user?.email || !lead?.id) return { data: null, error: null };

    const payload = this.normalizeLead(lead, user.id, user.email);

    // V29: preservar dados já existentes da ficha/canais quando um snapshot local antigo
    // dispara um upsert parcial. O bug anterior mostrava "success", mas campos da ficha
    // sumiam após F5 porque syncs globais reenviavam lead sem crm_data ou com canais vazios.
    try {
      const { data: existing, error: existingError } = await this.client
        .from('leads')
        .select('phone,instagram,website,maps_url,status,pipeline_status,crm_data')
        .eq('user_id', user.id)
        .eq('id', payload.id)
        .maybeSingle();

      if (!existingError && existing) {
        ['phone', 'instagram', 'website', 'maps_url'].forEach(key => {
          if (!String(payload[key] || '').trim() && String(existing[key] || '').trim()) {
            payload[key] = existing[key];
          }
        });
        if (!payload.crm_data && existing.crm_data) payload.crm_data = existing.crm_data;
        if ((!payload.status || payload.status === 'Não enviada') && existing.status) payload.status = existing.status;
        if ((!payload.pipeline_status || payload.pipeline_status === 'contato_enviado') && existing.pipeline_status) {
          payload.pipeline_status = existing.pipeline_status;
        }
      }
    } catch (mergeError) {
      console.warn('[supabase-adapter] saveLead preserve-existing skipped:', mergeError?.message || mergeError);
    }

    let { data, error } = await this.client
      .from('leads')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error && /crm_data|user_email/i.test(String(error.message || ''))) {
      console.error('[supabase-adapter] saveLead schema missing: execute sql/lead_crm_data_persistence_v28.sql', error.message);
    }

    if (error) console.warn('[supabase-adapter] saveLead:', error.message, payload);
    else console.log('[supabase-adapter][saveLead-success]', { id: payload.id, hasCrmData: !!payload.crm_data, channels: { phone: payload.phone, instagram: payload.instagram, website: payload.website, maps_url: payload.maps_url } });
    return { data, error };
  }

  async saveNote(lead = {}, noteText = '') {
    const user = await this.getUser();
    const text = String(noteText || '').trim();
    if (!user?.id || !user?.email || !lead?.id || !text) return { data: null, error: null };

    const leadResult = await this.saveLead(lead);
    if (leadResult?.error) return leadResult;

    const { data, error } = await this.client
      .from('lead_notes')
      .insert({
        lead_id: String(lead.id),
        user_id: user.id,
        note: text
      })
      .select()
      .single();

    if (error) console.warn('[supabase-adapter] saveNote:', error.message);
    return { data, error };
  }

  async saveHistory(lead = {}, eventText = '') {
    const user = await this.getUser();
    const event = String(eventText || '').trim();
    if (!user?.id || !user?.email || !lead?.id || !event) return { data: null, error: null };

    const leadResult = await this.saveLead(lead);
    if (leadResult?.error) return leadResult;

    const { data, error } = await this.client
      .from('lead_history')
      .insert({
        lead_id: String(lead.id),
        user_id: user.id,
        event
      })
      .select()
      .single();

    if (error) console.warn('[supabase-adapter] saveHistory:', error.message);
    return { data, error };
  }

  getFollowUpStatus(dateIso = '') {
    if (!dateIso) return 'none';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const date = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return 'future';

    if (date.getTime() < today.getTime()) return 'late';
    if (date.getTime() === today.getTime()) return 'today';
    return 'future';
  }

  async saveFollowUp(lead = {}, dateIso = '') {
    const user = await this.getUser();
    const followupDate = String(dateIso || '').trim();
    if (!user?.id || !user?.email || !lead?.id || !followupDate) return { data: null, error: null };

    const leadResult = await this.saveLead(lead);
    if (leadResult?.error) return leadResult;

    const { error:deleteError } = await this.client
      .from('lead_followups')
      .delete()
      .eq('user_id', user.id)
      .eq('lead_id', String(lead.id));
    if (deleteError) return { data:null, error:deleteError };

    const { data, error } = await this.client
      .from('lead_followups')
      .insert({
        lead_id: String(lead.id),
        user_id: user.id,
        followup_date: followupDate,
        status: this.getFollowUpStatus(followupDate)
      })
      .select()
      .single();

    if (error) console.warn('[supabase-adapter] saveFollowUp:', error.message);
    return { data, error };
  }

  async clearFollowUp(lead = {}) {
    const user = await this.getUser();
    if (!user?.id || !user?.email || !lead?.id) return { data: null, error: null };

    const { data, error } = await this.client
      .from('lead_followups')
      .delete()
      .eq('user_id', user.id)
      .eq('lead_id', String(lead.id));

    if (error) console.warn('[supabase-adapter] clearFollowUp:', error.message);
    return { data, error };
  }
}

window.SupabaseAdapter = SupabaseAdapter;
