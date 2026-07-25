type Props = { title: string; description: string; tables: readonly string[] };
export function ModulePlaceholder({ title, description, tables }: Props) {
  return <section className="card"><span className="eyebrow">Módulo preparado</span><h2>{title}</h2><p>{description}</p><div className="tags">{tables.map((table) => <code key={table}>{table}</code>)}</div></section>;
}
