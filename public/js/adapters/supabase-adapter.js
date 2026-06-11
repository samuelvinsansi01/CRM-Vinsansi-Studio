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

  normalizeLead(lead = {}, userId) {
    return {
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
  }

  async saveLead(lead = {}) {
    const user = await this.getUser();
    if (!user || !lead?.id) return { data: null, error: null };

    const payload = this.normalizeLead(lead, user.id);

    const { data, error } = await this.client
      .from('leads')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();

    if (error) console.warn('[supabase-adapter] saveLead:', error.message, payload);
    return { data, error };
  }

  async saveNote(lead = {}, noteText = '') {
    const user = await this.getUser();
    const text = String(noteText || '').trim();
    if (!user || !lead?.id || !text) return { data: null, error: null };

    await this.saveLead(lead);

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
    if (!user || !lead?.id || !event) return { data: null, error: null };

    await this.saveLead(lead);

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
    if (!user || !lead?.id || !followupDate) return { data: null, error: null };

    await this.saveLead(lead);

    await this.client
      .from('lead_followups')
      .delete()
      .eq('user_id', user.id)
      .eq('lead_id', String(lead.id));

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
    if (!user || !lead?.id) return { data: null, error: null };

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
