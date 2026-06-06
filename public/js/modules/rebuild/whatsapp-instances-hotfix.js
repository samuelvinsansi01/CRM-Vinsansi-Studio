/* CRM Rebuild Fase 6.8 — remove filtro user_email inválido em whatsapp_instances */
(function(){
  async function listWhatsappInstances(){
    const client = window.CRMResolveSupabaseClient?.();
    const user = await window.CRMResolveCurrentUser?.(client);
    if (!client || !user?.id) return [];

    const { data, error } = await client
      .from('whatsapp_instances')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[CRM 6.8] Falha ao carregar whatsapp_instances:', error);
      return [];
    }
    return data || [];
  }

  window.CRMListWhatsappInstances = listWhatsappInstances;

  const oldGetChips = window.getChips;
  window.getChips = function(){
    try {
      if (typeof oldGetChips === 'function') return oldGetChips() || [];
    } catch(e) {
      console.warn('[CRM 6.8] getChips antigo falhou:', e);
    }
    return window.__crmChipsCache || [];
  };

  async function hydrateChipsCache(){
    const items = await listWhatsappInstances();
    window.__crmChipsCache = items.map(i => ({
      id: i.id,
      nome: i.label || i.instance_name || i.phone || 'Chip',
      instance: i.instance_name,
      phone: i.phone,
      status: i.status,
      raw: i
    }));
  }

  window.CRMHydrateChipsCache = hydrateChipsCache;
  document.addEventListener('DOMContentLoaded', () => setTimeout(hydrateChipsCache, 600));
})();
