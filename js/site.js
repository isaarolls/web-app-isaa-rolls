/* MA.GI. RENT — sito clienti */
let VEH=[], BUSY={}, ME=null, KMC={inclusi:100,costo:0.2,suppl:0}, filt="Tutti", qDal=today(), qAl=addD(today(),1);

function busyDays(vid){const set=new Set();(BUSY[vid]||[]).forEach(([a,b])=>{for(let d=a;d<=b;d=addD(d,1))set.add(d)});return set}
function freeRange(vid,a,b){const bs=busyDays(vid);for(let d=a;d<=b;d=addD(d,1))if(bs.has(d))return false;return true}

async function load(){
  try{const j=await api("public");VEH=j.vehicles;BUSY=j.busy||{};ME=j.me;if(j.km)KMC=j.km;render()}
  catch(e){$("#site").innerHTML=`<div class="loading">Il sito non risponde. Chiamaci al ${AZ.tel1}.</div>`}
}

function render(){
  const list=VEH.filter(v=>filt==="Tutti"||v.tipo===filt);
  $("#site").innerHTML=`
  <header class="site-head"><div class="wrap">
    <img class="logo" src="${LOGO}" alt="MA.GI. Rent & Sell">
    <nav><a href="#flotta">I mezzi</a><a href="#come">Come funziona</a><a href="#contatti">Contatti</a></nav>
    <button class="btn sm ghost" id="area">${ME?"Il mio account":"Accedi / Registrati"}</button>
  </div></header>
  <section class="hero"><div class="wrap">
    <div>
      <h1>Noleggio <em>furgoni</em>, <em>camper</em> e auto a Palermo</h1>
      <p>Scegli il mezzo, controlla i giorni liberi e invia la prenotazione online. Ti richiamiamo noi per confermare.</p>
    </div>
    <form class="quick" id="qform">
      <label>Quando ti serve?</label>
      <div class="row">
        <div class="field"><label for="q-dal">Ritiro</label><input type="date" id="q-dal" value="${qDal}" min="${today()}"></div>
        <div class="field"><label for="q-al">Riconsegna</label><input type="date" id="q-al" value="${qAl}" min="${today()}"></div>
      </div>
      <button class="btn" type="submit">Mostra i mezzi liberi</button>
    </form>
  </div></section>
  <div class="stripe"></div>
  <div class="usp">
    <div><b>Prenoti dal telefono</b><span>documenti caricati in un minuto</span></div>
    <div><b>Assicurazione RC + Kasko</b><span>franchigia fissa € 1.000</span></div>
    <div><b>Solo patente B</b><span>per tutti i nostri furgoni</span></div>
    <div><b>Ritiro in sede</b><span>${AZ.ritiro}</span></div>
  </div>
  ${ME?`<div class="wrap" style="padding-top:18px"><div class="summary"><span>Ciao <b style="font-size:16px">${esc(ME.nome)}</b> · bentornato</span><button class="btn sm ghost" id="logout">Esci</button></div></div>`:""}
  <section class="section" id="flotta"><div class="wrap">
    <div class="section-head"><div><h2>I nostri mezzi</h2><div class="note">Disponibilità dal ${it(qDal)} al ${it(qAl)}</div></div>
      <div class="chips">${["Tutti",...["Furgone","Camper","Auto","Minibus"].filter(t=>VEH.some(v=>v.tipo===t))].map(f=>`<button class="chip" data-f="${f}" aria-pressed="${f===filt}">${{Furgone:"Furgoni",Camper:"Camper",Auto:"Auto",Minibus:"Minibus"}[f]||f}</button>`).join("")}</div></div>
    ${list.length?`<div class="fleet">${list.map(v=>{const free=freeRange(v.id,qDal,qAl);return`
      <article class="vcard"><div class="ph">${photo(v)}<span class="tag">${esc(v.tipo)}</span><span class="avail ${free?"yes":"no"}">${v.officina?"In manutenzione":free?"Libero":"Occupato"}</span></div>
      <div class="body"><h3>${esc(v.marca)} ${esc(v.modello)}</h3>
        <div class="specs"><span>${esc(v.alimentazione)}</span><span>${esc(v.cambio)}</span><span>${esc(v.posti)} posti</span>${v.carico?`<span>${/cassone/i.test(v.carico)?"":"Vano "}${esc(v.carico)}</span>`:""}<span>Patente ${esc(v.patente||"B")}</span></div>
        <div class="price"><div>${v.prezzo?`${ME&&v.prezzo!==v.listino&&v.listino?`<small style="text-decoration:line-through">${eur(v.listino)}</small> `:""}<b>${eur(v.prezzo)}</b> <small>/ giorno</small>`:`<b style="font-size:18px">Prezzo su richiesta</b>`}</div><button class="btn sm" data-book="${v.id}">${free?"Prenota":"Altre date"}</button></div>
      </div></article>`}).join("")}</div>`:`<div class="empty-state">Nessun mezzo disponibile al momento. Chiamaci al ${AZ.tel1}.</div>`}
  </div></section>
  <section class="section" id="come" style="padding-top:0"><div class="wrap">
    <div class="section-head"><h2>Come funziona</h2></div>
    <div class="how">
      <div><b>Scegli il mezzo</b><p>Vedi subito quali giorni sono liberi nel calendario del mezzo.</p></div>
      <div><b>Invia la richiesta</b><p>Inserisci i tuoi dati e carica documento e patente: il mezzo resta bloccato per te.</p></div>
      <div><b>Ritira in sede</b><p>Ti aspettiamo in ${AZ.ritiro}. Il contratto è già pronto da firmare.</p></div>
    </div>
  </div></section>
  <section class="section" id="contatti" style="padding-top:0"><div class="wrap">
    <div class="contact">
      <div><h2>Passa a trovarci</h2><p style="opacity:.75;margin:10px 0 18px">Ritiro e riconsegna su appuntamento</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="https://wa.me/${AZ.telWa}" target="_blank" rel="noopener">Scrivici su WhatsApp</a><a class="btn ghost" style="color:#fff" href="tel:+393381630369">Chiama</a></div></div>
      <dl><dt>Ritiro mezzi</dt><dd>${AZ.ritiro}</dd><dt>Telefono</dt><dd>${AZ.tel1} · ${AZ.tel2}</dd><dt>Email</dt><dd>${AZ.mail}</dd><dt>PEC</dt><dd>${AZ.pec}</dd></dl>
    </div>
  </div></section>
  <footer class="site-foot"><div class="wrap">${AZ.nome} · Sede legale ${AZ.sede} · P.IVA ${AZ.piva} · <a href="privacy.html">Privacy</a> · <a href="/gestionale">Area riservata</a></div></footer>`;
  $("#qform").onsubmit=e=>{e.preventDefault();const a=$("#q-dal").value,b=$("#q-al").value;if(a&&b&&b>=a){qDal=a;qAl=b;render();$("#flotta").scrollIntoView({behavior:"smooth"})}else toast("La riconsegna deve essere dopo il ritiro")};
  document.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{filt=b.dataset.f;render();$("#flotta").scrollIntoView()});
  document.querySelectorAll("[data-book]").forEach(b=>b.onclick=()=>openBooking(b.dataset.book));
  if($("#logout"))$("#logout").onclick=logout;
  $("#area").onclick=()=>openArea();
}
async function logout(){try{await api("client_logout",{})}catch(e){}ME=null;closeSheet();load();toast("Sei uscito")}

function openArea(mode){
  if(ME){
    sheet("Area clienti",`<div class="form"><div class="summary"><span>Accesso come <b style="font-size:16px">${esc(ME.nome)}</b></span></div><div class="note">Se hai tariffe riservate sono già applicate a tutti i mezzi. ${ME.hasDocs?"I tuoi documenti sono in archivio ✓":"Alla prima prenotazione ti chiederemo carta d'identità e patente."}</div>
      <div class="actions"><button class="btn ghost" id="aout">Esci</button><button class="btn" id="aok">Vedi i mezzi</button></div>
      <details><summary class="note" style="cursor:pointer;font-weight:700">Cambia password</summary><form class="form" id="apf" style="margin-top:10px">${F("ap-old","Password attuale","","password",'required autocomplete="current-password"')}${F("ap-new","Nuova password (almeno 6 caratteri)","","password",'required minlength="6" autocomplete="new-password"')}<div class="err" id="aperr"></div><button class="btn sm">Cambia password</button></form></details></div>`);
    $("#aout").onclick=logout;$("#aok").onclick=()=>{closeSheet();$("#flotta").scrollIntoView()};
    $("#apf").onsubmit=async e=>{e.preventDefault();try{await api("client_password",{old:$("#ap-old").value,new:$("#ap-new").value});toast("Password cambiata");$("#apf").reset();$("#aperr").textContent=""}catch(er){$("#aperr").textContent=er.message}};
    return;
  }
  const reg=mode==="reg";
  sheet("Area clienti",`<div class="chips" style="margin-bottom:14px"><button class="chip" id="t-in" aria-pressed="${!reg}">Accedi</button><button class="chip" id="t-reg" aria-pressed="${reg}">Registrati</button></div>
    ${reg?`<form class="form" id="rf" novalidate><div class="note">Registrati una volta sola: alla prossima prenotazione non dovrai rimettere dati e documenti. Tutti i campi sono obbligatori: ci servono per il contratto di noleggio.</div>
      <fieldset><legend>I tuoi dati</legend><div class="grid2">
        ${F("r-cognome","Cognome","","text",'name="cognome" required autocomplete="family-name"')}${F("r-nome","Nome","","text",'name="nome" required autocomplete="given-name"')}
        <div class="field"><label for="r-sesso">Sesso</label><select id="r-sesso" name="sesso" required><option value=""></option><option value="M">Maschio</option><option value="F">Femmina</option></select></div>${F("r-dataNascita","Data di nascita","","date",'name="dataNascita" required')}
        ${F("r-luogoNascita","Luogo di nascita (comune o stato estero)","","text",'name="luogoNascita" required placeholder="Scrivi e scegli dall\'elenco"')}${F("r-cf","Codice fiscale","","text",'name="cf" required maxlength="16" autocapitalize="characters" style="text-transform:uppercase;font-family:var(--f-mono)"')}
        ${F("r-indirizzo","Indirizzo","","text",'name="indirizzo" required autocomplete="street-address"')}${F("r-citta","Città","","text",'name="citta" required autocomplete="address-level2"')}
        ${F("r-cap","CAP","","text",'name="cap" required inputmode="numeric" maxlength="5" autocomplete="postal-code"')}${F("r-prov","Provincia","","text",'name="prov" required maxlength="2" autocapitalize="characters" placeholder="es. PA" style="text-transform:uppercase"')}
        ${F("r-cell","Cellulare","","tel",'name="cell" required autocomplete="tel"')}${F("r-email","Email","","email",'name="email" required autocomplete="email"')}
      </div></fieldset>
      <fieldset><legend>Patente</legend><div class="grid2">
        ${F("r-nPatente","Numero patente","","text",'name="nPatente" required autocapitalize="characters"')}${F("r-enteRilascio","Rilasciata da","","text",'name="enteRilascio" required placeholder="es. MIT-UCO, Prefettura"')}
        ${F("r-dataRilascio","Data di rilascio","","date",'name="dataRilascio" required')}${F("r-dataScad","Data di scadenza","","date",'name="dataScad" required')}
      </div></fieldset>
      <fieldset><legend>Foto dei documenti</legend>
        <div class="note">Fronte e retro. Puoi scattarle ora con il telefono. Restano visibili solo a noi.</div>
        <div class="grid2">
          <div class="field"><label for="r-ci">Carta d'identità</label><input id="r-ci" name="ci[]" type="file" accept="image/*,application/pdf" multiple required></div>
          <div class="field"><label for="r-pat">Patente di guida</label><input id="r-pat" name="pat[]" type="file" accept="image/*,application/pdf" multiple required></div>
        </div>
      </fieldset>
      <fieldset><legend>Accesso</legend>${F("r-pw","Scegli una password (almeno 6 caratteri)","","password",'name="password" required minlength="6" autocomplete="new-password"')}<div class="note">Per entrare userai il tuo cellulare e questa password.</div></fieldset>
      <label class="note" style="display:flex;gap:8px;align-items:start"><input type="checkbox" id="r-priv" style="width:auto;margin-top:3px"><span>Ho letto l'<a href="privacy.html" target="_blank">informativa privacy</a>.</span></label>
      <div class="err" id="rerr"></div><button class="btn" type="submit" id="rbtn">Registrati</button></form>`
    :`<form class="form" id="af"><div class="note">Entra con il tuo cellulare e la tua password.</div>
      <div class="grid2">${F("a-cell","Cellulare","","tel",'required autocomplete="tel"')}${F("a-pw","Password","","password",'required autocomplete="current-password"')}</div>
      <div class="err" id="aerr"></div><button class="btn" type="submit" id="abtn">Accedi</button>
      <div class="note">Password dimenticata? Chiamaci al ${AZ.tel1} e te ne diamo una nuova.</div></form>`}`);
  $("#t-in").onclick=()=>openArea("in");$("#t-reg").onclick=()=>openArea("reg");
  if(reg){cfAttach("r-");$("#rf").onsubmit=async e=>{e.preventDefault();const form=$("#rf"),err=$("#rerr");
    const miss=[...form.querySelectorAll("[required]")].find(x=>x.type==="file"?!x.files.length:!x.value.trim());
    if(miss){const lab=form.querySelector(`label[for="${miss.id}"]`);err.textContent=`Compila «${lab?lab.textContent:"tutti i campi"}»`;miss.focus();return}
    if(gv("r-cf").replace(/\s/g,"").length!==16){err.textContent="Il codice fiscale deve avere 16 caratteri";$("#r-cf").focus();return}
    if($("#r-pw").value.length<6){err.textContent="La password deve avere almeno 6 caratteri";$("#r-pw").focus();return}
    if(!$("#r-priv").checked){err.textContent="Conferma di aver letto l'informativa privacy";return}
    const big=[...$("#r-ci").files,...$("#r-pat").files].find(f=>f.size>12*1024*1024);if(big){err.textContent=`Il file "${big.name}" è troppo grande (max 12 MB)`;return}
    $("#rbtn").disabled=true;$("#rbtn").textContent="Invio in corso…";err.textContent="";
    try{await api("client_register",new FormData(form));closeSheet();await load();toast("Registrazione completata, benvenuto!")}
    catch(er){err.textContent=er.message;$("#rbtn").disabled=false;$("#rbtn").textContent="Registrati"}};return}
  $("#af").onsubmit=async e=>{e.preventDefault();$("#abtn").disabled=true;
    try{await api("client_login",{cell:gv("a-cell"),password:$("#a-pw").value});closeSheet();await load();toast("Bentornato!")}
    catch(er){$("#aerr").textContent=er.message;$("#abtn").disabled=false}};
}

function openBooking(vid){
  const v=VEH.find(x=>x.id===vid), p0=v.prezzo, sup=Number(v.suppl)||0; let km="inclusi"; let m=pd(qDal); m.setDate(1);
  let a=freeRange(vid,qDal,qAl)?qDal:null, b=a?qAl:null, sent=false, err="", busy=false;
  const files={ci:[],pat:[]};
  const vals={"c-nome":ME?ME.nome:"","c-cell":ME?ME.cell:"","c-mail":ME?ME.email:"","c-ora":"09:00"};
  const keep=()=>Object.keys(vals).forEach(id=>{const el=document.getElementById(id);if(el)vals[id]=el.value});
  const restore=()=>Object.entries(vals).forEach(([k,x])=>{const el=document.getElementById(k);if(el)el.value=x||""});
  const fileLabel=k=>files[k].length?`<b style="color:var(--ok)">${files[k].length} file pront${files[k].length>1?"i":"o"} ✓</b>`:"Nessun file";
  const waText=()=>encodeURIComponent(`Ciao, ho appena inviato dal sito una richiesta per ${v.marca} ${v.modello} dal ${it(a)} al ${it(b)}. ${vals["c-nome"]}`);
  const draw=()=>{
    const bs=busyDays(vid), t=today();
    const off=(new Date(m).getDay()+6)%7, n=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
    let cells=["Lu","Ma","Me","Gi","Ve","Sa","Do"].map(d=>`<div class="dow">${d}</div>`).join("")+Array(off).fill('<span class="day empty"></span>').join("");
    for(let i=1;i<=n;i++){const d=iso(new Date(m.getFullYear(),m.getMonth(),i));let c="day";if(d<t)c+=" past";else if(bs.has(d))c+=" busy";if(d===a||d===b)c+=" sel";else if(a&&b&&d>a&&d<b)c+=" inrange";cells+=`<button type="button" class="${c}" data-d="${d}" ${d<t||bs.has(d)?"disabled":""} aria-label="${it(d)}${bs.has(d)?" occupato":""}">${i}</button>`}
    const g=a&&b?giorni(a,b):0, p=p0?p0+(km==="illimitati"?sup:0):0;
    sheet(`${esc(v.marca)} ${esc(v.modello)}`,`<div class="note" style="margin-top:-8px;margin-bottom:12px">${esc(v.tipo)} · ${p0?eur(p0)+"/giorno":"prezzo su richiesta"}${ME&&p0!==v.listino?" · tariffa riservata":""}</div>
      ${sent?`<div class="okbox">Richiesta inviata! Il mezzo è bloccato per te dal ${it(a)} al ${it(b)}. Ti chiamiamo a breve per confermare. Ritiro in ${AZ.ritiro}.</div>
        <div class="actions" style="margin-top:14px"><a class="btn dark" href="https://wa.me/${AZ.telWa}?text=${waText()}" target="_blank" rel="noopener">Scrivici su WhatsApp</a><button class="btn" id="mx2">Chiudi</button></div>`:`
      <div class="cal">
        <div class="cal-nav"><button type="button" id="pm" aria-label="Mese precedente">‹</button><span>${MESI[m.getMonth()]} ${m.getFullYear()}</span><button type="button" id="nm" aria-label="Mese successivo">›</button></div>
        <div class="cal-grid">${cells}</div>
        <div class="legend"><span><i style="background:var(--paper)"></i>Libero</span><span><i style="background:var(--bad-soft)"></i>Occupato</span><span><i style="background:var(--red)"></i>Le tue date</span></div>
      </div>
      <fieldset class="kmopt" style="margin-top:14px"><legend>Chilometri</legend>
        <label class="kmc${km==="inclusi"?" on":""}"><input type="radio" name="kmf" value="inclusi" ${km==="inclusi"?"checked":""}><span><b>${KMC.inclusi} km al giorno inclusi</b><small>Oltre: ${eur2(KMC.costo)} al km in più, calcolati al rientro</small></span><em>${p0?eur(p0)+"/g":""}</em></label>
        <label class="kmc${km==="illimitati"?" on":""}"><input type="radio" name="kmf" value="illimitati" ${km==="illimitati"?"checked":""}><span><b>Km illimitati</b><small>Guidi quanto vuoi, nessun extra al rientro</small></span><em>${p0?eur(p0+sup)+"/g":""}</em></label>
      </fieldset>
      <div class="summary" style="margin-block:14px">${a&&b?`<div>Dal <b style="font-size:16px">${it(a)}</b> al <b style="font-size:16px">${it(b)}</b><div class="note">${g} giorn${g>1?"i":"o"} · ${km==="illimitati"?"km illimitati":`${g*KMC.inclusi} km inclusi`}</div></div>${p?`<b>${eur(g*p)}</b>`:`<span class="note">Ti comunichiamo il prezzo</span>`}`:`<span class="note">${a?"Ora tocca il giorno di riconsegna":"Tocca il giorno di ritiro"}</span>`}</div>
      <form id="bform" class="form">
        <input type="text" name="website" id="hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <div class="grid2">
          <div class="field"><label for="c-nome">Nome e cognome</label><input id="c-nome" required autocomplete="name"></div>
          <div class="field"><label for="c-cell">Cellulare</label><input id="c-cell" required type="tel" autocomplete="tel"></div>
          <div class="field"><label for="c-mail">Email</label><input id="c-mail" type="email" autocomplete="email"></div>
          <div class="field"><label for="c-ora">Ora di ritiro</label><input id="c-ora" type="time"></div>
        </div>
        <fieldset><legend>Documenti${ME&&ME.hasDocs?"":" (obbligatori)"}</legend>
          <div class="note">${ME&&ME.hasDocs?"Abbiamo già i tuoi documenti ✓ Caricali di nuovo solo se sono cambiati.":"Fronte e retro. Puoi scattare la foto ora con il telefono. Restano visibili solo a noi."}</div>
          <div class="grid2">
            <div class="field"><label for="f-ci">Carta d'identità</label><input id="f-ci" type="file" accept="image/*,application/pdf" multiple><span class="note">${fileLabel("ci")}</span></div>
            <div class="field"><label for="f-pat">Patente di guida</label><input id="f-pat" type="file" accept="image/*,application/pdf" multiple><span class="note">${fileLabel("pat")}</span></div>
          </div>
        </fieldset>
        <label class="note" style="display:flex;gap:8px;align-items:start"><input type="checkbox" id="c-priv" required style="width:auto;margin-top:3px"><span>Ho letto l'<a href="privacy.html" target="_blank">informativa privacy</a> e accetto le condizioni di noleggio.</span></label>
        ${err?`<div class="err">${esc(err)}</div>`:""}
        <button class="btn" type="submit" ${a&&b&&!busy?"":"disabled"}>${busy?"Invio in corso…":"Invia prenotazione"}</button>
      </form>`}`);
    if($("#mx2"))$("#mx2").onclick=closeSheet;
    if(sent)return;
    restore();
    document.querySelectorAll('input[name="kmf"]').forEach(r=>r.onchange=()=>{keep();km=r.value;draw()});
    $("#pm").onclick=()=>{m.setMonth(m.getMonth()-1);keep();draw()};
    $("#nm").onclick=()=>{m.setMonth(m.getMonth()+1);keep();draw()};
    $("#f-ci").onchange=e=>{files.ci=[...e.target.files].slice(0,4);keep();draw()};
    $("#f-pat").onchange=e=>{files.pat=[...e.target.files].slice(0,4);keep();draw()};
    document.querySelectorAll(".day[data-d]").forEach(x=>x.onclick=()=>{keep();const d=x.dataset.d;err="";
      if(!a||b||d<a){a=d;b=null}else if(d===a){b=null}else{if(freeRange(vid,a,d)){b=d}else{err="Nel periodo scelto ci sono giorni già occupati.";a=d;b=null}}draw()});
    $("#bform").onsubmit=async e=>{e.preventDefault();keep();if(!(a&&b))return;
      if(!(ME&&ME.hasDocs)&&(!files.ci.length||!files.pat.length)){err="Carica la carta d'identità e la patente.";draw();return}
      const big=[...files.ci,...files.pat].find(f=>f.size>12*1024*1024);if(big){err=`Il file "${big.name}" è troppo grande (max 12 MB).`;draw();return}
      busy=true;err="";draw();
      const fd=new FormData();
      Object.entries({vehicleId:vid,km,dal:a,al:b,ora:vals["c-ora"],nome:vals["c-nome"],cell:vals["c-cell"],email:vals["c-mail"],website:$("#hp")?$("#hp").value:""}).forEach(([k,x])=>fd.append(k,x));
      files.ci.forEach(f=>fd.append("ci[]",f));files.pat.forEach(f=>fd.append("pat[]",f));
      try{await api("book",fd);sent=true;(BUSY[vid]=BUSY[vid]||[]).push([a,b]);render()}
      catch(er){err=er.message}
      busy=false;draw()};
  };
  draw();
}

load();
