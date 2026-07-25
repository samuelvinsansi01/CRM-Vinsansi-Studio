-- OPCIONAL: normaliza estados legados para nome por extenso.
-- Revise antes de executar. Este script nao apaga dados e nao altera estrutura.
-- Tabelas cobertas: leads, base_permanente e pre_send_leads quando tiverem coluna state.

do $$
declare
  target_table text;
  tables text[] := array['leads', 'base_permanente', 'pre_send_leads'];
begin
  foreach target_table in array tables loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'state'
    ) then
      execute format($sql$
        update public.%I
        set state = case
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ac', 'acre') then 'Acre'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('al', 'alagoas') then 'Alagoas'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ap', 'amapa', 'amapá') then 'Amapá'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('am', 'amazonas') then 'Amazonas'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ba', 'bahia') then 'Bahia'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ce', 'ceara', 'ceará') then 'Ceará'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('df', 'distrito federal') then 'Distrito Federal'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('es', 'espirito santo', 'espírito santo') then 'Espírito Santo'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('go', 'goias', 'goiás') then 'Goiás'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ma', 'maranhao', 'maranhão') then 'Maranhão'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('mt', 'mato grosso') then 'Mato Grosso'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ms', 'mato grosso do sul', 'mato grosso sul') then 'Mato Grosso do Sul'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('mg', 'minas gerais') then 'Minas Gerais'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pa', 'para', 'pará') then 'Pará'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pb', 'paraiba', 'paraíba') then 'Paraíba'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pr', 'parana', 'paraná') then 'Paraná'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pe', 'pernambuco') then 'Pernambuco'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pi', 'piaui', 'piauí') then 'Piauí'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rj', 'rio de janeiro') then 'Rio de Janeiro'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rn', 'rio grande do norte', 'rio grande norte') then 'Rio Grande do Norte'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rs', 'rio grande do sul', 'rio grande sul') then 'Rio Grande do Sul'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ro', 'rondonia', 'rondônia') then 'Rondônia'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rr', 'roraima') then 'Roraima'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('sc', 'santa catarina') then 'Santa Catarina'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('sp', 'sao paulo', 'são paulo') then 'São Paulo'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('se', 'sergipe') then 'Sergipe'
          when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('to', 'tocantins') then 'Tocantins'
          else state
        end
        where state is not null
          and btrim(state) <> ''
          and state is distinct from case
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ac', 'acre') then 'Acre'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('al', 'alagoas') then 'Alagoas'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ap', 'amapa', 'amapá') then 'Amapá'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('am', 'amazonas') then 'Amazonas'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ba', 'bahia') then 'Bahia'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ce', 'ceara', 'ceará') then 'Ceará'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('df', 'distrito federal') then 'Distrito Federal'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('es', 'espirito santo', 'espírito santo') then 'Espírito Santo'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('go', 'goias', 'goiás') then 'Goiás'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ma', 'maranhao', 'maranhão') then 'Maranhão'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('mt', 'mato grosso') then 'Mato Grosso'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ms', 'mato grosso do sul', 'mato grosso sul') then 'Mato Grosso do Sul'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('mg', 'minas gerais') then 'Minas Gerais'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pa', 'para', 'pará') then 'Pará'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pb', 'paraiba', 'paraíba') then 'Paraíba'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pr', 'parana', 'paraná') then 'Paraná'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pe', 'pernambuco') then 'Pernambuco'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('pi', 'piaui', 'piauí') then 'Piauí'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rj', 'rio de janeiro') then 'Rio de Janeiro'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rn', 'rio grande do norte', 'rio grande norte') then 'Rio Grande do Norte'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rs', 'rio grande do sul', 'rio grande sul') then 'Rio Grande do Sul'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('ro', 'rondonia', 'rondônia') then 'Rondônia'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('rr', 'roraima') then 'Roraima'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('sc', 'santa catarina') then 'Santa Catarina'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('sp', 'sao paulo', 'são paulo') then 'São Paulo'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('se', 'sergipe') then 'Sergipe'
            when lower(regexp_replace(btrim(state), '[._-]+', ' ', 'g')) in ('to', 'tocantins') then 'Tocantins'
            else state
          end;
      $sql$, target_table);
    end if;
  end loop;
end $$;

