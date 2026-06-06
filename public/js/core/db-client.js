window.DbClient = (() => {
  function sb() {
    return window.CRMDb.getClient();
  }

  async function requireData(promise, fallbackMessage) {
    const { data, error } = await promise;
    if (error) {
      console.error('[DB]', error);
      throw new Error(error.message || fallbackMessage || 'Erro de banco de dados.');
    }
    return data;
  }

  async function select(table, queryBuilder) {
    const base = sb().from(table).select('*');
    const query = typeof queryBuilder === 'function' ? queryBuilder(base) : base;
    return requireData(query, `Falha ao consultar ${table}`);
  }

  async function insert(table, payload) {
    return requireData(sb().from(table).insert(payload).select().single(), `Falha ao inserir em ${table}`);
  }

  async function update(table, id, payload) {
    return requireData(sb().from(table).update(payload).eq('id', id).select().single(), `Falha ao atualizar ${table}`);
  }

  async function rpc(name, params = {}) {
    return requireData(sb().rpc(name, params), `Falha ao executar RPC ${name}`);
  }

  return { select, insert, update, rpc };
})();
