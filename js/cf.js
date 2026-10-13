/* MA.GI. RENT — calcolo automatico del codice fiscale */
const CF_ESTERO=[["ALBANIA","Z100"],["AUSTRIA","Z102"],["BELGIO","Z103"],["BULGARIA","Z104"],["DANIMARCA","Z107"],["FINLANDIA","Z109"],["FRANCIA","Z110"],["GERMANIA","Z112"],["REGNO UNITO","Z114"],["GRECIA","Z115"],["IRLANDA","Z116"],["LUSSEMBURGO","Z120"],["MALTA","Z121"],["NORVEGIA","Z125"],["PAESI BASSI","Z126"],["POLONIA","Z127"],["PORTOGALLO","Z128"],["ROMANIA","Z129"],["SPAGNA","Z131"],["SVEZIA","Z132"],["SVIZZERA","Z133"],["UNGHERIA","Z134"],["UCRAINA","Z138"],["BIELORUSSIA","Z139"],["MOLDAVIA","Z140"],["ESTONIA","Z144"],["LETTONIA","Z145"],["LITUANIA","Z146"],["MACEDONIA DEL NORD","Z148"],["CROAZIA","Z149"],["SLOVENIA","Z150"],["BOSNIA-ERZEGOVINA","Z153"],["RUSSIA","Z154"],["SLOVACCHIA","Z155"],["REPUBBLICA CECA","Z156"],["SERBIA","Z158"],["MONTENEGRO","Z159"],["KOSOVO","Z160"],
["AFGHANISTAN","Z200"],["SRI LANKA","Z209"],["CINA","Z210"],["COREA DEL SUD","Z213"],["FILIPPINE","Z216"],["GIAPPONE","Z219"],["INDIA","Z222"],["IRAN","Z224"],["IRAQ","Z225"],["ISRAELE","Z226"],["LIBANO","Z229"],["PAKISTAN","Z236"],["SIRIA","Z240"],["THAILANDIA","Z241"],["TURCHIA","Z243"],["BANGLADESH","Z249"],["VIETNAM","Z251"],["GEORGIA","Z254"],
["ALGERIA","Z301"],["CAMERUN","Z306"],["COSTA D'AVORIO","Z313"],["ETIOPIA","Z315"],["GAMBIA","Z317"],["GHANA","Z318"],["GUINEA","Z319"],["LIBIA","Z326"],["MALI","Z329"],["MAROCCO","Z330"],["MAURITIUS","Z332"],["NIGERIA","Z335"],["EGITTO","Z336"],["SENEGAL","Z343"],["SOMALIA","Z345"],["SUDAN","Z348"],["TUNISIA","Z352"],["BURKINA FASO","Z354"],["ERITREA","Z368"],
["CANADA","Z401"],["STATI UNITI","Z404"],["CUBA","Z504"],["REPUBBLICA DOMINICANA","Z505"],["MESSICO","Z514"],["ARGENTINA","Z600"],["BOLIVIA","Z601"],["BRASILE","Z602"],["CILE","Z603"],["COLOMBIA","Z604"],["ECUADOR","Z605"],["PARAGUAY","Z610"],["PERU","Z611"],["URUGUAY","Z613"],["VENEZUELA","Z614"],["AUSTRALIA","Z700"]];

const cfNorm=s=>String(s||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z]/g,"");
const cfPlace=s=>String(s||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Z0-9]/g,"");
function cfPart(s,isName){
  const t=cfNorm(s),cons=t.replace(/[AEIOU]/g,""),voc=t.replace(/[^AEIOU]/g,"");
  if(isName&&cons.length>=4)return cons[0]+cons[2]+cons[3];
  return (cons+voc+"XXX").slice(0,3);
}
function cfCheck(c15){
  const odd={0:1,1:0,2:5,3:7,4:9,5:13,6:15,7:17,8:19,9:21,A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,N:20,O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23};
  let sum=0;
  for(let i=0;i<15;i++){const ch=c15[i];sum+=i%2===0?odd[ch]:(/\d/.test(ch)?Number(ch):ch.charCodeAt(0)-65)}
  return String.fromCharCode(65+sum%26);
}
/* data: {cognome,nome,sesso:"M"|"F",dataNascita:"YYYY-MM-DD",belfiore:"H501"} */
function cfCompute(d){
  if(!cfNorm(d.cognome)||!cfNorm(d.nome)||!/^[MF]$/.test(d.sesso||"")||!/^\d{4}-\d{2}-\d{2}$/.test(d.dataNascita||"")||!/^[A-Z]\d{3}$/.test(d.belfiore||""))return "";
  const [y,m,g]=d.dataNascita.split("-").map(Number);
  const c15=cfPart(d.cognome,false)+cfPart(d.nome,true)+String(y%100).padStart(2,"0")+"ABCDEHLMPRST"[m-1]+String(g+(d.sesso==="F"?40:0)).padStart(2,"0")+d.belfiore;
  return c15+cfCheck(c15);
}
function cfValid(cf){cf=String(cf||"").toUpperCase();return /^[A-Z0-9]{16}$/.test(cf)&&cfCheck(cf.slice(0,15))===cf[15]}

/* elenco comuni: [nome, sigla provincia, codice catastale] */
let CF_COMUNI=null, CF_LOADING=null;
function cfLoadComuni(){
  if(CF_COMUNI)return Promise.resolve(CF_COMUNI);
  if(CF_LOADING)return CF_LOADING;
  CF_LOADING=(async()=>{
    try{const c=JSON.parse(localStorage.getItem("mg-comuni")||"null");if(c&&c.t>Date.now()-30*864e5&&c.l&&c.l.length>7000){CF_COMUNI=c.l;return CF_COMUNI}}catch(e){}
    let list=null;
    try{const r=await fetch("comuni.php");if(r.ok){const j=await r.json();if(Array.isArray(j)&&j.length>7000)list=j}}catch(e){}
    if(!list){const r=await fetch("https://cdn.jsdelivr.net/gh/matteocontrini/comuni-json@master/comuni.json");const j=await r.json();list=j.map(x=>[x.nome,x.sigla,x.codiceCatastale])}
    CF_COMUNI=list;
    try{localStorage.setItem("mg-comuni",JSON.stringify({t:Date.now(),l:list}))}catch(e){}
    return list;
  })().catch(e=>{CF_LOADING=null;throw e});
  return CF_LOADING;
}
function cfDatalist(){
  if(document.getElementById("comuni-list")||!CF_COMUNI)return;
  const dl=document.createElement("datalist");dl.id="comuni-list";
  dl.innerHTML=CF_COMUNI.map(c=>`<option value="${esc(c[0])} (${esc(c[1])})"></option>`).join("")+CF_ESTERO.map(c=>`<option value="${esc(c[0])} (Estero)"></option>`).join("");
  document.body.appendChild(dl);
}
/* returns {code} or {error} */
function cfFindPlace(txt){
  const m=String(txt||"").trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const name=cfPlace(m?m[1]:txt), pr=m?m[2].trim().toUpperCase():"";
  if(!name)return {error:""};
  if(pr==="ESTERO"||!CF_COMUNI){const e=CF_ESTERO.find(c=>cfPlace(c[0])===name);if(e)return {code:e[1]};if(pr==="ESTERO")return {error:"Stato estero non in elenco: scrivi il codice fiscale a mano."}}
  if(!CF_COMUNI)return {error:"Elenco comuni non ancora caricato…"};
  let L=CF_COMUNI.filter(c=>cfPlace(c[0])===name);
  if(pr&&pr!=="ESTERO")L=L.filter(c=>c[1]===pr);
  if(L.length===1)return {code:L[0][2]};
  if(L.length>1)return {error:"Più comuni con questo nome: sceglilo dall'elenco con la provincia."};
  const e=CF_ESTERO.find(c=>cfPlace(c[0])===name);if(e)return {code:e[1]};
  return {error:"Comune non trovato: sceglilo dall'elenco. Se è un comune che non esiste più, scrivi il codice fiscale a mano."};
}
/* collega il calcolo automatico ai campi con prefisso p (es. "c-" o "r-") */
function cfAttach(p){
  const $i=k=>document.getElementById(p+k);
  const cf=$i("cf"),luogo=$i("luogoNascita");
  if(!cf||!luogo)return;
  luogo.setAttribute("list","comuni-list");luogo.setAttribute("autocomplete","off");
  let hint=document.getElementById(p+"cf-hint");
  if(!hint){hint=document.createElement("div");hint.id=p+"cf-hint";hint.className="note";hint.style.marginTop="2px";cf.parentNode.appendChild(hint)}
  cf.dataset.auto=cf.value?"0":"1";
  const run=()=>{
    const d={cognome:$i("cognome")&&$i("cognome").value,nome:$i("nome")&&$i("nome").value,sesso:$i("sesso")&&$i("sesso").value,dataNascita:$i("dataNascita")&&$i("dataNascita").value};
    if(!cfNorm(d.cognome)||!cfNorm(d.nome)||!d.sesso||!d.dataNascita||!luogo.value.trim()){hint.textContent=cf.dataset.auto==="1"?"Si calcola da solo quando inserisci cognome, nome, sesso, data e luogo di nascita.":"";hint.style.color="";return}
    const pl=cfFindPlace(luogo.value);
    if(pl.error!==undefined){hint.textContent=pl.error;hint.style.color="var(--warn)";return}
    const v=cfCompute({...d,belfiore:pl.code});
    if(!v)return;
    if(cf.dataset.auto==="1"||!cf.value){cf.value=v;cf.dataset.auto="1";hint.textContent="Calcolato automaticamente ✓ Controlla che sia uguale a quello della tessera sanitaria.";hint.style.color="var(--ok)"}
    else if(cf.value.toUpperCase()!==v){hint.innerHTML=`Dai dati risulta <b>${v}</b>. <button type="button" class="btn sm ghost" style="padding:2px 10px">Usa questo</button>`;hint.style.color="var(--warn)";hint.querySelector("button").onclick=()=>{cf.value=v;cf.dataset.auto="1";run()}}
    else{hint.textContent="Codice fiscale corretto ✓";hint.style.color="var(--ok)"}
  };
  cf.addEventListener("input",()=>{cf.dataset.auto=cf.value?"0":"1";run()});
  ["cognome","nome","sesso","dataNascita","luogoNascita"].forEach(k=>{const e=$i(k);if(e){e.addEventListener("input",run);e.addEventListener("change",run)}});
  cfLoadComuni().then(()=>{cfDatalist();run()}).catch(()=>{hint.textContent="Elenco comuni non disponibile ora: il codice fiscale va scritto a mano.";hint.style.color="var(--warn)"});
  run();
}
