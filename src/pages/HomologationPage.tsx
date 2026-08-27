import { CheckCircle2, Circle, CircleX, RefreshCcw, Rocket, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, MetricCard, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useNotificationContext } from '../providers/NotificationProvider';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { getHomologationSnapshot, getProductionReadiness, promoteStableRelease, setHomologationCheck, startHomologation, type HomologationCheck, type HomologationSnapshot } from '../repositories/release/homologation.repository';

function tone(status:HomologationCheck['status']){return status==='passed'?'success':status==='failed'?'danger':status==='not_applicable'?'neutral':'warning';}
function label(status:HomologationCheck['status']){return status==='passed'?'Aprovado':status==='failed'?'Falhou':status==='not_applicable'?'N/A':'Pendente';}
function Icon({status}:{status:HomologationCheck['status']}){return status==='passed'?<CheckCircle2 size={18}/>:status==='failed'?<CircleX size={18}/>:<Circle size={18}/>;}

export function HomologationPage(){
  const {push}=useNotificationContext();
  const {hasPermission,isPlatformOwner}=useOrganizationContext();
  const canManage=hasPermission('monitoring.manage');
  const [snapshot,setSnapshot]=useState<HomologationSnapshot>({run:null,checks:[]});
  const [readiness,setReadiness]=useState<Record<string,unknown>|null>(null);
  const [loading,setLoading]=useState(true);const [saving,setSaving]=useState('');const [error,setError]=useState('');
  const refresh=useCallback(async()=>{setLoading(true);setError('');try{const [next,ready]=await Promise.all([getHomologationSnapshot(),getProductionReadiness().catch(()=>null)]);setSnapshot(next);setReadiness(ready);}catch(err){setError(err instanceof Error?err.message:'Falha ao carregar homologação.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();},[refresh]);
  type HomologationSummary = { total: number; pending: number; passed: number; failed: number; not_applicable: number };

  const summary=useMemo(()=>snapshot.checks.reduce<HomologationSummary>((acc:HomologationSummary,item:HomologationCheck)=>{
    acc.total += 1;
    const status: HomologationCheck['status'] = item.status;
    acc[status] += 1;
    return acc;
  },{total:0,pending:0,passed:0,failed:0,not_applicable:0}),[snapshot.checks]);
  const sections=useMemo(()=>{const map=new Map<string,HomologationCheck[]>();for(const check of snapshot.checks){const list=map.get(check.section)??[];list.push(check);map.set(check.section,list);}return [...map.entries()];},[snapshot.checks]);
  const start=async()=>{if(!canManage)return;const notes=window.prompt('Observação opcional para esta rodada de homologação:','')??'';setSaving('start');try{await startHomologation(notes);push({type:'success',message:'Homologação iniciada. A matriz completa de testes foi criada para esta organização.'});await refresh();}catch(err){push({type:'error',message:err instanceof Error?err.message:'Falha ao iniciar a homologação.'});}finally{setSaving('');}};
  const update=async(check:HomologationCheck,status:HomologationCheck['status'])=>{if(!snapshot.run||!canManage)return;let evidence=check.evidence||'';if(status==='failed'||status==='passed'){const value=window.prompt(status==='failed'?'Descreva o problema encontrado (recomendado):':'Evidência/observação do teste (opcional):',evidence);if(value===null)return;evidence=value;}setSaving(check.key);try{await setHomologationCheck(snapshot.run.id,check.key,status,evidence);await refresh();}catch(err){push({type:'error',message:err instanceof Error?err.message:'Falha ao salvar teste.'});}finally{setSaving('');}};
  const ready=Boolean(readiness?.ok);
  const promote=async()=>{if(!canManage||!ready)return;const confirmed=window.confirm('Promover a release 2.4.0 para Stable? Faça isso somente após concluir a rodada final de homologação.');if(!confirmed)return;setSaving('promote');try{await promoteStableRelease();push({type:'success',message:'Release promovida a Stable. A matriz de versões foi congelada após a homologação aprovada.'});await refresh();}catch(err){push({type:'error',message:err instanceof Error?err.message:'A plataforma ainda não está pronta para Stable.'});}finally{setSaving('');}};
  return <div className="dashboard-table-page">
    <PageHeader title="Homologação final" description="Matriz oficial da Etapa 15. A release só é considerada Stable depois que os testes obrigatórios passam, o readiness técnico fica saudável e a promoção é confirmada." action={<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button variant="secondary" iconLeft={RefreshCcw} disabled={loading} onClick={()=>void refresh()}>Atualizar</Button>{canManage?<Button iconLeft={Rocket} disabled={Boolean(saving)} onClick={()=>void start()}>{snapshot.run?'Nova rodada':'Iniciar homologação'}</Button>:null}{canManage&&isPlatformOwner&&ready?<Button iconLeft={ShieldCheck} disabled={Boolean(saving)} onClick={()=>void promote()}>Promover Stable</Button>:null}</div>}/>
    <section className="metric-grid metric-grid--6">
      <MetricCard icon={ShieldCheck} value={snapshot.run?.releaseVersion||'2.4.0'} label="Release alvo" tone="primary"/>
      <MetricCard icon={CheckCircle2} value={String(summary.passed)} label="Aprovados" tone="success"/>
      <MetricCard icon={Circle} value={String(summary.pending)} label="Pendentes"/>
      <MetricCard icon={CircleX} value={String(summary.failed)} label="Falhas" tone="danger"/>
      <MetricCard icon={ShieldCheck} value={snapshot.run?.status||'não iniciada'} label="Rodada"/>
      <MetricCard icon={ShieldCheck} value={ready?'PRONTO':'NÃO PRONTO'} label="Readiness" tone={ready?'success':'warning'}/>
    </section>
    {error?<Panel title="Erro"><div className="table-message">{error}</div></Panel>:null}
    {!snapshot.run&&!loading?<Panel title="Etapa 15"><div className="audit-state"><Rocket size={24}/><strong>Nenhuma rodada iniciada.</strong><span>Inicie a homologação para gerar a checklist completa desta organização.</span></div></Panel>:null}
    {snapshot.run?sections.map(([section,checks])=><Panel key={section} title={section}><div className="homologation-check-list">{checks.map(check=><div className={`homologation-check homologation-check--${check.status}`} key={check.key}><div className="homologation-check__icon"><Icon status={check.status}/></div><div className="homologation-check__body"><div><strong>{check.label}</strong><Tag tone={tone(check.status)}>{label(check.status)}</Tag></div>{check.evidence?<span>{check.evidence}</span>:<span className="muted">Sem evidência registrada.</span>}</div>{canManage?<div className="homologation-check__actions"><button disabled={saving===check.key} onClick={()=>void update(check,'passed')}>Aprovar</button><button disabled={saving===check.key} onClick={()=>void update(check,'failed')}>Falhou</button><button disabled={saving===check.key} onClick={()=>void update(check,'pending')}>Pendente</button></div>:null}</div>)}</div></Panel>):null}
  </div>;
}
