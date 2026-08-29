import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

const pageDescriptions: Record<string, string> = {
  Inicio: 'Visualize, organize e defina o destino operacional de cada lead.',
  Importar: 'Importe novos leads, valide os dados e revise a previa antes de salvar.',
  'Fila WhatsApp': 'Acompanhe os lotes programados e controle os disparos pelo WhatsApp.',
  'Fila Instagram': 'Gerencie os lotes programados e acompanhe os envios pelo Instagram.',
  'Base Permanente': 'Destino final dos leads processados, somente para consulta e bloqueio de nova prospecção.',
  Monitoramento: 'Acompanhe Workers, filas, alertas e recuperações operacionais.',
  Auditoria: 'Detecte inconsistencias entre leads e filas e aplique reparos protegidos.',
  Chips: 'Gerencie chips, limites operacionais e status de cada instancia.',
  Ramos: 'Cadastre ramos principais, categorias vinculadas e palavras-chave.',
  Templates: 'Gerencie os templates usados por canal, ramo e tipo de lead.',
  Importação: 'Configure regras usadas na importacao e validacao dos leads.',
  Importacao: 'Configure regras usadas na importacao e validacao dos leads.',
  Disparos: 'Configure limites, intervalos e regras dos envios automaticos.',
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
  const resolvedDescription = description ?? pageDescriptions[title] ?? '';

  return (
    <section className="page-header">
      <div className="page-header__copy">
        <h1>{title}</h1>
        {resolvedDescription ? <p>{resolvedDescription}</p> : null}
      </div>
      {action}
    </section>
  );
}
