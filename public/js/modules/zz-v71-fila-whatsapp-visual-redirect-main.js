(function(){
  const VERSION='20260618-V71-FILA-WHATSAPP-VISUAL-REDIRECT-MAIN';

  function injectStyles(){
    if(document.getElementById('v71-fila-zap-redirect-main-style')) return;
    const style=document.createElement('style');
    style.id='v71-fila-zap-redirect-main-style';
    style.textContent=`
      /* v71: restaura o visual base do arquivo redirect-main, sem trocar regras de fila/disparo */
      #panel-fila-zap.active{flex-direction:row!important;padding:0!important;overflow:hidden!important;}
      #panel-fila-zap{flex-direction:row!important;padding:0!important;overflow:hidden!important;height:100vh!important;}
      #panel-fila-zap .zapLeft{width:50%!important;flex-shrink:0!important;height:100vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:var(--bg)!important;}
      #panel-fila-zap .zapLeft-inner{display:flex!important;flex-direction:column!important;height:100%!important;overflow:hidden!important;}
      #panel-fila-zap .zapLeft-inner>div:nth-child(2){flex:1!important;display:flex!important;flex-direction:column!important;min-height:0!important;overflow:hidden!important;}
      #panel-fila-zap .zap-empresa-list{flex:1!important;overflow-y:auto!important;min-height:0!important;max-height:none!important;}
      #panel-fila-zap .zapRight{flex:1!important;width:auto!important;min-width:0!important;max-width:none!important;height:100vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:var(--surface)!important;}
      #panel-fila-zap .chip-accordion{display:flex!important;flex-direction:column!important;min-height:0!important;transition:flex .3s cubic-bezier(.4,0,.2,1)!important;flex-shrink:0!important;border-bottom:0!important;}
      #panel-fila-zap .chip-accordion.open{flex:1!important;flex-shrink:1!important;min-height:0!important;}
      #panel-fila-zap .chip-accordion-header{display:flex!important;align-items:center!important;gap:12px!important;padding:16px 20px!important;cursor:pointer!important;user-select:none!important;border-left:3px solid transparent;background:var(--surface)!important;transition:background .18s,border-color .18s!important;flex-shrink:0!important;}
      #panel-fila-zap .chip-accordion-header:hover{background:var(--surface2)!important;}
      #panel-fila-zap .chip-accordion.open .chip-accordion-header{background:var(--surface2)!important;}
      #panel-fila-zap .chip-accordion-chevron{font-size:10px!important;color:var(--muted)!important;transition:transform .25s cubic-bezier(.4,0,.2,1)!important;flex-shrink:0!important;}
      #panel-fila-zap .chip-accordion.open .chip-accordion-chevron{transform:rotate(90deg)!important;color:var(--text2)!important;}
      #panel-fila-zap .chip-accordion-body{display:none!important;flex-direction:column!important;min-height:0!important;flex:1!important;overflow:hidden!important;}
      #panel-fila-zap .chip-accordion.open .chip-accordion-body{display:flex!important;}
      #panel-fila-zap .chip-fila-scroll{flex:1!important;overflow-y:auto!important;min-height:0!important;scroll-behavior:smooth!important;max-height:none!important;}
      #panel-fila-zap .chip-fila-scroll .fila-empty{font-family:'DM Mono',monospace!important;font-size:10px!important;color:var(--muted)!important;text-align:center!important;padding:32px!important;}
      @media(max-width:900px){#panel-fila-zap{flex-direction:column!important;height:auto!important}#panel-fila-zap .zapLeft,#panel-fila-zap .zapRight{width:100%!important;height:auto!important;min-height:auto!important}#panel-fila-zap .zapLeft{height:60vh!important}#panel-fila-zap .chip-accordion.open{max-height:60vh!important}}
    `;
    document.head.appendChild(style);
  }

  function restorePanelClass(){
    const panel=document.getElementById('panel-fila-zap');
    if(!panel) return;
    panel.classList.remove('v69-fila-v32','v70-fila-v31');
  }

  function init(){
    injectStyles();
    restorePanelClass();
    console.log('[v71][fila-whatsapp-visual-redirect-main] ativo',VERSION);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
