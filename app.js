/* Southside Ent — script comune a tutte le pagine */
(function(){
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MESI=["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* copertine generative a maiolica, ricavate da un seme */
function seedRand(str){let h=2166136261;for(const c of str)h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h^=h<<13;h^=h>>>17;h^=h<<5;return((h>>>0)%10000)/10000}}
function drawTile(cv,seed,n=2,alpha=.9){
  const dpr=Math.min(2,devicePixelRatio||1),r=cv.getBoundingClientRect(),w=Math.max(40,r.width),h=Math.max(40,r.height);
  cv.width=w*dpr;cv.height=h*dpr;const x=cv.getContext('2d');x.scale(dpr,dpr);
  const R=seedRand(seed),cols=[css('--oro'),css('--maiolica'),css('--tufo'),css('--ink-3')];
  x.fillStyle=css('--ink-2');x.fillRect(0,0,w,h);
  const s=Math.max(w,h)/n;
  for(let i=0;i<n;i++)for(let j=0;j<Math.ceil(h/s)+1;j++){
    const k=Math.floor(R()*4);x.save();x.translate(i*s+s/2,j*s+s/2);x.rotate(Math.floor(R()*4)*Math.PI/2);
    x.globalAlpha=alpha;x.fillStyle=cols[k];x.beginPath();x.moveTo(-s/2,-s/2);x.arc(-s/2,-s/2,s,0,Math.PI/2);x.closePath();x.fill();
    x.fillStyle=cols[(k+1)%4];x.beginPath();x.arc(s/2,s/2,s*.28,0,Math.PI*2);x.fill();x.restore();
  }
}

/* ---------- Artisti ---------- */
function media(a,cls){
  return a.foto?`<img class="${cls}" src="${esc(a.foto)}" alt="${esc(a.nome)}" loading="lazy">`:`<canvas class="${cls}" aria-hidden="true"></canvas>`;
}
function bioParas(a){return (Array.isArray(a.bio)?a.bio:[a.bio]).filter(Boolean)}
function renderRoster(){
  const g=$('#rosterGrid');if(!g||typeof ARTISTI==='undefined')return;
  const limit=+g.dataset.limit||ARTISTI.length, full=!g.dataset.limit;
  g.innerHTML='';
  ARTISTI.slice(0,limit).forEach(a=>{
    const el=document.createElement(full?'button':'a');el.className='artist'+(a.foto?' has-photo':'');
    if(full){el.type='button';el.addEventListener('click',()=>openArtist(a.slug))}else el.href='artisti.html#'+a.slug;
    el.innerHTML=`${media(a,'art-media')}<span class="tag"><span>${esc(a.genere)}</span><span>${esc(a.quartiere)}</span></span>
      <h3>${esc(a.nome)}</h3><p>${esc(a.breve||bioParas(a)[0]||'')}</p><span class="open">Scheda →</span>`;
    el._seed=a.slug;g.appendChild(el);
  });
  if(full||g.dataset.join){
    const j=document.createElement('a');j.className='roster-join';j.href='demo.html';
    j.innerHTML=`<span class="eyebrow">Posto libero</span><h3>Il prossimo<br>puoi essere <em>tu</em></h3><span class="btn" style="align-self:flex-start">Invia demo →</span>`;
    g.appendChild(j);
  }
  $$('.artist',g).forEach(el=>{const c=$('canvas',el);if(c)drawTile(c,el._seed,4,.55)});
}
function openArtist(slug){
  const a=ARTISTI.find(x=>x.slug===slug);if(!a)return;
  closeSheet();
  const link=(u,l,c='btn')=>u&&u!=='#'?`<a class="${c}" href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`:'';
  const s=document.createElement('div');s.className='sheet';s.id='sheet';
  s.innerHTML=`<div class="sheet-card" role="dialog" aria-modal="true" aria-label="${esc(a.nome)}">
    <button class="sheet-close" aria-label="Chiudi">×</button><div class="sheet-media">${media(a,'sheet-img')}</div>
    <div class="sheet-body">
      <span class="eyebrow">${esc(a.genere)} · ${esc(a.quartiere)}</span>
      <h3>${esc(a.nome)}</h3>
      ${bioParas(a).map(p=>`<p>${esc(p)}</p>`).join('')}
      ${a.tappe&&a.tappe.length?`<div><p class="eyebrow" style="margin-bottom:8px">Tappe</p><ol class="milestones">${a.tappe.map(t=>`<li><b>${esc(t.anno)}</b><span>${esc(t.testo)}</span></li>`).join('')}</ol></div>`:''}
      ${a.collab&&a.collab.length?`<div><p class="eyebrow" style="margin-bottom:10px">Ha lavorato con</p><div class="collabs">${a.collab.map(c=>`<span>${esc(c)}</span>`).join('')}</div></div>`:''}
      <div class="sheet-links">
        ${link(a.spotify,'Spotify')}${link(a.instagram,'Instagram')}${link(a.youtube,'YouTube')}
        <a class="btn solid" href="contatti.html">Booking →</a>
      </div></div></div>`;
  document.body.appendChild(s);document.body.style.overflow='hidden';
  const c=$('canvas',s);if(c)drawTile(c,a.slug,4,.7);
  s.addEventListener('click',e=>{if(e.target===s||e.target.closest('.sheet-close'))closeSheet()});
  $('.sheet-close',s).focus();
  try{history.replaceState(null,'','#'+slug)}catch(e){}
}
function closeSheet(){const s=$('#sheet');if(s){s.remove();document.body.style.overflow=''}}
addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});

/* ---------- Uscite ---------- */
function renderCatalog(f='tutti'){
  const c=$('#catalog');if(!c||typeof USCITE==='undefined')return;
  const limit=+c.dataset.limit||USCITE.length;c.innerHTML='';
  USCITE.filter(u=>f==='tutti'||u.formato===f).slice(0,limit).forEach(u=>{
    const [y,m]=u.data.split('-');const r=document.createElement('a');
    r.className='row';r.href=u.link;r.target='_blank';r.rel='noopener';
    r.innerHTML=`<span class="meta code">${esc(u.cat)}</span><canvas class="cover" aria-hidden="true"></canvas>
      <span class="t"><b>${esc(u.titolo)}</b><span>${esc(u.artista)}</span></span>
      <span class="meta">${esc(u.formato)}</span><span class="meta">${MESI[+m-1]} ${y}</span><span class="go">Ascolta ↗</span>`;
    c.appendChild(r);drawTile($('canvas',r),u.cat);
  });
}
$$('.chip').forEach(b=>b.addEventListener('click',()=>{$$('.chip').forEach(x=>x.setAttribute('aria-pressed',x===b));renderCatalog(b.dataset.f)}));

/* ---------- Playlist ---------- */
function renderPlaylist(){
  const t=$('#tracks');if(t&&typeof PLAYLIST_BRANI!=='undefined'){
    t.innerHTML=PLAYLIST_BRANI.map(b=>`<div class="track"><div><b>${esc(b.titolo)}</b><span>${esc(b.artista)}</span></div><em>${esc(b.durata)}</em></div>`).join('');
  }
  $$('[data-playlist]').forEach(a=>a.href=SITO.playlistUrl);
  const cv=$('#plCover canvas');if(cv)drawTile(cv,'southside-playlist',3,.6);
  const em=$('#spotifyEmbed');
  if(em&&SITO.playlistId&&!em.querySelector('iframe')){
    em.insertAdjacentHTML('afterbegin',`<iframe title="Playlist ufficiale Southside Ent su Spotify" src="https://open.spotify.com/embed/playlist/${encodeURIComponent(SITO.playlistId)}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`);
  }
}

/* ---------- Eventi ---------- */
function renderEvents(){
  const e=$('#events');if(!e||typeof EVENTI==='undefined')return;
  const limit=+e.dataset.limit||EVENTI.length;
  const lab={biglietti:"Biglietti ↗",gratis:"Ingresso libero",soldout:"Sold out"};
  e.innerHTML=EVENTI.slice(0,limit).map(v=>{const [y,m,d]=v.data.split('-');return `<div class="ev">
    <div class="date"><b>${d}</b><span>${MESI[+m-1]} ${y}</span></div>
    <div class="who"><b>${esc(v.artista)}</b><span>${esc(v.citta)}</span></div>
    <div class="where">${esc(v.luogo)}</div>
    <a class="btn ${v.stato==='soldout'?'soldout':v.stato==='biglietti'?'solid':''}" href="${esc(v.link)}" target="_blank" rel="noopener">${lab[v.stato]||'Info'}</a></div>`}).join('');
}

/* ---------- Social ---------- */
$$('[data-social]').forEach(a=>{if(typeof SITO!=='undefined'&&SITO[a.dataset.social])a.href=SITO[a.dataset.social]});

/* ---------- Hero: onde sonore ---------- */
(function(){
  const cv=$('#wave');if(!cv)return;const x=cv.getContext('2d');let w,h,t=0,mx=.6;
  function size(){const d=Math.min(2,devicePixelRatio||1);w=cv.clientWidth;h=cv.clientHeight;cv.width=w*d;cv.height=h*d;x.setTransform(d,0,0,d,0,0)}
  function frame(){
    x.clearRect(0,0,w,h);
    for(let l=0;l<14;l++){
      x.beginPath();const base=h*.35+l*(h*.045);
      for(let i=0;i<=w;i+=6){const p=i/w,env=Math.exp(-Math.pow((p-mx)*3,2));
        const y=base+Math.sin(p*14+t*.9+l*.5)*18*env+Math.sin(p*41-t*1.4+l)*6*env;i?x.lineTo(i,y):x.moveTo(i,y)}
      x.strokeStyle=l===6?css('--oro'):css('--line');x.lineWidth=l===6?1.6:1;x.stroke();
    }
    t+=.016;if(!reduce)requestAnimationFrame(frame);
  }
  addEventListener('pointermove',e=>{mx+=(e.clientX/innerWidth-mx)*.08});
  addEventListener('resize',size);size();frame();
})();

/* ---------- Mappa stilizzata ---------- */
function drawMap(){
  const cv=$('#mapc');if(!cv)return;const d=Math.min(2,devicePixelRatio||1),w=cv.clientWidth,h=cv.clientHeight;
  cv.width=w*d;cv.height=h*d;const x=cv.getContext('2d');x.scale(d,d);
  x.fillStyle=css('--ink-2');x.fillRect(0,0,w,h);
  x.fillStyle=css('--ink');x.beginPath();x.moveTo(w*.86,0);x.bezierCurveTo(w*.8,h*.4,w*.92,h*.7,w*.84,h);x.lineTo(w,h);x.lineTo(w,0);x.fill();
  x.strokeStyle=css('--line');x.lineWidth=1;x.save();x.translate(w/2,h/2);x.rotate(-.32);
  for(let i=-w;i<w;i+=38){x.beginPath();x.moveTo(i,-h*1.5);x.lineTo(i,h*1.5);x.stroke()}
  for(let j=-h*1.5;j<h*1.5;j+=30){x.beginPath();x.moveTo(-w,j);x.lineTo(w,j);x.stroke()}
  x.strokeStyle=css('--tufo-dim');x.lineWidth=3;x.beginPath();x.moveTo(-w,6);x.lineTo(w,6);x.stroke();x.restore();
}

/* ---------- Menu mobile ---------- */
const burger=$('#burger'),drawer=$('#drawer');
function setMenu(o){document.body.classList.toggle('menu-open',o);drawer.classList.toggle('open',o);burger.setAttribute('aria-expanded',o);drawer.setAttribute('aria-hidden',!o);document.body.style.overflow=o?'hidden':''}
if(burger){burger.addEventListener('click',()=>setMenu(!drawer.classList.contains('open')));$$('a',drawer).forEach(a=>a.addEventListener('click',()=>setMenu(false)))}

/* ---------- Copia negli appunti ---------- */
const toast=$('#toast');
function showToast(m){toast.textContent=m;toast.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toast.classList.remove('show'),1800)}
function selectText(el){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}
$$('.copy').forEach(b=>b.addEventListener('click',()=>{
  const v=b.dataset.copy,fb=()=>{selectText(b.previousElementSibling);showToast('Testo selezionato')};
  try{navigator.clipboard.writeText(v).then(()=>showToast('Copiato'),fb)}catch(e){fb()}
}));

/* ---------- Form demo ---------- */
const form=$('#demoForm');
if(form)form.addEventListener('submit',e=>{
  e.preventDefault();const msg=$('#formMsg');msg.hidden=false;msg.classList.remove('err');
  if(!form.checkValidity()){msg.classList.add('err');msg.textContent='Compila nome d’arte, email e link ai brani, e accetta l’informativa privacy.';return}
  const d=Object.fromEntries(new FormData(form));
  const body=`Nome d'arte: ${d.nome}\nEmail: ${d.email}\nCittà: ${d.citta}\nGenere: ${d.genere}\nInteresse: ${d.interesse}\nSocial: ${d.social}\nLink: ${d.link}\n\n${d.messaggio}`;
  location.href=`mailto:${SITO.emailDemo}?subject=${encodeURIComponent('Demo — '+d.nome)}&body=${encodeURIComponent(body)}`;
  msg.innerHTML=`Si sta aprendo la tua app email con la demo già compilata. Se non si apre, scrivi a <b>${esc(SITO.emailDemo)}</b>.`;
});

$$('.yr').forEach(y=>y.textContent=new Date().getFullYear());
function renderAll(){renderRoster();renderCatalog(($('.chip[aria-pressed="true"]')||{dataset:{f:'tutti'}}).dataset.f);renderPlaylist();renderEvents();drawMap()}
renderAll();
const h=location.hash.slice(1);if(h&&$('#rosterGrid:not([data-limit])'))openArtist(h);
let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(renderAll,200)});
})();
