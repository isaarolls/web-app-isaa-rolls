/* MA.GI. RENT — funzioni comuni */
const AZ={nome:"MA.GI. SRLS",sede:"Via Giacinto Carini n°1, 90144 Palermo",ritiro:"Viale Campania, Palermo",piva:"07081250826",tel1:"338 163 0369",tel2:"327 440 4800",telWa:"393381630369",mail:"magirentsrl@gmail.com",pec:"magisrls-2022@pec.it",sito:"www.magirent.com"};
const LOGO="img/logo.jpg";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const pd=s=>{if(!s)return null;const[a,b,c]=s.split("-").map(Number);return new Date(a,b-1,c)};
const today=()=>iso(new Date());
const addD=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return iso(d)};
const diff=(a,b)=>Math.round((pd(b)-pd(a))/864e5);
const it=s=>s?s.split("-").reverse().join("/"):"";
const eur=n=>"€ "+Number(n||0).toLocaleString("it-IT",{minimumFractionDigits:0,maximumFractionDigits:2});
const eur2=n=>"€ "+Number(n||0).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2});
const kmf=n=>n||n===0?Number(n).toLocaleString("it-IT")+" km":"—";
const giorni=(a,b)=>Math.max(1,diff(a,b));
const ACTIVE=["richiesta","confermato","in corso"];
const MESI=["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3000)}

async function api(action,data,opts={}){
  const o={method:data?"POST":"GET",headers:{"X-MG":"1"},credentials:"same-origin"};
  if(data instanceof FormData)o.body=data;
  else if(data){o.body=JSON.stringify(data);o.headers["Content-Type"]="application/json"}
  let r;
  try{r=await fetch("api.php?a="+action,o)}catch(e){throw new Error("Connessione assente. Controlla internet e riprova.")}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok||j.error){const e=new Error(j.error||"Errore "+r.status);e.status=r.status;throw e}
  return j;
}

function silhouette(tipo){
  if(tipo==="Camper")return `<svg viewBox="0 0 250 125" aria-hidden="true"><path d="M12 98 L12 34 Q12 20 26 20 L150 20 L150 12 Q150 6 156 6 L196 6 Q206 6 208 16 L212 34 L222 64 Q236 68 236 82 L236 98 Z" fill="#ffffff" stroke="#141213" stroke-width="3"/><rect x="26" y="34" width="34" height="22" rx="4" fill="#dfe6ee" stroke="#141213" stroke-width="2"/><rect x="72" y="34" width="44" height="22" rx="4" fill="#dfe6ee" stroke="#141213" stroke-width="2"/><rect x="128" y="34" width="22" height="50" rx="3" fill="#ffffff" stroke="#141213" stroke-width="2"/><path d="M168 34 L206 34 L216 64 L168 64 Z" fill="#dfe6ee" stroke="#141213" stroke-width="2"/><path d="M12 70 L124 70" stroke="#c8302e" stroke-width="6"/><path d="M12 80 L124 80" stroke="#141213" stroke-width="2"/><rect x="12" y="90" width="224" height="9" rx="3" fill="#c8302e"/><circle cx="62" cy="102" r="15" fill="#141213"/><circle cx="62" cy="102" r="6" fill="#d9d4d5"/><circle cx="194" cy="102" r="15" fill="#141213"/><circle cx="194" cy="102" r="6" fill="#d9d4d5"/></svg>`;
  return tipo==="Auto"
  ?`<svg viewBox="0 0 240 110" aria-hidden="true"><path d="M20 78 L28 56 Q34 48 48 46 L78 30 Q90 24 110 24 L150 24 Q168 24 182 36 L198 48 Q220 52 224 64 L226 78 Z" fill="#ffffff" stroke="#141213" stroke-width="3"/><path d="M86 34 L108 30 L108 48 L68 48 Z M116 30 L148 30 Q160 31 170 42 L176 48 L116 48 Z" fill="#dfe6ee" stroke="#141213" stroke-width="2"/><rect x="18" y="72" width="210" height="8" rx="3" fill="#c8302e"/><circle cx="64" cy="82" r="15" fill="#141213"/><circle cx="64" cy="82" r="6" fill="#d9d4d5"/><circle cx="186" cy="82" r="15" fill="#141213"/><circle cx="186" cy="82" r="6" fill="#d9d4d5"/></svg>`
  :`<svg viewBox="0 0 240 120" aria-hidden="true"><path d="M14 92 L14 30 Q14 18 26 18 L168 18 Q182 18 190 30 L214 60 Q226 64 226 76 L226 92 Z" fill="#ffffff" stroke="#141213" stroke-width="3"/><path d="M170 26 L188 30 L206 60 L170 60 Z" fill="#dfe6ee" stroke="#141213" stroke-width="2"/><line x1="166" y1="22" x2="166" y2="90" stroke="#141213" stroke-width="2"/><rect x="14" y="84" width="212" height="9" rx="3" fill="#c8302e"/><text x="88" y="60" text-anchor="middle" font-family="Archivo,Arial" font-weight="900" font-size="22" fill="#c8302e">MA.GI.</text><circle cx="58" cy="96" r="15" fill="#141213"/><circle cx="58" cy="96" r="6" fill="#d9d4d5"/><circle cx="186" cy="96" r="15" fill="#141213"/><circle cx="186" cy="96" r="6" fill="#d9d4d5"/></svg>`;
}
const photo=v=>v.foto?`<img src="${esc(v.foto)}" alt="${esc(v.marca+" "+v.modello)}" loading="lazy">`:silhouette(v.tipo);
const plate=t=>t?`<span class="plate"><span>${esc((t||"").toUpperCase().replace(/^(\w{2})(\w{3})(\w{2})$/,"$1 $2 $3"))}</span></span>`:`<span class="note">senza targa</span>`;

const F=(id,label,val,type="text",extra="")=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val??"")}" ${extra}></div>`;
const SEL=(id,label,val,opts)=>`<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(o=>`<option ${o===val?"selected":""}>${o}</option>`).join("")}</select></div>`;
const gv=id=>{const e=document.getElementById(id);return e?e.value.trim():""};
const gn=id=>{const x=gv(id);return x===""?"":Number(x)};
function sheet(title,inner){ $("#modal-root").innerHTML=`<div class="modal" id="mbg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${title}</h2><button class="x" id="mx" aria-label="Chiudi">×</button></div>${inner}</div></div>`;
  $("#mx").onclick=closeSheet; $("#mbg").onclick=e=>{if(e.target.id==="mbg")closeSheet()}; document.body.style.overflow="hidden"}
function closeSheet(){$("#modal-root").innerHTML="";document.body.style.overflow=""}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#modal-root").innerHTML)closeSheet()});
