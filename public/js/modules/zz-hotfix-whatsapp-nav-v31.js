
(function(){
  function qs(id){ return document.getElementById(id); }
  function setOnlyPanel(panelId,label){
    document.querySelectorAll('.panel').forEach(function(p){
      var on=p.id===panelId;
      p.classList.toggle('active',on);
      p.style.display=on?'flex':'none';
      if(on){
        p.style.width='100%'; p.style.maxWidth='none';
        if(panelId==='panel-fila-zap') { p.style.flexDirection='row'; p.style.padding='0'; p.style.overflow='hidden'; }
        else { p.style.flexDirection='column'; p.style.padding='24px 28px'; p.style.overflow='auto'; }
      }
    });
    document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.toggle('active',(n.getAttribute('data-label')||'')===label); });
  }
  var oldSwitch = window.switchPanel;
  window.switchPanel = function(name){
    var n=String(name||'').toLowerCase();
    if(n==='whatsapp'||n==='fila-zap'||name==='WhatsApp') { setOnlyPanel('panel-fila-zap','WhatsApp'); if(typeof window.renderFilaZap==='function') setTimeout(window.renderFilaZap,0); return; }
    if(n==='pre-envio'||name==='Pré-envio') { setOnlyPanel('panel-pre-envio','Pré-envio'); if(typeof window.renderPreEnvioPanelV31==='function') setTimeout(window.renderPreEnvioPanelV31,0); return; }
    if(n==='instagram'||name==='Instagram') { setOnlyPanel('panel-instagram','Instagram'); if(typeof window.renderInstagram==='function') setTimeout(window.renderInstagram,0); return; }
    if(n==='ja-enviados'||name==='Já enviados') { setOnlyPanel('panel-ja-enviados','Já enviados'); if(typeof window.renderSentContactsPanelV31==='function') setTimeout(window.renderSentContactsPanelV31,0); return; }
    if(n==='atribuicao'||name==='Atribuição') { setOnlyPanel('panel-atribuicao','Atribuição'); if(typeof window.renderAtribuicaoPanelV31==='function') setTimeout(window.renderAtribuicaoPanelV31,0); return; }
    return oldSwitch ? oldSwitch(name) : undefined;
  };
  document.addEventListener('click',function(e){
    var nav=e.target.closest&&e.target.closest('.nav-item[data-label]'); if(!nav) return;
    var label=nav.getAttribute('data-label')||'';
    if(['Pré-envio','WhatsApp','Instagram','Já enviados','Atribuição'].indexOf(label)>=0){
      e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); window.switchPanel(label);
    }
  },true);
})();
