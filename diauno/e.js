/* Día Uno: contador anónimo. Solo envía el nombre del evento (p. ej. "copy_boletas"). Sin cookies, sin correo, sin datos de alumnos. */
(function(){
  var path=location.pathname, P=path.indexOf("/tools/boletas")===0?"boletas":path.indexOf("/tools/cte")===0?"cte":"home";
  function g(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function s(k){try{localStorage.setItem(k,"1")}catch(e){}}
  function ev(n){try{var u="/e/"+n;if(navigator.sendBeacon&&navigator.sendBeacon(u))return;fetch(u,{method:"POST",keepalive:true}).catch(function(){})}catch(e){}}
  function once(n){if(!g("du_"+n)){s("du_"+n);ev(n)}}
  if(g("du_staff"))return; /* our own browsers are excluded */
  if(/bot|crawl|spider|headless|preview|lighthouse/i.test(navigator.userAgent||""))return;
  ev("view_"+P); once("visitor");
  var src="";
  try{src=(new URLSearchParams(location.search).get("utm_source")||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,16)}catch(e){}
  var r=document.referrer||"";
  if(!src&&r&&r.indexOf(location.host)<0){src=/tiktok/.test(r)?"tiktok":/youtu/.test(r)?"youtube":/whatsapp|wa\.me/.test(r)?"whatsapp":/facebook|fb\.|instagram/.test(r)?"meta":/google|bing|duckduckgo/.test(r)?"search":"other"}
  if(src)ev("src_"+src);
  document.addEventListener("click",function(e){
    var t=e.target&&e.target.closest?e.target.closest("a,button"):null; if(!t)return;
    if(t.id==="waBtn"||/wa\.me\//.test(t.getAttribute("href")||"")){ev("wa_"+P);return}
    if(t.id==="copyPrompt"){ev("prompt_"+P);return}
    if(t.classList.contains("btn-copy")){var ac=document.getElementById("approvedCount"),ia=document.getElementById("includeAll");if(t.id==="copyAll"&&ac&&/: 0 de/.test(ac.textContent)&&!(ia&&ia.checked&&!/de 0$/.test(ac.textContent)))return;ev((t.id==="copyAll"?"copyall_":"copy_")+P);once("copyu_"+P);return}
    if(t.id==="proBtn"){ev("pro_"+P);once("prou");t.disabled=true;t.textContent="¡Anotado!";
      var m=document.getElementById("proMsg"); if(m)m.textContent="Gracias. Pro todavía no existe: estamos midiendo si a suficientes docentes les serviría. No guardamos ningún dato tuyo, solo sumamos +1 anónimo. Las herramientas gratis siguen gratis.";}
  },true);
})();
