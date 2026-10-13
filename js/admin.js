/* MA.GI. RENT — gestionale */
let KMC={inclusi:100,costo:0.2,suppl:0}, S={vehicles:[],bookings:[],clients:[],crediti:[]}, WA=[], NOTIFY="", tab="home", nFilter="attivi", cq="";
let gMonth=(()=>{const d=new Date();d.setDate(1);return d})();
const V=id=>S.vehicles.find(v=>v.id===id);
const C=id=>S.clients.find(c=>c.id===id);
function priceFor(v,c){if(!v)return 0;if(c&&c.prezzi&&c.prezzi[v.id]!==undefined&&c.prezzi[v.id]!=="")return Number(c.prezzi[v.id]);if(c&&c.sconto)return Math.round(v.prezzo*(1-c.sconto/100)*100)/100;return Number(v.prezzo)||0}
function shopRange(v){if(!v||!v.officina)return null;return[v.officinaDal||today(),v.officinaAl||addD(today(),730)]}
function inShop(v,d){const r=shopRange(v);return r&&r[0]<=d&&r[1]>=d}
function busyDays(vid,exceptId){const set=new Set();{const r=shopRange(V(vid));if(r)for(let d=r[0]<today()?today():r[0];d<=r[1]&&d<=addD(today(),400);d=addD(d,1))set.add(d)}S.bookings.forEach(b=>{if(b.vehicleId!==vid||b.id===exceptId||!ACTIVE.includes(b.stato))return;for(let d=b.dal;d<=b.al;d=addD(d,1))set.add(d)});return set}
function freeRange(vid,a,b,exceptId){const bs=busyDays(vid,exceptId);for(let d=a;d<=b;d=addD(d,1))if(bs.has(d))return false;return true}
function bookingOn(vid,d){return S.bookings.find(b=>b.vehicleId===vid&&b.stato!=="annullato"&&b.dal<=d&&b.al>=d)}

/* ---------- login ---------- */
async function boot(){
  let st;try{st=await api("admin_state")}catch(e){$("#admin").innerHTML=`<div class="loading">${esc(e.message)}</div>`;return}
  if(st.logged)return loadAll();
  const setup=!st.setup;
  $("#admin").innerHTML=`<div class="login"><form class="card" id="lf">
    <img class="logo" src="${LOGO}" alt="MA.GI.">
    <h1>${setup?"Attiva il gestionale":"Gestionale"}</h1>
    ${setup?`<div class="note">Primo accesso: inserisci il codice di attivazione e scegli la password che userai da telefono e PC.</div>${F("l-code","Codice di attivazione","","text",'required autocapitalize="characters" style="font-family:var(--f-mono)"')}`:""}
    ${F("l-pw",setup?"Nuova password (almeno 8 caratteri)":"Password","","password",`required autocomplete="${setup?"new-password":"current-password"}" ${setup?'minlength="8"':""}`)}
    ${setup?"":`<label class="remember"><input type="checkbox" id="l-rem" checked> Resta connesso su questo dispositivo</label>`}
    <div class="err" id="lerr"></div>
    <button class="btn" id="lbtn">${setup?"Crea password ed entra":"Entra"}</button>
  </form></div>`;
  $("#lf").onsubmit=async e=>{e.preventDefault();$("#lbtn").disabled=true;$("#lerr").textContent="";
    try{setup?await api("admin_setup",{code:gv("l-code"),password:$("#l-pw").value}):await api("admin_login",{password:$("#l-pw").value,remember:$("#l-rem").checked});loadAll()}
    catch(er){$("#lerr").textContent=er.message;$("#lbtn").disabled=false}};
}
async function loadAll(quiet){
  try{const j=await api("admin_all");S={vehicles:j.vehicles,bookings:j.bookings,clients:j.clients,crediti:j.crediti||[]};WA=j.wa||[];NOTIFY=j.notifyEmail;if(j.km)KMC=j.km;
    S.vehicles.sort((a,b)=>(a.tipo+a.modello).localeCompare(b.tipo+b.modello)*-1);
    if(!quiet||!$("#modal-root").innerHTML)renderAdmin()}
  catch(e){if(e.status===401)return boot();if(!quiet)toast(e.message)}
}
setInterval(()=>{if(document.visibilityState==="visible"&&$("#amain"))loadAll(true)},60000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&$("#amain"))loadAll(true)});

async function upsert(coll,obj,quiet){
  try{const j=await api("admin_save",{coll,obj});const arr=S[coll],i=arr.findIndex(x=>x.id===j.obj.id);if(i>=0)arr[i]=j.obj;else arr.push(j.obj);renderAdmin();return j.obj}
  catch(e){if(e.status===401){boot();return null}toast(e.message);return null}
}
async function remove(coll,id){
  try{await api("admin_delete",{coll,id});S[coll]=S[coll].filter(x=>x.id!==id);renderAdmin();return true}catch(e){toast(e.message);return false}
}

/* ---------- shell ---------- */
function scadenze(){
  const t=today(), out=[];
  S.vehicles.forEach(v=>{
    [["Tagliando",v.tagliandoData],["Revisione",v.revisione],["Assicurazione",v.assicurazione],["Bollo",v.bollo]].forEach(([k,d])=>{if(!d)return;const g=diff(t,d);if(g<=30)out.push({v,k,g,txt:g<0?`scaduto da ${-g} gg`:g===0?"scade oggi":`tra ${g} gg · ${it(d)}`})});
    if(v.tagliandoKm&&v.km&&v.km>=v.tagliandoKm-1000)out.push({v,k:"Tagliando (km)",g:v.km>=v.tagliandoKm?-1:5,txt:`a ${kmf(v.tagliandoKm)} · ora ${kmf(v.km)}`});
    if(v.gommeKm!==""&&v.gommeKm!=null&&v.km&&v.km-v.gommeKm>=40000)out.push({v,k:"Gomme",g:3,txt:`${kmf(v.km-v.gommeKm)} dal cambio`});
  });
  return out.sort((a,b)=>a.g-b.g);
}
const stPill=s=>`<span class="pill ${{richiesta:"warn","confermato":"red","in corso":"ok",concluso:"grey",annullato:"grey"}[s]||"grey"}">${s==="richiesta"?"da confermare":s}</span>`;
const dPill=g=>`<span class="pill ${g<0?"bad":g<=10?"warn":"ok"}">`;
const vName=v=>v?`${esc(v.marca)} ${esc(v.modello)}`:"Mezzo eliminato";

function renderAdmin(){
  const req=S.bookings.filter(b=>b.stato==="richiesta").length;
  document.title=(req?`(${req}) `:"")+"Gestionale MA.GI. Rent";
  $("#admin").innerHTML=`
  <div class="a-head"><div class="wrap"><img class="logo" src="${LOGO}" alt="MA.GI."><h1>Gestionale</h1><div class="right"><a class="btn sm ghost" href="./" target="_blank" rel="noopener">Vedi sito</a></div></div></div>
  <div class="tabs" role="tablist"><div class="wrap">
    ${[["home","Oggi"],["cal","Calendario"],["nol","Noleggi"],["mezzi","Parco mezzi"],["cli","Clienti"],["inc","Incassi"],["imp","Impostazioni"]].map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" data-tab="${k}">${l}${k==="nol"&&req?`<span class="badge">${req}</span>`:""}</button>`).join("")}
  </div></div>
  <div class="wrap a-main ${tab==="cal"?"wide":""}" id="amain"></div>`;
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderAdmin()});
  ({home:aHome,cal:aCal,nol:aNol,mezzi:aMezzi,cli:aCli,inc:aInc,imp:aImp})[tab]();
}
function bindOb(){document.querySelectorAll("[data-ob]").forEach(b=>b.onclick=e=>{e.stopPropagation();openBookingAdmin(S.bookings.find(x=>x.id===b.dataset.ob))})}

function aHome(){
  const t=today(), occ=S.vehicles.filter(v=>{const b=bookingOn(v.id,t);return(b&&ACTIVE.includes(b.stato))||inShop(v,t)}), shop=S.vehicles.filter(v=>inShop(v,t));
  const usc=S.bookings.filter(b=>b.dal===t&&ACTIVE.includes(b.stato)), rie=S.bookings.filter(b=>b.al===t&&ACTIVE.includes(b.stato));
  const req=S.bookings.filter(b=>b.stato==="richiesta").sort((a,b)=>a.dal<b.dal?-1:1), sc=scadenze();
  const row=b=>{const v=V(b.vehicleId);return`<div class="li"><div class="grow"><div class="t">${esc(b.cognomeNome||"—")}</div><div class="s">${vName(v)} · ${it(b.dal)} → ${it(b.al)} · ${esc(b.cell||"")}</div></div>${plate(v&&v.targa)}<button class="btn sm ghost" data-ob="${b.id}">Apri</button></div>`};
  $("#amain").innerHTML=`
  <div class="kpis">
    <div class="kpi"><b>${S.vehicles.length-occ.length}<small style="font-size:16px;color:var(--muted)">/${S.vehicles.length}</small></b><span>Mezzi liberi oggi${shop.length?` · ${shop.length} dal meccanico`:""}</span></div>
    <div class="kpi"><b>${usc.length}</b><span>Consegne oggi</span></div>
    <div class="kpi"><b>${rie.length}</b><span>Rientri oggi</span></div>
    <div class="kpi ${req.length?"hot":""}"><b>${req.length}</b><span>Richieste dal sito</span></div>
  </div>
  ${(()=>{const L=debts(),tot=L.reduce((a,x)=>a+x.res,0),late=L.filter(x=>x.late>0);return tot>0?`<button type="button" class="summary pay-banner" id="go-inc"><span><b style="font-size:18px">${eur(tot)}</b> da incassare${late.length?` · <span class="pill bad">${late.length} in ritardo · ${eur(late.reduce((a,x)=>a+x.res,0))}</span>`:""}</span><span class="btn sm">Vai a Incassi</span></button>`:""})()}
  <div class="cols">
    <div class="panel"><h2>Richieste da confermare</h2><div class="list">${req.length?req.map(row).join(""):`<div class="note">Nessuna richiesta in attesa.</div>`}</div></div>
    <div class="panel"><h2>Scadenze entro 30 giorni</h2><div class="list">${sc.length?sc.map(s=>`<div class="li"><div class="grow"><div class="t">${s.k}</div><div class="s">${vName(s.v)}</div></div>${plate(s.v.targa)}${dPill(s.g)}${s.txt}</span></div>`).join(""):`<div class="note">Nessuna scadenza vicina${S.vehicles.some(v=>!v.revisione||!v.assicurazione)?" (alcuni mezzi non hanno ancora le date: completale in Parco mezzi)":""}.</div>`}</div></div>
    <div class="panel"><h2>Consegne di oggi</h2><div class="list">${usc.length?usc.map(row).join(""):`<div class="note">Nessuna consegna oggi.</div>`}</div></div>
    <div class="panel"><h2>Rientri di oggi</h2><div class="list">${rie.length?rie.map(row).join(""):`<div class="note">Nessun rientro oggi.</div>`}</div></div>
  </div>`;
  if($("#go-inc"))$("#go-inc").onclick=()=>{tab="inc";renderAdmin()};
  bindOb();
}

function aCal(){
  const y=gMonth.getFullYear(),mo=gMonth.getMonth(),n=new Date(y,mo+1,0).getDate(),t=today();
  const days=[...Array(n)].map((_,i)=>iso(new Date(y,mo,i+1))), first=days[0], last=days[n-1];
  const dn=["dom","lun","mar","mer","gio","ven","sab"];
  const col=d=>diff(first,d)+1;
  const short=v=>{const m=String(v.modello||"").replace(/\bpasso\s+/i,"").trim();return m||v.marca||"Mezzo"};
  const years=[];for(let k=new Date().getFullYear()-1;k<=new Date().getFullYear()+2;k++)years.push(k);
  const bars=v=>{
    const out=[];
    S.bookings.filter(b=>b.vehicleId===v.id&&b.stato!=="annullato"&&b.dal<=last&&b.al>=first).forEach(b=>{
      const a=b.dal<first?first:b.dal,z=b.al>last?last:b.al;
      const cls="st-"+b.stato.replace(" ","");
      out.push(`<button type="button" class="c2-bar ${cls}${b.dal<first?" cut-l":""}${b.al>last?" cut-r":""}" data-ob="${b.id}" style="grid-column:${col(a)}/${col(z)+1}" title="${esc(b.cognomeNome||"")} · ${it(b.dal)} → ${it(b.al)} · ${b.stato}"><span>${esc(b.cognomeNome||"Senza nome")}</span></button>`)});
    const r=shopRange(v);
    if(r&&r[0]<=last&&r[1]>=first){const a=r[0]<first?first:r[0],z=r[1]>last?last:r[1];
      out.push(`<button type="button" class="c2-bar st-officina${r[0]<first?" cut-l":""}${r[1]>last?" cut-r":""}" data-ov="${v.id}" style="grid-column:${col(a)}/${col(z)+1}" title="Dal meccanico"><span>Dal meccanico${v.officinaNote?" · "+esc(v.officinaNote):""}</span></button>`)}
    return out.join("");
  };
  $("#amain").innerHTML=`<div class="cal2">
    <div class="c2-top">
      <h2>Prenotazioni</h2>
      <div class="c2-pick">
        <button type="button" class="c2-nav" id="gp" aria-label="Mese precedente">‹</button>
        <select id="g-m" aria-label="Mese">${MESI.map((m,i)=>`<option value="${i}" ${i===mo?"selected":""}>${m}</option>`).join("")}</select>
        <select id="g-y" aria-label="Anno">${years.map(k=>`<option ${k===y?"selected":""}>${k}</option>`).join("")}</select>
        <button type="button" class="c2-nav" id="gn" aria-label="Mese successivo">›</button>
        <button type="button" class="btn sm ghost" id="gt">Oggi</button>
      </div>
    </div>
    ${S.vehicles.length?`<div class="c2-scroll" id="c2s"><div class="c2-grid" style="--n:${n}">
      <div class="c2-corner"></div>
      <div class="c2-days">${days.map(d=>{const w=pd(d).getDay();return`<div class="c2-day${d===t?" today":""}${w===0||w===6?" we":""}"><span>${dn[w]}</span><b>${pd(d).getDate()}</b></div>`}).join("")}</div>
      ${S.vehicles.map(v=>`<div class="c2-veh" data-ov="${v.id}"><b>${esc(short(v))}</b><small>${esc(v.targa||"senza targa")}</small></div>
        <div class="c2-track">${days.map(d=>`<div class="c2-cell${d===t?" today":""}${[0,6].includes(pd(d).getDay())?" we":""}" data-new="${v.id}|${d}" style="grid-column:${col(d)}"></div>`).join("")}${bars(v)}</div>`).join("")}
    </div></div>
    <div class="legend c2-legend"><span><i class="st-richiesta"></i>Da confermare</span><span><i class="st-confermato"></i>Confermato</span><span><i class="st-incorso"></i>In corso</span><span><i class="st-concluso"></i>Concluso</span><span><i class="st-officina"></i>Dal meccanico</span></div>`
    :`<div class="empty-state">Aggiungi i mezzi in «Parco mezzi» per vedere il calendario.</div>`}
  </div>
  <button type="button" class="fab" id="gnew" aria-label="Nuovo noleggio">+</button>`;
  const go=d=>{gMonth=d;gMonth.setDate(1);aCal()};
  $("#gp").onclick=()=>go(new Date(y,mo-1,1));$("#gn").onclick=()=>go(new Date(y,mo+1,1));$("#gt").onclick=()=>go(new Date());
  $("#g-m").onchange=()=>go(new Date(Number(gv("g-y")),Number(gv("g-m")),1));$("#g-y").onchange=$("#g-m").onchange;
  $("#gnew").onclick=()=>openBookingAdmin(null);
  {const sc=$("#c2s"),td=$(".c2-day.today"),cn=$(".c2-corner");if(sc&&td&&cn)sc.scrollLeft=Math.max(0,td.offsetLeft-cn.offsetWidth-8)}
  document.querySelectorAll(".c2-veh[data-ov],.c2-bar[data-ov]").forEach(c=>c.onclick=()=>openVehicle(V(c.dataset.ov)));
  document.querySelectorAll(".c2-cell[data-new]").forEach(c=>c.onclick=()=>{const[v,d]=c.dataset.new.split("|");openBookingAdmin(null,{vehicleId:v,dal:d,al:addD(d,1)})});
  bindOb();
}

function aNol(){
  let L=S.bookings.slice().sort((a,b)=>a.dal<b.dal?1:-1);
  if(nFilter==="attivi")L=L.filter(b=>ACTIVE.includes(b.stato));
  else if(nFilter==="richiesta")L=L.filter(b=>b.stato==="richiesta");
  else if(nFilter==="chiusi")L=L.filter(b=>!ACTIVE.includes(b.stato));
  $("#amain").innerHTML=`<div class="panel"><h2>Noleggi <button class="btn sm" id="nnew">+ Nuovo noleggio</button></h2>
   <div class="chips" style="margin-bottom:10px">${[["attivi","Attivi"],["richiesta","Da confermare"],["chiusi","Conclusi/annullati"],["tutti","Tutti"]].map(([k,l])=>`<button class="chip" data-nf="${k}" aria-pressed="${nFilter===k}">${l}</button>`).join("")}</div>
   ${L.length?`<div class="scroll"><table class="vtable"><thead><tr><th>Cliente</th><th>Mezzo</th><th>Dal</th><th>Al</th><th>Gg</th><th>Importo</th><th>Stato</th><th></th></tr></thead><tbody>${L.map(b=>{const v=V(b.vehicleId);return`<tr class="click" data-ob="${b.id}"><td><b>${esc(b.cognomeNome||"—")}</b><div class="note">${esc(b.cell||"")}${b.origine==="sito"?" · dal sito":""}${b.docs?" · documenti ✓":""}</div></td><td>${plate(v&&v.targa)}<div class="note">${vName(v)}</div></td><td>${it(b.dal)} ${esc(b.oraInizio||"")}</td><td>${it(b.al)}</td><td>${giorni(b.dal,b.al)}</td><td>${b.prezzo?eur(b.prezzo):"—"}</td><td>${stPill(b.stato)}</td><td><button class="btn sm ghost" data-ct="${b.id}">Contratto</button></td></tr>`}).join("")}</tbody></table></div>`:`<div class="empty-state">Nessun noleggio in questo elenco.</div>`}</div>`;
  $("#nnew").onclick=()=>openBookingAdmin(null);
  document.querySelectorAll("[data-nf]").forEach(b=>b.onclick=()=>{nFilter=b.dataset.nf;aNol()});
  document.querySelectorAll("[data-ct]").forEach(b=>b.onclick=e=>{e.stopPropagation();openContract(S.bookings.find(x=>x.id===b.dataset.ct))});
  bindOb();
}

function aMezzi(){
  const t=today();
  const dc=d=>{if(!d)return`<span class="note">—</span>`;const g=diff(t,d);return`${dPill(g)}${it(d)}</span>`};
  $("#amain").innerHTML=`<div class="panel"><h2>Parco mezzi (${S.vehicles.length}) <button class="btn sm" id="vnew">+ Aggiungi mezzo</button></h2>
  ${S.vehicles.length?`<div class="scroll"><table class="vtable"><thead><tr><th>Mezzo</th><th>Targa</th><th>Prezzo</th><th>Km</th><th>Gomme</th><th>Tagliando</th><th>Revisione</th><th>Assicurazione</th><th>Bollo</th><th>Oggi</th><th>Non visibile<br>sul sito</th></tr></thead><tbody>
  ${S.vehicles.map(v=>{const b=bookingOn(v.id,t);return`<tr class="click" data-ov="${v.id}"><td><b>${vName(v)}</b><div class="note">${esc(v.tipo)}${v.sito===false?" · nascosto dal sito":""}</div></td><td>${plate(v.targa)}</td><td>${v.prezzo?eur(v.prezzo)+"/g":'<span class="pill warn">da inserire</span>'}</td><td>${kmf(v.km)}</td><td>${v.gommeData?it(v.gommeData):"—"}<div class="note">${v.gommeKm!==""&&v.gommeKm!=null?kmf(v.gommeKm):""}</div></td><td>${dc(v.tagliandoData)}<div class="note">${v.tagliandoKm?"o a "+kmf(v.tagliandoKm):""}</div></td><td>${dc(v.revisione)}</td><td>${dc(v.assicurazione)}</td><td>${dc(v.bollo)}</td><td>${inShop(v,t)?'<span class="pill bad">dal meccanico</span>':b&&ACTIVE.includes(b.stato)?stPill(b.stato):'<span class="pill ok">libero</span>'}</td><td class="hide-cell"><label style="display:flex;justify-content:center;padding:6px"><input type="checkbox" data-hide="${v.id}" ${v.sito===false?"checked":""} aria-label="Non visibile sul sito" style="width:22px;height:22px;cursor:pointer"></label></td></tr>`}).join("")}
  </tbody></table></div>`:`<div class="empty-state">Nessun mezzo ancora. Aggiungi il primo con «+ Aggiungi mezzo».</div>`}</div>`;
  $("#vnew").onclick=()=>openVehicle(null);
  document.querySelectorAll("[data-ov]").forEach(r=>r.onclick=()=>openVehicle(V(r.dataset.ov)));
  document.querySelectorAll(".hide-cell").forEach(c=>c.onclick=e=>e.stopPropagation());
  document.querySelectorAll("[data-hide]").forEach(x=>x.onchange=async()=>{const v=V(x.dataset.hide);const o=await upsert("vehicles",{...v,sito:!x.checked});toast(o?(x.checked?"Nascosto dal sito":"Di nuovo visibile sul sito"):"Non salvato")});
}

function openVehicle(v){
  const n=!v; v=v||{tipo:"Furgone",cambio:"Manuale",alimentazione:"Diesel",patente:"B",posti:3,sito:true};
  let foto=v.foto||"";
  sheet(n?"Nuovo mezzo":vName(v),`<form class="form" id="vf">
   <fieldset><legend>Mezzo</legend>
    <div class="grid3">${SEL("v-tipo","Tipo",v.tipo,["Furgone","Camper","Auto","Minibus"])}${F("v-marca","Marca",v.marca,"text","required")}${F("v-modello","Modello",v.modello,"text","required")}
    ${F("v-targa","Targa",v.targa,"text",'style="text-transform:uppercase;font-family:var(--f-mono)"')}${F("v-colore","Colore",v.colore)}${SEL("v-alim","Alimentazione",v.alimentazione,["Diesel","Benzina","Benzina/GPL","Ibrida","Elettrica","Benzina/Metano"])}
    ${SEL("v-cambio","Cambio",v.cambio,["Manuale","Automatico"])}${F("v-posti","Posti",v.posti,"number","min=1")}${F("v-carico","Vano di carico",v.carico,"text",'placeholder="es. 13 m³"')}
    ${F("v-prezzo","Prezzo al giorno (€)",v.prezzo,"number",'min=0 step="0.5"')}${F("v-km","Km attuali",v.km,"number","min=0")}${SEL("v-pat","Patente",v.patente||"B",["B","C1","C"])}${F("v-suppl","Supplemento km illimitati (€/giorno)",v.supplIllimitati,"number",`min=0 step="0.5" placeholder="${KMC.suppl} (valore generale)"`)}</div>
    <label class="note" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="v-hide" ${v.sito===false?"checked":""} style="width:22px;height:22px"> <b>Non visibile sul sito</b> (i clienti non lo vedono e non possono prenotarlo)</label>
    <div class="photo-row"><img id="v-img" src="${esc(foto)}" alt="" ${foto?"":"hidden"}><label class="btn sm ghost" for="v-foto">${foto?"Cambia foto":"Carica foto"}</label><input type="file" id="v-foto" accept="image/*" hidden><span class="note" id="v-fst"></span></div>
   </fieldset>
   <fieldset><legend>Dal meccanico</legend>
    <label style="display:flex;gap:10px;align-items:center;font-weight:800"><input type="checkbox" id="v-off" ${v.officina?"checked":""} style="width:22px;height:22px"> Il mezzo è dal meccanico / in officina</label>
    <div class="note">Finché è spuntato, il mezzo risulta non disponibile sul sito e nel calendario per i giorni indicati.</div>
    <div class="grid2" id="v-offd" ${v.officina?"":"hidden"}>${F("v-offa","Dal",v.officinaDal||today(),"date")}${F("v-offb","Rientro previsto (vuoto = finché non lo togli)",v.officinaAl,"date")}</div>
    <div class="field" id="v-offn" ${v.officina?"":"hidden"}><label for="v-offnote">Lavoro da fare</label><input id="v-offnote" value="${esc(v.officinaNote||"")}" placeholder="es. frizione, tagliando, carrozzeria"></div>
   </fieldset>
   <fieldset><legend>Manutenzione e scadenze</legend>
    <div class="grid2">${F("v-gd","Gomme cambiate il",v.gommeData,"date")}${F("v-gk","Gomme cambiate a (km)",v.gommeKm,"number")}
    ${F("v-td","Prossimo tagliando (data)",v.tagliandoData,"date")}${F("v-tk","Prossimo tagliando (km)",v.tagliandoKm,"number")}
    ${F("v-rev","Scadenza revisione",v.revisione,"date")}${F("v-ass","Scadenza assicurazione",v.assicurazione,"date")}
    ${F("v-bollo","Scadenza bollo",v.bollo,"date")}</div>
    <div class="field"><label for="v-note">Note e descrizione</label><textarea id="v-note" rows="3">${esc(v.note||"")}</textarea></div>
   </fieldset>
   <div id="vconf"></div>
   <div class="actions">${n?"":`<button type="button" class="btn ghost left" id="vdel">Elimina mezzo</button>`}<button type="button" class="btn ghost" id="vcan">Annulla</button><button class="btn" type="submit" id="vsave">Salva mezzo</button></div>
  </form>`);
  $("#v-foto").onchange=async e=>{const f=e.target.files[0];if(!f)return;$("#v-fst").textContent="Caricamento…";$("#vsave").disabled=true;
    try{const fd=new FormData();fd.append("foto",f);const r=await api("admin_photo",fd);foto=r.url;$("#v-img").src=foto;$("#v-img").hidden=false;$("#v-fst").textContent="Foto caricata: ricordati di salvare"}
    catch(er){$("#v-fst").textContent=er.message}$("#vsave").disabled=false};
  $("#v-off").onchange=e=>{$("#v-offd").hidden=$("#v-offn").hidden=!e.target.checked};
  $("#vcan").onclick=closeSheet;
  if($("#vdel"))$("#vdel").onclick=()=>{$("#vconf").innerHTML=`<div class="confirm">Eliminare ${vName(v)}? <button type="button" class="btn sm" id="vdy">Sì, elimina</button><button type="button" class="btn sm ghost" id="vdn">No</button></div>`;$("#vdn").onclick=()=>$("#vconf").innerHTML="";$("#vdy").onclick=async()=>{if(await remove("vehicles",v.id)){closeSheet();toast("Mezzo eliminato")}}};
  $("#vf").onsubmit=async e=>{e.preventDefault();
    if($("#v-off").checked&&v.id){const a=gv("v-offa")||today(),z=gv("v-offb")||"9999-12-31";const clash=S.bookings.filter(b=>b.vehicleId===v.id&&ACTIVE.includes(b.stato)&&b.dal<=z&&b.al>=a);
      if(clash.length&&!confirm(`Attenzione: ${clash.length} noleggio/i già prenotati in quel periodo (${clash.map(b=>b.cognomeNome+" "+it(b.dal)).join(", ")}). Salvo lo stesso?`))return}
    $("#vsave").disabled=true;
    const o=await upsert("vehicles",{...v,tipo:gv("v-tipo"),marca:gv("v-marca"),modello:gv("v-modello"),targa:gv("v-targa").toUpperCase().replace(/\s/g,""),colore:gv("v-colore"),alimentazione:gv("v-alim"),cambio:gv("v-cambio"),posti:gn("v-posti"),carico:gv("v-carico"),prezzo:gn("v-prezzo"),supplIllimitati:gn("v-suppl"),km:gn("v-km"),patente:gv("v-pat"),sito:!$("#v-hide").checked,foto,officina:$("#v-off").checked,officinaDal:$("#v-off").checked?(gv("v-offa")||today()):"",officinaAl:$("#v-off").checked?gv("v-offb"):"",officinaNote:$("#v-off").checked?gv("v-offnote"):"",
      gommeData:gv("v-gd"),gommeKm:gn("v-gk"),tagliandoData:gv("v-td"),tagliandoKm:gn("v-tk"),revisione:gv("v-rev"),assicurazione:gv("v-ass"),bollo:gv("v-bollo"),note:gv("v-note")});
    if(o){closeSheet();toast("Mezzo salvato")}else $("#vsave").disabled=false};
}

/* ---------- bookings ---------- */
const CLI=[["cognome","Cognome"],["nome","Nome"],["sesso","Sesso","sesso"],["dataNascita","Data di nascita","date"],["luogoNascita","Luogo di nascita (comune o stato estero)"],["cf","Codice fiscale"],["indirizzo","Indirizzo"],["citta","Città"],["cap","CAP"],["prov","Provincia"],["cell","Cellulare"],["email","Email"],["nPatente","N. patente"],["enteRilascio","Ente rilascio"],["dataRilascio","Data rilascio","date"],["dataScad","Scadenza patente","date"]];
/* old records only have "cognomeNome": split it (first word = surname) */
function splitName(o){if(o&&!o.cognome&&!o.nome&&o.cognomeNome){const p=String(o.cognomeNome).trim().split(/\s+/);o.cognome=p.shift()||"";o.nome=p.join(" ")}return o}
const joinName=o=>[o.cognome,o.nome].map(x=>String(x||"").trim()).filter(Boolean).join(" ");
function cliFields(o,req){return CLI.map(([k,l,t])=>t==="sesso"?SEL("c-sesso","Sesso",o.sesso||"",["","M","F"]):F("c-"+k,l,o[k],t||"text",(req||[]).includes(k)?"required":k==="cf"?'style="text-transform:uppercase;font-family:var(--f-mono)" maxlength="16"':"")).join("")}
const FUEL=["","Riserva","1/4","1/2","3/4","Pieno"];
const isImg=x=>String(x.tipo||"").startsWith("image/")&&!/hei[cf]/.test(x.tipo);
function docThumbs(d,k){
  const L=(d&&d[k])||[];
  return L.length?L.map(x=>{const u="doc.php?f="+encodeURIComponent(x.f);
    return `<span style="position:relative;display:inline-block"><a href="${u}" target="_blank" rel="noopener">${isImg(x)?`<img src="${u}" alt="${esc(x.nome)}" style="width:130px;aspect-ratio:3/2;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block">`:`<span class="btn sm ghost">${esc(x.nome||"PDF")}</span>`}</a><button type="button" class="x" data-deldoc="${k}|${esc(x.f)}" aria-label="Elimina foto" style="position:absolute;top:-8px;right:-8px;width:26px;height:26px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.25)">×</button></span>`}).join(""):'<span class="pill bad">mancante</span>';
}
function docsBox(d,pfx,inherited){
  return `<fieldset><legend>Documenti del conducente</legend>
    <div class="note">Foto di fronte e retro. Vengono stampate insieme al contratto.${inherited?" Se qui non c'è nulla, si usano quelli salvati nella scheda cliente.":""}</div>
    ${[["ci","Carta d'identità"],["pat","Patente"]].map(([k,l])=>`<div style="display:grid;gap:8px"><div class="note" style="font-weight:700">${l}</div><div class="photo-row" id="${pfx}-${k}">${docThumbs(d,k)}</div><div><label class="btn sm ghost" for="${pfx}-f-${k}">+ Aggiungi foto ${k==="ci"?"documento":"patente"}</label><input type="file" id="${pfx}-f-${k}" accept="image/*,application/pdf" multiple hidden></div></div>`).join("")}
    <span class="note" id="${pfx}-st"></span></fieldset>`;
}
function bindDocs(pfx,coll,rec,ensureSaved){
  const st=m=>{const e=$(`#${pfx}-st`);if(e)e.textContent=m};
  const sync=docs=>{rec.docs=docs;const arr=S[coll],o=arr.find(x=>x.id===rec.id);if(o)o.docs=docs;
    if(coll==="bookings"&&rec.clienteId){const c=C(rec.clienteId);if(c)["ci","pat"].forEach(k=>{if(!(c.docs&&c.docs[k]&&c.docs[k].length)){c.docs=c.docs||{ci:[],pat:[]};c.docs[k]=docs[k]}})}
    ["ci","pat"].forEach(k=>{const e=$(`#${pfx}-${k}`);if(e)e.innerHTML=docThumbs(docs,k)});bindDel()};
  const bindDel=()=>document.querySelectorAll(`#${pfx}-ci [data-deldoc],#${pfx}-pat [data-deldoc]`).forEach(btn=>btn.onclick=async()=>{
    if(!confirm("Eliminare questa foto?"))return;const[k,f]=btn.dataset.deldoc.split("|");
    try{const r=await api("admin_doc_delete",{coll,id:rec.id,kind:k,f});sync(r.docs);st("Foto eliminata")}catch(e){st(e.message)}});
  ["ci","pat"].forEach(k=>{const inp=$(`#${pfx}-f-${k}`);inp.onchange=async e=>{const fs=[...e.target.files];if(!fs.length)return;
    const big=fs.find(f=>f.size>12*1024*1024);if(big){st(`"${big.name}" è troppo grande (max 12 MB)`);return}
    st("Caricamento…");
    try{const id=await ensureSaved();if(!id){st("Salva prima i dati");return}
      const fd=new FormData();fd.append("coll",coll);fd.append("id",id);fd.append("kind",k);fs.forEach(f=>fd.append("files[]",f));
      const r=await api("admin_docs",fd);sync(r.docs);st("Foto caricate ✓")}catch(er){st(er.message)}
    inp.value=""}});
  bindDel();
}
function docsFor(b){const c=C(b.clienteId),out={ci:[],pat:[]};["ci","pat"].forEach(k=>{out[k]=(b.docs&&b.docs[k]&&b.docs[k].length)?b.docs[k]:((c&&c.docs&&c.docs[k])||[])});return out}
function openBookingAdmin(b,pre){
  const n=!b; b=b||{stato:"confermato",origine:"ufficio",oraInizio:"09:00",dal:today(),al:addD(today(),1),...(pre||{})};
  if(!b.vehicleId&&S.vehicles[0])b.vehicleId=S.vehicles[0].id;
  splitName(b);{const c=C(b.clienteId);if(c){splitName(c);CLI.forEach(([k])=>{if(!b[k]&&c[k])b[k]=c[k]})}}
  const supplOf=v=>v&&v.supplIllimitati!==""&&v.supplIllimitati!=null?Number(v.supplIllimitati):KMC.suppl;
  const dayPrice=(v,c)=>{const p=priceFor(v,c);return p?p+(gv("b-kmf")==="illimitati"?supplOf(v):0):0};
  const autoPrice=()=>{const v=V(gv("b-v")),c=C(gv("b-cli"));return v?giorni(gv("b-dal"),gv("b-al"))*dayPrice(v,c):0};
  if(!b.kmFormula)b.kmFormula="inclusi";
  sheet(n?"Nuovo noleggio":"Noleggio · "+esc(b.cognomeNome||""),`<form class="form" id="bf">
   ${b.origine==="sito"&&!n?`<div class="summary"><span>Richiesta arrivata dal sito il ${b.creato?it(b.creato.slice(0,10)):""} · ${esc(b.cell||"")} ${b.email?"· "+esc(b.email):""}</span><a class="btn sm dark" href="https://wa.me/${esc((d=>d.length<=10?"39"+d:d)(String(b.cell||"").replace(/\D/g,"")))}" target="_blank" rel="noopener">WhatsApp cliente</a></div>`:""}
   <fieldset><legend>Cliente</legend>
    <div class="field"><label for="b-cq">Cliente registrato</label>
      <div class="cli-pick"><input id="b-cq" placeholder="Cerca per nome, cognome o cellulare…" autocomplete="off"><input type="hidden" id="b-cli" value="${esc(b.clienteId||"")}"><div class="cli-res" id="b-cres" hidden></div></div></div>
    <div id="b-csel"></div>
    <div class="actions" style="justify-content:flex-start"><button type="button" class="btn sm ghost" id="b-cnew">+ Registra nuovo cliente</button></div>
    <div id="b-cform"></div>
   </fieldset>
   <fieldset><legend>Mezzo e date</legend>
    <div class="field"><label for="b-v">Mezzo</label><select id="b-v">${S.vehicles.map(v=>`<option value="${v.id}" ${v.id===b.vehicleId?"selected":""}>${vName(v)}${v.targa?" · "+esc(v.targa):""}</option>`).join("")}</select></div>
    <div class="grid3">${F("b-dal","Data inizio",b.dal,"date","required")}${F("b-ora","Ora inizio",b.oraInizio,"time")}${F("b-al","Data fine",b.al,"date","required")}
    ${SEL("b-st","Stato",b.stato,["richiesta","confermato","in corso","concluso","annullato"])}${F("b-prezzo","Importo noleggio (€)",b.prezzo,"number",'step="0.01"')}${F("b-dep","Cauzione (€)",b.cauzione,"number")}</div>
    <div class="field"><label for="b-kmf">Chilometri</label><select id="b-kmf"><option value="inclusi" ${b.kmFormula!=="illimitati"?"selected":""}>${b.kmInclusiGiorno||KMC.inclusi} km al giorno inclusi · extra ${eur2(b.costoKm??KMC.costo)}/km</option><option value="illimitati" ${b.kmFormula==="illimitati"?"selected":""}>Km illimitati</option></select></div>
    <div id="b-av" class="note"></div>
   </fieldset>
   <fieldset><legend>Dati conducente</legend>
    <div class="grid2">${cliFields(b,["cognome"])}</div>
   </fieldset>
   ${docsBox(b.docs,"bd",true)}
   <fieldset><legend>Pagamento</legend><div id="b-pay"></div></fieldset>
   <fieldset><legend>Consegna</legend><div class="grid2">${SEL("b-fuel","Carburante alla consegna",b.carburante||"",FUEL)}${F("b-kmp","Km partenza",b.kmPartenza??(V(b.vehicleId)||{}).km,"number")}</div></fieldset>
   <fieldset><legend>Rientro</legend><div class="grid2">${F("b-df","Data rientro",b.dataFine,"date")}${F("b-of","Ora rientro",b.oraFine,"time")}${SEL("b-fuelr","Carburante al rientro",b.carburanteRientro||"",FUEL)}${F("b-kmr","Km rientro",b.kmRientro,"number")}</div>
    <div id="b-kmcalc"></div>
    <div class="grid2">${F("b-xkm","Extra km da far pagare (€)",b.extraKm,"number",'step="0.01" min="0"')}<div class="field"><label>&nbsp;</label><span class="note" id="b-xkm-n">Si calcola da solo con i km di rientro. Puoi correggerlo a mano.</span></div></div>
    <div class="field"><label for="b-note">Note / danni riscontrati</label><textarea id="b-note" rows="2">${esc(b.note||"")}</textarea></div></fieldset>
   <div id="bconf"></div>
   <div class="actions">${n?"":`<button type="button" class="btn ghost left" id="bdel">Elimina</button>`}
     ${!b.clienteId?`<button type="button" class="btn ghost" id="bsc">Salva come cliente</button>`:""}
     ${b.stato==="richiesta"?`<button type="button" class="btn dark" id="bok">Conferma richiesta</button>`:""}
     <button type="button" class="btn ghost" id="bct">Contratto</button><button class="btn" type="submit">Salva</button></div>
  </form>`);
  const check=()=>{const v=V(gv("b-v")),a=gv("b-dal"),z=gv("b-al"),c=C(gv("b-cli"));if(!v||!a||!z)return;
    const ok=freeRange(v.id,a,z,b.id), g=giorni(a,z), p=dayPrice(v,c);
    $("#b-av").innerHTML=ok?`<span class="pill ok">Libero</span> ${g} giorn${g>1?"i":"o"}${p?` × ${eur(p)}${c&&p!==Number(v.prezzo)?` <span class="pill red">tariffa ${esc(c.cognomeNome)}</span>`:""} = <b>${eur(g*p)}</b> <button type="button" class="btn sm ghost" id="b-ap">Usa questo importo</button>`:" · prezzo del mezzo non inserito"}`:`<span class="pill bad">Mezzo già occupato in queste date</span>`;
    if($("#b-ap"))$("#b-ap").onclick=()=>{$("#b-prezzo").value=autoPrice()};
    return ok};
  ["b-v","b-dal","b-al"].forEach(i=>document.getElementById(i).addEventListener("input",check));
  ["b-v","b-dal","b-al","b-kmf"].forEach(i=>document.getElementById(i).addEventListener("change",()=>{const p=autoPrice();if(p)$("#b-prezzo").value=p;check();kmCalc()}));
  const showSel=()=>{const c=C(gv("b-cli"));$("#b-csel").innerHTML=c?`<div class="summary"><span><b style="font-size:15px">${esc(c.cognomeNome)}</b> · ${esc(c.cell||"")}${c.sconto?` · <span class="pill red">-${c.sconto}%</span>`:""}${Object.keys(c.prezzi||{}).length?' · <span class="pill warn">prezzi su misura</span>':""}</span><button type="button" class="btn sm ghost" id="b-cx">Togli</button></div>`:`<div class="note">Nessun cliente scelto: prezzi di listino.</div>`;
    if($("#b-cx"))$("#b-cx").onclick=()=>{$("#b-cli").value="";showSel();const p=autoPrice();if(p)$("#b-prezzo").value=p;check()}};
  const pick=id=>{const c=C(id);if(!c)return;$("#b-cli").value=id;$("#b-cq").value="";$("#b-cres").hidden=true;
    splitName(c);CLI.forEach(([k])=>{const el=document.getElementById("c-"+k);if(el&&c[k])el.value=c[k]});$("#c-cf").dispatchEvent(new Event("input"));showSel();const p=autoPrice();if(p)$("#b-prezzo").value=p;check()};
  const norm=x=>String(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  $("#b-cq").oninput=()=>{const q=norm(gv("b-cq")),qd=q.replace(/\D/g,"");const box=$("#b-cres");
    if(!q){box.hidden=true;return}
    const L=S.clients.filter(c=>q.split(/\s+/).every(w=>norm(c.cognomeNome).includes(w))||(qd.length>=3&&String(c.cell||"").replace(/\D/g,"").includes(qd))).slice(0,8);
    box.innerHTML=L.length?L.map(c=>`<button type="button" data-pk="${c.id}"><b>${esc(c.cognomeNome)}</b><span class="note"> · ${esc(c.cell||"")}${c.sconto?" · -"+c.sconto+"%":""}</span></button>`).join(""):`<div class="note" style="padding:10px 12px">Nessun cliente trovato.</div>`;
    box.innerHTML+=`<button type="button" id="b-cnew2" style="color:var(--red);font-weight:800">+ Registra «${esc(gv("b-cq"))}» come nuovo cliente</button>`;
    box.hidden=false;box.querySelectorAll("[data-pk]").forEach(x=>x.onclick=()=>pick(x.dataset.pk));$("#b-cnew2").onclick=()=>{box.hidden=true;$("#b-cnew").click()}};
  $("#b-cq").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();const f=$("#b-cres [data-pk]");if(f)f.click()}};
  $("#b-cnew").onclick=()=>{const q=gv("b-cq");
    $("#b-cform").innerHTML=`<div class="summary" style="display:grid;gap:10px;align-items:stretch"><b>Nuovo cliente</b>
      <div class="grid2">${F("nc-cognome","Cognome",q&&!/\d/.test(q)?q.trim().split(/\s+/)[0]:(gv("b-cli")?"":gv("c-cognome")))}${F("nc-nome","Nome",q&&!/\d/.test(q)?q.trim().split(/\s+/).slice(1).join(" "):(gv("b-cli")?"":gv("c-nome")))}${F("nc-cell","Cellulare",q&&/\d/.test(q)?q:(gv("b-cli")?"":gv("c-cell")),"tel")}</div>
      <div class="note">Gli altri dati (codice fiscale, patente…) li prendo da «Dati conducente» qui sotto, se li hai già scritti. La password la puoi creare dopo nella scheda cliente.</div>
      <div class="actions"><button type="button" class="btn sm ghost" id="nc-no">Annulla</button><button type="button" class="btn sm" id="nc-ok">Registra e usa</button></div></div>`;
    $("#nc-no").onclick=()=>$("#b-cform").innerHTML="";
    $("#nc-ok").onclick=async()=>{const cog=gv("nc-cognome"),nom=gv("nc-nome"),nome=joinName({cognome:cog,nome:nom}),cell=gv("nc-cell");if(!cog||cell.replace(/\D/g,"").length<8){toast("Inserisci cognome e cellulare");return}
      const cur=joinName({cognome:gv("c-cognome"),nome:gv("c-nome")}),same=!cur||norm(cur)===norm(nome);
      const c={sconto:0,prezzi:{},docsFrom:same&&b.id&&b.docs?b.id:""};if(same)CLI.forEach(([k])=>c[k]=gv("c-"+k));c.cognome=cog;c.nome=nom;c.cognomeNome=nome;c.cell=cell;
      const nc=await upsert("clients",c);if(!nc)return;$("#b-cform").innerHTML="";
      if(!same)CLI.forEach(([k])=>{const el=document.getElementById("c-"+k);if(el)el.value=""});$("#c-cognome").value=cog;$("#c-nome").value=nom;$("#c-cell").value=cell;
      pick(nc.id);toast("Cliente registrato")}};
  document.addEventListener("click",function hide(e){const box=$("#b-cres");if(!box){document.removeEventListener("click",hide);return}if(!e.target.closest(".cli-pick"))box.hidden=true});
  showSel();
  check();cfAttach("c-");
  if(!b.prezzo){const p=autoPrice();if(p)$("#b-prezzo").value=p}
  const collect=()=>{const o={...b,clienteId:gv("b-cli"),vehicleId:gv("b-v"),dal:gv("b-dal"),al:gv("b-al"),oraInizio:gv("b-ora"),stato:gv("b-st"),prezzo:gn("b-prezzo"),cauzione:gn("b-dep"),carburante:gv("b-fuel"),kmPartenza:gn("b-kmp"),dataFine:gv("b-df"),oraFine:gv("b-of"),carburanteRientro:gv("b-fuelr"),kmRientro:gn("b-kmr"),kmFormula:gv("b-kmf"),kmInclusiGiorno:b.kmInclusiGiorno||KMC.inclusi,costoKm:b.costoKm??KMC.costo,extraKm:gn("b-xkm"),extraKmAuto:!xkmManual,note:gv("b-note")};CLI.forEach(([k])=>o[k]=gv("c-"+k));o.cf=(o.cf||"").toUpperCase();o.cognomeNome=joinName(o)||o.cognomeNome||"";return o};
  const save=async(o,msg)=>{if(o.al<o.dal){toast("La data di fine è prima dell'inizio");return null}
    if(ACTIVE.includes(o.stato)&&!freeRange(o.vehicleId,o.dal,o.al,o.id)){toast("Il mezzo è già occupato in queste date");return null}
    const r=await upsert("bookings",o);if(!r)return null;
    if(r.stato==="concluso"&&r.kmRientro){const v=V(r.vehicleId);if(v&&r.kmRientro>(v.km||0))await upsert("vehicles",{...v,km:r.kmRientro})}
    toast(msg||"Noleggio salvato");return r};
  $("#bf").onsubmit=async e=>{e.preventDefault();if(await save(collect()))closeSheet()};
  let xkmManual=b.extraKm!==""&&b.extraKm!=null&&b.extraKmAuto===false;
  const kmCalc=()=>{const box=$("#b-kmcalc");if(!box)return;const kp=Number(gv("b-kmp")),kr=Number(gv("b-kmr")),g=giorni(gv("b-dal"),gv("b-al"));
    if(!(kp>0&&kr>0)){box.innerHTML=`<div class="km-calc note">Inserisci i km di partenza e di rientro: l'extra si calcola da solo.</div>`;return}
    if(kr<kp){box.innerHTML=`<div class="km-calc extra">I km di rientro sono minori di quelli di partenza: controlla.</div>`;return}
    const fatti=kr-kp,ill=gv("b-kmf")==="illimitati",inc=g*(b.kmInclusiGiorno||KMC.inclusi),costo=b.costoKm??KMC.costo,ex=ill?0:Math.max(0,fatti-inc),eu=Math.round(ex*costo*100)/100;
    box.innerHTML=`<div class="km-calc ${eu>0?"extra":""}">Percorsi <b>${fatti.toLocaleString("it-IT")} km</b>${ill?" · km illimitati: nessun extra":` · inclusi ${inc.toLocaleString("it-IT")} km (${g} gg × ${b.kmInclusiGiorno||KMC.inclusi}) · <b>extra ${ex.toLocaleString("it-IT")} km × ${eur2(costo)} = ${eur(eu)}</b>`}</div>`;
    if(!xkmManual){$("#b-xkm").value=eu?eu.toFixed(2):"";payUI.refresh&&payUI.refresh()}};
  ["b-kmp","b-kmr"].forEach(i=>$("#"+i).addEventListener("input",kmCalc));
  $("#b-xkm").addEventListener("input",()=>{xkmManual=true;payUI.refresh&&payUI.refresh()});
  payUI($("#b-pay"),b,()=>(Number(gv("b-prezzo"))||0)+(Number(gv("b-xkm"))||0),async()=>{const r=await save(collect(),"Pagamento salvato");if(r){Object.assign(b,r)}return r});
  $("#b-prezzo").addEventListener("input",()=>payUI.refresh&&payUI.refresh());
  kmCalc();
  if($("#bok"))$("#bok").onclick=async()=>{const o=collect();o.stato="confermato";if(await save(o,"Richiesta confermata"))closeSheet()};
  if($("#bsc"))$("#bsc").onclick=async()=>{const o=collect();if(!o.cognomeNome||!o.cell){toast("Inserisci prima nome e cellulare");return}
    const c={sconto:0,prezzi:{},docsFrom:b.id&&b.docs?b.id:""};CLI.forEach(([k])=>c[k]=o[k]);c.cognomeNome=o.cognomeNome;
    const nc=await upsert("clients",c);if(!nc)return;o.clienteId=nc.id;if(await save(o,"Cliente salvato"))closeSheet()};
  $("#bct").onclick=async()=>{const r=await save(collect(),"Salvato");if(r)openContract(r)};
  bindDocs("bd","bookings",b,async()=>{if(b.id)return b.id;const r=await save(collect(),"Noleggio salvato");if(r){b.id=r.id;b.clienteId=r.clienteId}return r&&r.id});
  if($("#bdel"))$("#bdel").onclick=()=>{$("#bconf").innerHTML=`<div class="confirm">Eliminare questo noleggio e i suoi documenti? <button type="button" class="btn sm" id="bdy">Sì, elimina</button><button type="button" class="btn sm ghost" id="bdn">No</button></div>`;$("#bdn").onclick=()=>$("#bconf").innerHTML="";$("#bdy").onclick=async()=>{if(await remove("bookings",b.id)){closeSheet();toast("Noleggio eliminato")}}};
}

/* ---------- clients ---------- */
function newPassword(){const A="abcdefghjkmnpqrstuvwxyz",D="23456789";let s="";for(let i=0;i<4;i++)s+=A[Math.floor(Math.random()*A.length)];for(let i=0;i<4;i++)s+=D[Math.floor(Math.random()*D.length)];return s}
function aCli(){
  const L=S.clients.filter(c=>!cq||((c.cognomeNome||"")+" "+(c.cell||"")+" "+(c.cf||"")).toLowerCase().includes(cq.toLowerCase())).sort((x,y)=>(x.cognomeNome||"").localeCompare(y.cognomeNome||""));
  $("#amain").innerHTML=`<div class="panel"><h2>Clienti registrati (${S.clients.length}) <button class="btn sm" id="cnew">+ Nuovo cliente</button></h2>
   <div class="field" style="max-width:360px;margin-bottom:10px"><label for="c-q">Cerca</label><input id="c-q" placeholder="Nome, cellulare, codice fiscaleice…" value="${esc(cq)}"></div>
   ${L.length?`<div class="scroll"><table class="vtable"><thead><tr><th>Cliente</th><th>Cellulare</th><th>Accesso sito</th><th>Tariffa</th><th>Noleggi</th><th>Da incassare</th></tr></thead><tbody>${L.map(c=>{const nb=S.bookings.filter(b=>b.clienteId===c.id).length,np=Object.values(c.prezzi||{}).filter(x=>x!==""&&x!=null).length;return`<tr class="click" data-oc="${c.id}"><td><b>${esc(c.cognomeNome)}</b><div class="note">${esc(c.email||"")}</div></td><td>${esc(c.cell||"")}</td><td>${c.hasPassword?'<span class="pill ok">attivo</span>':'<span class="pill grey">no</span>'}</td><td>${c.sconto?`<span class="pill red">-${c.sconto}%</span> `:""}${np?`<span class="pill warn">${np} prezz${np>1?"i":"o"} su misura</span>`:""}${!c.sconto&&!np?'<span class="pill grey">listino</span>':""}</td><td>${nb}</td><td>${(()=>{const d=debts().filter(x=>x.clienteId===c.id).reduce((a,x)=>a+x.res,0);return d>0?`<span class="pill bad">${eur(d)}</span>`:'<span class="note">—</span>'})()}</td></tr>`}).join("")}</tbody></table></div>`:`<div class="empty-state">${cq?"Nessun cliente trovato.":"Nessun cliente ancora. Aggiungilo qui oppure da un noleggio con «Salva come cliente»."}</div>`}</div>`;
  $("#cnew").onclick=()=>openClient(null);
  $("#c-q").oninput=e=>{cq=e.target.value;const pos=e.target.selectionStart;aCli();const q=$("#c-q");q.focus();q.setSelectionRange(pos,pos)};
  document.querySelectorAll("[data-oc]").forEach(r=>r.onclick=()=>openClient(C(r.dataset.oc)));
}
function openClient(c){
  const n=!c; c=splitName(c?{...c}:{sconto:0,prezzi:{}});
  sheet(n?"Nuovo cliente":esc(c.cognomeNome),`<form class="form" id="cf">
   <fieldset><legend>Accesso al sito</legend>
    <div>${c.hasPassword?'<span class="pill ok">Accesso attivo</span> <span class="note">Il cliente ha già una password. Scrivine una nuova solo se l\'ha dimenticata.</span>':'<span class="pill grey">Accesso non attivo</span> <span class="note">Crea una password per farlo entrare nell\'Area clienti.</span>'}</div>
    <div class="grid2">${F("c-pw",c.hasPassword?"Nuova password (vuoto = non cambiare)":"Password per il sito","","text",'autocomplete="off" style="font-family:var(--f-mono);font-size:18px;font-weight:700"')}<div class="field"><label>&nbsp;</label><button type="button" class="btn sm ghost" id="c-gen">Genera password</button></div></div>
    <a class="btn sm dark" id="c-wa" href="#" target="_blank" rel="noopener" hidden>Manda accesso su WhatsApp</a>
    <span class="note">Il cliente entra da «Area clienti» sul sito con il suo <b>cellulare</b> e la <b>password</b>, e vede i suoi prezzi. Può anche registrarsi da solo dal sito.</span>
   </fieldset>
   <fieldset><legend>Dati anagrafici e patente</legend>
    <div class="grid2">${cliFields(c,["cognome","cell"])}</div>
   </fieldset>
   ${docsBox(c.docs,"cd",false)}
   <fieldset><legend>Tariffe riservate</legend>
    <div class="grid2">${F("c-sconto","Sconto su tutti i mezzi (%)",c.sconto||"","number",'min=0 max=90 step="1"')}</div>
    <div class="note">Oppure fissa un prezzo al giorno per un singolo mezzo (vale al posto dello sconto). Lascia vuoto per usare listino o sconto.</div>
    <div class="scroll"><table class="vtable"><thead><tr><th>Mezzo</th><th>Listino</th><th>Prezzo per questo cliente</th></tr></thead><tbody>
    ${S.vehicles.map(v=>`<tr><td><b>${vName(v)}</b></td><td>${v.prezzo?eur(v.prezzo):"—"}</td><td><input id="cp-${v.id}" type="number" step="0.5" min="0" value="${esc(c.prezzi&&c.prezzi[v.id]!=null?c.prezzi[v.id]:"")}" placeholder="${v.prezzo?esc(priceFor(v,{sconto:c.sconto})):""}" style="max-width:130px"></td></tr>`).join("")}
    </tbody></table></div>
    <div class="field"><label for="c-note">Note (accordi, fatturazione…)</label><textarea id="c-note" rows="2">${esc(c.note||"")}</textarea></div>
   </fieldset>
   <div id="cconf"></div>
   <div class="actions">${n?"":`<button type="button" class="btn ghost left" id="cdel">Elimina cliente</button><button type="button" class="btn ghost" id="cbk">Nuovo noleggio</button>`}<button class="btn" type="submit">Salva cliente</button></div>
  </form>`);
  const waLink=()=>{const d=(x=>x.length<=10?"39"+x:x)(gv("c-cell").replace(/\D/g,""));return `https://wa.me/${d}?text=${encodeURIComponent(`Ciao ${gv("c-nome")||gv("c-cognome")}, ecco il tuo accesso all'Area clienti di MA.GI. Rent su www.magirent.com\nCellulare: ${gv("c-cell")}\nPassword: ${gv("c-pw")}\nCosì vedi i tuoi prezzi riservati e prenoti più veloce.`)}`};
  $("#c-wa").onclick=e=>{if(!gv("c-cell")){e.preventDefault();toast("Inserisci prima il cellulare");return}$("#c-wa").href=waLink()};
  const pwChanged=()=>{$("#c-wa").hidden=!gv("c-pw")};$("#c-pw").oninput=pwChanged;
  $("#c-gen").onclick=()=>{$("#c-pw").value=newPassword();pwChanged()};
  const collect=()=>{const o={...c,newPassword:gv("c-pw"),sconto:Number(gv("c-sconto"))||0,note:gv("c-note"),prezzi:{}};CLI.forEach(([k])=>o[k]=gv("c-"+k));o.cf=(o.cf||"").toUpperCase();o.cognomeNome=joinName(o)||o.cognomeNome||"";
    S.vehicles.forEach(v=>{const x=gv("cp-"+v.id);if(x!=="")o.prezzi[v.id]=Number(x)});return o};
  cfAttach("c-");
  $("#cf").onsubmit=async e=>{e.preventDefault();const pw=gv("c-pw");if(pw&&pw.length<6){toast("La password deve avere almeno 6 caratteri");return}
    const r=await upsert("clients",collect());if(r){closeSheet();toast(pw?"Cliente salvato · ricordati di mandargli la password":"Cliente salvato")}};
  bindDocs("cd","clients",c,async()=>{if(c.id)return c.id;const o=collect();if(!o.cognomeNome||!o.cell){toast("Inserisci prima nome e cellulare");return null}const r=await upsert("clients",o);if(r)c.id=r.id;return r&&r.id});
  if($("#cbk"))$("#cbk").onclick=async()=>{const o=await upsert("clients",collect());if(!o)return;const pre={clienteId:o.id,cognomeNome:o.cognomeNome};CLI.forEach(([k])=>pre[k]=o[k]);openBookingAdmin(null,pre)};
  if($("#cdel"))$("#cdel").onclick=()=>{$("#cconf").innerHTML=`<div class="confirm">Eliminare ${esc(c.cognomeNome)}? I noleggi restano. <button type="button" class="btn sm" id="cdy">Sì, elimina</button><button type="button" class="btn sm ghost" id="cdn">No</button></div>`;$("#cdn").onclick=()=>$("#cconf").innerHTML="";$("#cdy").onclick=async()=>{if(await remove("clients",c.id)){closeSheet();toast("Cliente eliminato")}}};
}

/* ---------- settings ---------- */
function aImp(){
  const DEF=["+393381630369","+393274404800",""];
  const wa=[0,1,2].map(i=>WA.length?(WA[i]||{phone:"",apikey:""}):{phone:DEF[i],apikey:""});
  $("#amain").innerHTML=`
  <div class="panel"><h2>Avvisi nuove prenotazioni</h2>
    <div class="note" style="margin-bottom:10px">Email: ogni richiesta arriva a <b>${esc(NOTIFY)}</b>. Controlla anche lo spam la prima volta e segna "Non è spam".</div>
    <div class="note">WhatsApp (servizio gratuito CallMeBot): da ogni telefono aggiungi in rubrica il numero <b>+34 644 94 58 67</b> (il numero può cambiare: se non risponde, controlla quello indicato su callmebot.com), mandagli su WhatsApp il messaggio <b>I allow callmebot to send me messages</b> e incolla qui la chiave (apikey) che ti risponde.</div>
    <form class="form" id="waf" style="margin-top:12px">
      ${wa.map((w,i)=>`<div class="grid2">${F("wa-p"+i,"Numero "+(i+1),w.phone,"tel")}${F("wa-k"+i,"Chiave CallMeBot (apikey)",w.apikey,"text",'inputmode="numeric" placeholder="es. 1234567"')}</div>`).join("")}
      <div class="actions"><button type="button" class="btn ghost" id="watest">Invia avviso di prova</button><button class="btn">Salva</button></div>
    </form>
  </div>
  <div class="panel"><h2>Chilometri</h2>
    <div class="note" style="margin-bottom:10px">Sul sito il cliente sceglie tra <b>km inclusi</b> (con extra al km calcolato al rientro) e <b>km illimitati</b> (prezzo al giorno + supplemento). Il supplemento si può cambiare anche per singolo mezzo in Parco mezzi.</div>
    <form class="form" id="kmf"><div class="grid3">${F("k-inc","Km inclusi al giorno",KMC.inclusi,"number",'min=1 step="1"')}${F("k-cost","Costo km extra (€)",KMC.costo,"number",'min=0 step="0.01"')}${F("k-sup","Supplemento km illimitati (€/giorno)",KMC.suppl,"number",'min=0 step="0.5"')}</div>
    <div class="actions"><button class="btn">Salva</button></div></form>
  </div>
  <div class="panel"><h2>Avvisi scadenze mezzi</h2>
    <div class="note">Ogni giorno il gestionale controlla <b>revisione</b> e <b>assicurazione</b> di tutti i mezzi: quando mancano <b>15 giorni</b> alla scadenza manda un messaggio WhatsApp ai numeri qui sopra e una email. L'avviso arriva una sola volta per ogni scadenza: quando rinnovi, aggiorna la data nel mezzo.</div>
    <div class="actions" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn ghost" id="chk">Controlla adesso</button></div>
  </div>
  <div class="cols">
    <div class="panel"><h2>Cambia password</h2>
      <form class="form" id="pwf">${F("pw-old","Password attuale","","password",'required autocomplete="current-password"')}${F("pw-new","Nuova password (min 8)","","password",'required minlength="8" autocomplete="new-password"')}<div class="actions"><button class="btn">Cambia password</button></div></form>
    </div>
    <div class="panel"><h2>Copia di sicurezza</h2>
      <div class="note" style="margin-bottom:12px">Scarica una copia di mezzi, noleggi e clienti. Fallo una volta al mese e conservala sul PC.</div>
      <div class="actions" style="justify-content:flex-start"><a class="btn ghost" href="api.php?a=admin_backup">Scarica backup</a><button class="btn dark" id="lout">Esci dal gestionale</button></div>
    </div>
  </div>`;
  const collectWa=()=>[0,1,2].map(i=>({phone:gv("wa-p"+i),apikey:gv("wa-k"+i)})).filter(w=>w.phone);
  $("#waf").onsubmit=async e=>{e.preventDefault();try{await api("admin_settings",{wa:collectWa()});WA=collectWa();toast("Impostazioni salvate")}catch(er){toast(er.message)}};
  $("#watest").onclick=async()=>{try{await api("admin_settings",{wa:collectWa()});WA=collectWa();const r=await api("admin_test",{});toast(`Prova inviata · email ${r.email?"ok":"non partita"} · WhatsApp ${r.wa}`)}catch(er){toast(er.message)}};
  $("#pwf").onsubmit=async e=>{e.preventDefault();try{await api("admin_password",{old:$("#pw-old").value,new:$("#pw-new").value});toast("Password cambiata");$("#pwf").reset()}catch(er){toast(er.message)}};
  $("#kmf").onsubmit=async e=>{e.preventDefault();try{const r=await api("admin_km",{inclusi:gn("k-inc"),costo:gn("k-cost"),suppl:gn("k-sup")});KMC=r.km;toast("Impostazioni km salvate")}catch(er){toast(er.message)}};
  $("#chk").onclick=async()=>{try{const r=await api("admin_check",{});toast(r.sent?`Inviati ${r.sent} avvisi · WhatsApp ${r.wa} · email ${r.email?"ok":"non partita"}`:"Nessuna nuova scadenza entro 15 giorni")}catch(er){toast(er.message)}};
  $("#lout").onclick=async()=>{try{await api("admin_logout",{})}catch(e){}location.reload()};
}

/* ---------- contract ---------- */
function contractFields(b){
  const v=V(b.vehicleId)||{};
  const L=198,R=401;
  return {p1:[
    [L,212,b.cognomeNome,98],[R,212,b.cf,110],
    [L,231,b.indirizzo,98],[R,231,b.citta,110],
    [L,249.5,b.cap,98],[R,249.5,b.cell,110],
    [L,267.5,b.luogoNascita,98],[R,267.5,it(b.dataNascita),110],
    [L,286,b.prov,98],[R,286,b.enteRilascio,110],
    [L,304.5,b.nPatente,98],[R,304.5,it(b.dataRilascio),110],
    [L,322,it(b.dataScad),98],
    [L,365,[v.marca,v.modello].filter(Boolean).join(" "),98],[R,365,v.targa,110],
    [L,384.5,v.colore,98],[R,384.5,v.alimentazione,110],
    [L,403,b.carburante,98],[R,403,b.kmPartenza!==""&&b.kmPartenza!=null?Number(b.kmPartenza).toLocaleString("it-IT"):"",110],
    [L,421,it(b.dal),98],[R,421,b.oraInizio,110],
    [L,439,b.dal&&b.al?String(giorni(b.dal,b.al)):"",98],
    [302,439,b.kmFormula==="illimitati"?"KM ILLIMITATI":`KM: ${b.kmInclusiGiorno||KMC.inclusi}/giorno inclusi · extra € ${Number(b.costoKm??KMC.costo).toFixed(2).replace(".",",")}/km`,205]
  ],p2:[
    [172,641,it(b.dataFine),110],[392,641,b.oraFine,110],
    [172,659.5,b.carburanteRientro,110],[392,659.5,b.kmRientro?Number(b.kmRientro).toLocaleString("it-IT"):"",110]
  ]};
}
let IMGS=null;
function loadImg(src,max=1800){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>{let w=i.naturalWidth,h=i.naturalHeight;const k=Math.min(1,max/Math.max(w,h));w=Math.round(w*k);h=Math.round(h*k);const c=document.createElement("canvas");c.width=w;c.height=h;const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,w,h);g.drawImage(i,0,0,w,h);res({d:c.toDataURL("image/jpeg",.85),w,h})};i.onerror=rej;i.src=src})}
function buildPdf(b,docImgs,docOther){
  const f=contractFields(b), W=595.28, H=841.89;
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"pt",format:"a4"});
  const put=arr=>arr.forEach(([x,y,t,max])=>{if(!t)return;let s=9;doc.setFontSize(s);while(doc.getTextWidth(String(t))>max&&s>5.5){s-=.5;doc.setFontSize(s)}doc.text(String(t),x,y)});
  doc.setFont("helvetica","normal");doc.setTextColor(11,59,156);
  doc.addImage(IMGS[0].d,"JPEG",0,0,W,H);put(f.p1);
  doc.addPage();doc.addImage(IMGS[1].d,"JPEG",0,0,W,H);put(f.p2);
  if(docImgs.length||docOther.length){
    const M=40, top=78, boxW=W-2*M, boxH=(H-top-M-20)/2;
    const head=()=>{doc.addPage();doc.setTextColor(200,48,46);doc.setFont("helvetica","bold");doc.setFontSize(13);doc.text("MA.GI. SRLS – Documenti del conducente",M,44);
      doc.setTextColor(20,18,19);doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(`${b.cognomeNome||""} · noleggio dal ${it(b.dal)} al ${it(b.al)}`,M,62)};
    docImgs.forEach((im,i)=>{if(i%2===0)head();const y=top+(i%2)*(boxH+20);
      doc.setFontSize(9);doc.setTextColor(107,98,100);doc.text(im.label,M,y+10);
      const k=Math.min(boxW/im.w,(boxH-18)/im.h),w=im.w*k,h=im.h*k;doc.addImage(im.d,"JPEG",M+(boxW-w)/2,y+16,w,h)});
    if(docOther.length){if(!docImgs.length)head();doc.setFontSize(9);doc.setTextColor(168,100,0);doc.text("Allegati PDF da stampare a parte: "+docOther.join(", "),M,H-24)}
  }
  return doc;
}
function openContract(b){
  const f=contractFields(b), W=595.28, H=841.89, v=V(b.vehicleId)||{};
  const name=`Contratto_${(v.targa||"mezzo")}_${(b.cognomeNome||"cliente").replace(/[^\w]+/g,"_")}_${b.dal||""}.pdf`;
  const ov=arr=>arr.filter(x=>x[2]).map(([x,y,t])=>`<span class="f" style="left:${x/W*100}%;top:${y/H*100}%">${esc(t)}</span>`).join("");
  const missing=["cognomeNome","cf","nPatente","dataNascita"].filter(k=>!b[k]).length;
  const D=docsFor(b), list=[...D.ci.map(x=>({...x,label:"Carta d'identità"})),...D.pat.map(x=>({...x,label:"Patente di guida"}))];
  const imgs=list.filter(isImg), other=list.filter(x=>!isImg(x)).map(x=>x.nome||"documento.pdf");
  sheet("Contratto di noleggio",`<div class="cprev">
    ${missing?`<div class="confirm" style="background:var(--warn-soft);color:var(--warn)">Mancano ancora alcuni dati del conducente: completali nel noleggio prima di stampare.</div>`:""}
    ${!D.ci.length||!D.pat.length?`<div class="confirm" style="background:var(--warn-soft);color:var(--warn)">Manca la foto ${!D.ci.length&&!D.pat.length?"della carta d'identità e della patente":!D.ci.length?"della carta d'identità":"della patente"}: puoi caricarla nel noleggio.</div>`:`<div class="note">Il PDF contiene il contratto compilato e ${imgs.length} foto dei documenti (${Math.ceil(imgs.length/2)} pagin${Math.ceil(imgs.length/2)>1?"e":"a"} in più).${other.length?" I documenti in PDF vanno stampati a parte.":""}</div>`}
    <div class="actions"><button class="btn ghost" id="cdl">Scarica PDF</button><button class="btn" id="cpr">Apri e stampa</button></div>
    <div class="cpage"><img src="img/contratto-1.jpg" alt="Contratto pagina 1">${ov(f.p1)}</div>
    <div class="cpage"><img src="img/contratto-2.jpg" alt="Contratto pagina 2">${ov(f.p2)}</div>
    ${imgs.length?`<div class="photo-row">${imgs.map(x=>`<img src="doc.php?f=${encodeURIComponent(x.f)}" alt="${esc(x.label)}" style="width:160px;aspect-ratio:3/2;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`).join("")}</div>`:""}
  </div>`);
  let P=null;
  const ready=()=>P||(P=(async()=>{if(!IMGS)IMGS=await Promise.all([loadImg("img/contratto-1.jpg",2400),loadImg("img/contratto-2.jpg",2400)]);
    const di=[];for(const x of imgs){try{const r=await loadImg("doc.php?f="+encodeURIComponent(x.f));di.push({...r,label:x.label})}catch(e){other.push(x.nome||"foto non leggibile")}}
    return buildPdf(b,di,other)})().catch(e=>{P=null;throw e}));
  ready().catch(()=>{});
  $("#cdl").onclick=async()=>{try{(await ready()).save(name)}catch(e){toast("PDF non creato. Riprova.")}};
  $("#cpr").onclick=()=>{
    const w=window.open("","_blank");
    ready().then(doc=>{const url=doc.output("bloburl");if(w)w.location.href=url;else location.href=url}).catch(()=>{if(w)w.close();toast("PDF non creato. Riprova.")});
  };
}

/* ---------- incassi ---------- */
const METODI=["Contanti","Carta / POS","Bonifico","Satispay","Assegno","Altro"];
const paidOf=r=>(r.pagamenti||[]).reduce((a,p)=>a+(Number(p.importo)||0),0);
const dueOf=(r,kind)=>kind==="c"?(Number(r.importo)||0):(Number(r.prezzo)||0)+(Number(r.extraKm)||0);
const OWING=["confermato","in corso","concluso"];
function debts(){
  const t=today(),out=[];
  S.bookings.forEach(b=>{if(!OWING.includes(b.stato))return;const due=dueOf(b,"b"),res=Math.round((due-paidOf(b))*100)/100;if(res<=0.009)return;
    const ref=b.scadenzaPagamento||b.al;out.push({kind:"b",rec:b,id:b.id,clienteId:b.clienteId,nome:b.cognomeNome,cell:b.cell,desc:`${vName(V(b.vehicleId))} · ${it(b.dal)} → ${it(b.al)}`,due,res,ref,late:ref&&ref<t?diff(ref,t):0})});
  S.crediti.forEach(c=>{const due=dueOf(c,"c"),res=Math.round((due-paidOf(c))*100)/100;if(res<=0.009)return;const ref=c.scadenzaPagamento||c.scadenza||c.data;
    out.push({kind:"c",rec:c,id:c.id,clienteId:c.clienteId,nome:c.cliente,cell:c.cell,desc:c.descrizione||"Credito",due,res,ref,late:ref&&ref<t?diff(ref,t):0})});
  return out.sort((a,b)=>b.late-a.late||b.res-a.res);
}
function allPayments(){
  const out=[];
  S.bookings.forEach(b=>(b.pagamenti||[]).forEach(p=>out.push({...p,nome:b.cognomeNome,desc:vName(V(b.vehicleId))+" · "+it(b.dal),vehicleId:b.vehicleId,kind:"b",rid:b.id})));
  S.crediti.forEach(c=>(c.pagamenti||[]).forEach(p=>out.push({...p,nome:c.cliente,desc:c.descrizione||"Credito",kind:"c",rid:c.id})));
  return out.sort((a,b)=>a.data<b.data?1:-1);
}
const payPill=(due,paid)=>due<=0?'<span class="pill grey">importo da inserire</span>':paid>=due-0.009?'<span class="pill ok">pagato</span>':paid>0?'<span class="pill warn">acconto</span>':'<span class="pill bad">da pagare</span>';
const waSollecito=(nome,cell,res,desc)=>{const d=String(cell||"").replace(/\D/g,"");if(d.length<8)return"";const n=d.length<=10?"39"+d:d;
  return `https://wa.me/${n}?text=${encodeURIComponent(`Buongiorno, le ricordiamo il saldo di ${eur(res)} per ${desc}. Può passare in ${AZ.ritiro} o contattarci al ${AZ.tel1}. Grazie, MA.GI. Rent`)}`};

function payUI(box,rec,getTotal,persist){
  const draw=()=>{
    const due=getTotal(),paid=paidOf(rec),res=Math.max(0,Math.round((due-paid)*100)/100);
    box.innerHTML=`<div class="pay-sum"><div><span>Totale</span><b>${eur(due)}</b></div><div><span>Pagato</span><b style="color:var(--ok)">${eur(paid)}</b></div><div><span>Da incassare</span><b style="color:${res>0?"var(--bad)":"var(--ok)"}">${eur(res)}</b></div><div>${payPill(due,paid)}</div></div>
      ${(rec.pagamenti||[]).length?`<div class="list" style="margin-top:6px">${rec.pagamenti.map((p,i)=>`<div class="li"><div class="grow"><div class="t">${eur(p.importo)} · ${esc(p.metodo||"")}</div><div class="s">${it(p.data)}${p.nota?" · "+esc(p.nota):""}</div></div><button type="button" class="x" data-delp="${i}" aria-label="Elimina pagamento">×</button></div>`).join("")}</div>`:`<div class="note" style="margin-top:6px">Nessun pagamento registrato.</div>`}
      <div class="grid3" style="margin-top:10px">${F("p-imp","Importo ricevuto (€)",res||"","number",'step="0.01" min="0"')}${F("p-data","Data",today(),"date")}${SEL("p-met","Metodo","Contanti",METODI)}</div>
      ${F("p-nota","Nota (facoltativa)","","text",'placeholder="es. acconto, saldo, n. ricevuta"')}
      <div class="grid2">${F("p-scad","Deve pagare entro",rec.scadenzaPagamento||"","date")}<div class="field"><label>&nbsp;</label><div class="actions" style="justify-content:flex-start"><button type="button" class="btn sm" id="p-add">Registra pagamento</button>${res>0?`<button type="button" class="btn sm ghost" id="p-all">Segna tutto pagato</button>`:""}</div></div></div>
      <div class="note" id="p-st"></div>`;
    const add=async imp=>{imp=Math.round(Number(imp)*100)/100;if(!(imp>0)){$("#p-st").textContent="Inserisci l'importo ricevuto";return}
      const old=rec.pagamenti;rec.pagamenti=[...(old||[]),{id:Math.random().toString(36).slice(2,9),data:gv("p-data")||today(),importo:imp,metodo:gv("p-met"),nota:gv("p-nota")}];rec.scadenzaPagamento=gv("p-scad");
      const r=await persist(rec);if(!r)rec.pagamenti=old;draw()};
    $("#p-add").onclick=()=>add(gv("p-imp"));
    if($("#p-all"))$("#p-all").onclick=()=>add(res);
    $("#p-scad").onchange=async()=>{rec.scadenzaPagamento=gv("p-scad");await persist(rec)};
    box.querySelectorAll("[data-delp]").forEach(b=>b.onclick=async()=>{if(!confirm("Eliminare questo pagamento?"))return;const old=rec.pagamenti;rec.pagamenti=old.filter((_,i)=>i!==Number(b.dataset.delp));if(!await persist(rec))rec.pagamenti=old;draw()});
  };
  payUI.refresh=draw;draw();
}

function openCredito(c){
  const n=!c;c=c?{...c}:{data:today(),pagamenti:[]};
  sheet(n?"Nuovo credito da incassare":"Credito · "+esc(c.cliente||""),`<form class="form" id="crf">
    <div class="note">Per soldi che un cliente vi deve e che non sono legati a un noleggio del gestionale (noleggi vecchi, danni, multe, carburante…).</div>
    <div class="grid2">${F("cr-cli","Cliente",c.cliente,"text",'required list="cr-cl" autocomplete="off"')}${F("cr-cell","Cellulare",c.cell,"tel")}</div>
    <datalist id="cr-cl">${S.clients.map(x=>`<option value="${esc(x.cognomeNome)}"></option>`).join("")}</datalist>
    ${F("cr-desc","Per cosa",c.descrizione,"text",'required placeholder="es. danno carrozzeria Daily, noleggio di agosto"')}
    <div class="grid3">${F("cr-imp","Importo totale (€)",c.importo,"number",'required step="0.01" min="0"')}${F("cr-data","Data",c.data,"date")}${F("cr-scad","Deve pagare entro",c.scadenza,"date")}</div>
    ${F("cr-note","Note",c.note)}
    ${n?"":`<fieldset><legend>Pagamenti</legend><div id="cr-pay"></div></fieldset>`}
    <div id="crconf"></div>
    <div class="actions">${n?"":`<button type="button" class="btn ghost left" id="crdel">Elimina</button>`}<button class="btn">${n?"Salva credito":"Salva"}</button></div></form>`);
  $("#cr-cli").onchange=()=>{const x=S.clients.find(k=>k.cognomeNome===gv("cr-cli"));if(x&&!gv("cr-cell"))$("#cr-cell").value=x.cell||""};
  const collect=()=>{const x=S.clients.find(k=>k.cognomeNome===gv("cr-cli"));return{...c,cliente:gv("cr-cli"),clienteId:x?x.id:"",cell:gv("cr-cell"),descrizione:gv("cr-desc"),importo:gn("cr-imp"),data:gv("cr-data")||today(),scadenza:gv("cr-scad"),note:gv("cr-note")}};
  $("#crf").onsubmit=async e=>{e.preventDefault();if(!gv("cr-cli")||!(Number(gv("cr-imp"))>0)){toast("Inserisci cliente e importo");return}const r=await upsert("crediti",collect());if(r){closeSheet();toast("Credito salvato")}};
  if(!n)payUI($("#cr-pay"),c,()=>Number(gv("cr-imp"))||0,async rec=>{const r=await upsert("crediti",{...collect(),pagamenti:rec.pagamenti,scadenzaPagamento:rec.scadenzaPagamento});if(r)Object.assign(c,r);return r});
  if($("#crdel"))$("#crdel").onclick=()=>{$("#crconf").innerHTML=`<div class="confirm">Eliminare questo credito? <button type="button" class="btn sm" id="crdy">Sì, elimina</button><button type="button" class="btn sm ghost" id="crdn">No</button></div>`;$("#crdn").onclick=()=>$("#crconf").innerHTML="";$("#crdy").onclick=async()=>{if(await remove("crediti",c.id)){closeSheet();toast("Credito eliminato")}}};
}
function openIncassa(d){
  sheet("Incassa · "+esc(d.nome||""),`<div class="form"><div class="summary"><span>${esc(d.desc)}</span><b>${eur(d.res)}</b></div>
    <div class="grid3">${F("q-imp","Importo ricevuto (€)",d.res,"number",'step="0.01" min="0"')}${F("q-data","Data",today(),"date")}${SEL("q-met","Metodo","Contanti",METODI)}</div>
    ${F("q-nota","Nota (facoltativa)","")}
    <div class="actions"><button type="button" class="btn ghost" id="q-open">Apri scheda</button><button type="button" class="btn" id="q-ok">Registra pagamento</button></div></div>`);
  $("#q-open").onclick=()=>{closeSheet();d.kind==="b"?openBookingAdmin(d.rec):openCredito(d.rec)};
  $("#q-ok").onclick=async()=>{const imp=Math.round(Number(gv("q-imp"))*100)/100;if(!(imp>0)){toast("Inserisci l'importo");return}
    const p={id:Math.random().toString(36).slice(2,9),data:gv("q-data")||today(),importo:imp,metodo:gv("q-met"),nota:gv("q-nota")};
    const r=await upsert(d.kind==="b"?"bookings":"crediti",{...d.rec,pagamenti:[...(d.rec.pagamenti||[]),p]});if(r){closeSheet();toast(`Incassati ${eur(imp)}`)}};
}

let incMode="mese", incRef=(()=>{const d=new Date();d.setDate(1);return d})(), incList="debiti";
function aInc(){
  const y=incRef.getFullYear(),mo=incRef.getMonth();
  const from=incMode==="mese"?iso(new Date(y,mo,1)):`${y}-01-01`, to=incMode==="mese"?iso(new Date(y,mo+1,0)):`${y}-12-31`;
  const label=incMode==="mese"?`${MESI[mo]} ${y}`:`anno ${y}`;
  const pays=allPayments(), inP=pays.filter(p=>p.data>=from&&p.data<=to), incassato=inP.reduce((a,p)=>a+Number(p.importo||0),0);
  const nol=S.bookings.filter(b=>OWING.includes(b.stato)&&b.dal>=from&&b.dal<=to), valore=nol.reduce((a,b)=>a+dueOf(b,"b"),0);
  const D=debts(), daInc=D.reduce((a,x)=>a+x.res,0), late=D.filter(x=>x.late>0), lateTot=late.reduce((a,x)=>a+x.res,0);
  const months=[];for(let k=11;k>=0;k--){const d=new Date(new Date().getFullYear(),new Date().getMonth()-k,1);const a=iso(d),z=iso(new Date(d.getFullYear(),d.getMonth()+1,0));months.push({l:MESI[d.getMonth()].slice(0,3),v:pays.filter(p=>p.data>=a&&p.data<=z).reduce((s,p)=>s+Number(p.importo||0),0),cur:incMode==="mese"&&d.getMonth()===mo&&d.getFullYear()===y})}
  const max=Math.max(1,...months.map(m=>m.v));
  const byMet={};inP.forEach(p=>byMet[p.metodo||"Altro"]=(byMet[p.metodo||"Altro"]||0)+Number(p.importo||0));
  const byVeh={};inP.filter(p=>p.kind==="b").forEach(p=>{const k=vName(V(p.vehicleId));byVeh[k]=(byVeh[k]||0)+Number(p.importo||0)});
  const rows=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="li"><div class="grow t">${k}</div><b>${eur(v)}</b></div>`).join("")||`<div class="note">Nessun incasso nel periodo.</div>`;
  $("#amain").innerHTML=`
  <div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div style="display:flex;gap:6px;align-items:center"><button class="c2-nav" id="ip" aria-label="Precedente">‹</button><b style="font-size:20px;text-transform:capitalize;min-width:150px;text-align:center">${label}</b><button class="c2-nav" id="in" aria-label="Successivo">›</button></div>
    <div class="chips"><button class="chip" data-im="mese" aria-pressed="${incMode==="mese"}">Mese</button><button class="chip" data-im="anno" aria-pressed="${incMode==="anno"}">Anno</button></div>
  </div>
  <div class="kpis">
    <div class="kpi"><b style="color:var(--ok)">${eur(incassato)}</b><span>Incassato · ${label}</span></div>
    <div class="kpi"><b>${eur(valore)}</b><span>Valore noleggi iniziati · ${nol.length}</span></div>
    <div class="kpi"><b>${eur(daInc)}</b><span>Da incassare in totale · ${D.length}</span></div>
    <div class="kpi ${lateTot?"hot":""}"><b>${eur(lateTot)}</b><span>In ritardo · ${late.length} pagament${late.length===1?"o":"i"}</span></div>
  </div>
  <div class="panel"><h2>Incassi ultimi 12 mesi</h2>
    <div class="bars">${months.map(m=>`<div class="bar${m.cur?" cur":""}" title="${m.l}: ${eur(m.v)}"><span class="bv">${m.v?Math.round(m.v).toLocaleString("it-IT"):""}</span><i style="height:${Math.round(m.v/max*100)}%"></i><span class="bl">${m.l}</span></div>`).join("")}</div>
  </div>
  <div class="panel">
    <h2><span class="chips"><button class="chip" data-il="debiti" aria-pressed="${incList==="debiti"}">Da incassare (${D.length})</button><button class="chip" data-il="incassi" aria-pressed="${incList==="incassi"}">Incassi del periodo (${inP.length})</button></span>
      <span style="display:flex;gap:6px;flex-wrap:wrap">${incList==="incassi"&&inP.length?`<button class="btn sm ghost" id="csv">Scarica per Excel</button>`:""}<button class="btn sm" id="crnew">+ Aggiungi credito</button></span></h2>
    ${incList==="debiti"?(D.length?`<div class="list">${D.map((d,i)=>{const wa=waSollecito(d.nome,d.cell,d.res,d.desc);return`<div class="li debt"><div class="grow"><div class="t">${esc(d.nome||"—")} ${d.kind==="c"?'<span class="pill grey">credito</span>':""}</div><div class="s">${esc(d.desc)}${d.cell?" · "+esc(d.cell):""}</div><div class="s">${d.late>0?`<span class="pill bad">in ritardo di ${d.late} gg</span>`:d.ref?`<span class="pill grey">entro il ${it(d.ref)}</span>`:""} ${paidOf(d.rec)>0?`già pagati ${eur(paidOf(d.rec))} su ${eur(d.due)}`:""}</div></div>
        <b style="font-size:18px;color:var(--bad);white-space:nowrap">${eur(d.res)}</b>
        <div class="debt-act">${wa?`<a class="btn sm dark" href="${wa}" target="_blank" rel="noopener">Sollecito WhatsApp</a>`:""}<button class="btn sm" data-inc="${i}">Incassa</button></div></div>`}).join("")}</div>`:`<div class="empty-state">Nessuno vi deve soldi.</div>`)
    :(inP.length?`<div class="scroll"><table class="vtable"><thead><tr><th>Data</th><th>Cliente</th><th>Per</th><th>Metodo</th><th>Importo</th></tr></thead><tbody>${inP.map(p=>`<tr class="click" data-pr="${p.kind}|${p.rid}"><td>${it(p.data)}</td><td><b>${esc(p.nome||"—")}</b></td><td>${esc(p.desc)}${p.nota?`<div class="note">${esc(p.nota)}</div>`:""}</td><td>${esc(p.metodo||"")}</td><td><b>${eur(p.importo)}</b></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state">Nessun incasso registrato in questo periodo.</div>`)}
  </div>
  <div class="cols">
    <div class="panel"><h2>Per metodo · ${label}</h2><div class="list">${rows(byMet)}</div></div>
    <div class="panel"><h2>Per mezzo · ${label}</h2><div class="list">${rows(byVeh)}</div></div>
  </div>`;
  const shift=k=>{incRef=incMode==="mese"?new Date(y,mo+k,1):new Date(y+k,0,1);aInc()};
  $("#ip").onclick=()=>shift(-1);$("#in").onclick=()=>shift(1);
  document.querySelectorAll("[data-im]").forEach(b=>b.onclick=()=>{incMode=b.dataset.im;aInc()});
  document.querySelectorAll("[data-il]").forEach(b=>b.onclick=()=>{incList=b.dataset.il;aInc()});
  $("#crnew").onclick=()=>openCredito(null);
  document.querySelectorAll("[data-inc]").forEach(b=>b.onclick=()=>openIncassa(D[Number(b.dataset.inc)]));
  document.querySelectorAll("[data-pr]").forEach(r=>r.onclick=()=>{const[k,id]=r.dataset.pr.split("|");k==="b"?openBookingAdmin(S.bookings.find(x=>x.id===id)):openCredito(S.crediti.find(x=>x.id===id))});
  if($("#csv"))$("#csv").onclick=()=>{
    const q=x=>`"${String(x??"").replace(/"/g,'""')}"`;
    const csv="﻿"+["Data;Cliente;Per;Metodo;Importo;Nota",...inP.map(p=>[it(p.data),p.nome,p.desc,p.metodo,Number(p.importo||0).toFixed(2).replace(".",","),p.nota].map(q).join(";"))].join("\r\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`incassi-${incMode==="mese"?`${y}-${pad(mo+1)}`:y}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)};
}

boot();
