window.LeadService = (() => {
  async function listDashboardLeads() {
    return window.LeadsRepository.list({ limit: 50 });
  }

  async function createManualLead(formValues) {
    if (!formValues.company_name || !formValues.company_name.trim()) {
      throw new Error('Informe o nome da empresa.');
    }
    return window.LeadsRepository.createManual(formValues);
  }

  return { listDashboardLeads, createManualLead };
})();
