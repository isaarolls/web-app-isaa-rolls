// Isaa Rolls — «Dove siamo»: posizione della bici in tempo reale
(function () {
  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 20000;
  let map = null, marker = null, circle = null, last = null, firstFix = true;
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;

  function ago(min) {
    if (min < 1) return "aggiornata adesso";
    if (min === 1) return "aggiornata 1 minuto fa";
    if (min < 60) return `aggiornata ${min} minuti fa`;
    const h = Math.floor(min / 60);
    return `aggiornata ${h === 1 ? "un'ora" : h + " ore"} fa`;
  }

  function ensureMap(lat, lng) {
    if (map || !window.L) return !!map;
    map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([lat, lng], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const icon = L.divIcon({ className: "", html: '<div class="bike-pin"><img src="img/logo-240.png" alt="Isaa Rolls" /></div>', iconSize: [64, 64], iconAnchor: [32, 76] });
    marker = L.marker([lat, lng], { icon, title: "Isaa Rolls è qui" }).addTo(map);
    circle = L.circle([lat, lng], { radius: 30, color: "#161616", weight: 2, fillColor: "#ff69cd", fillOpacity: 0.18 }).addTo(map);
    return true;
  }

  function fallback(lat, lng) {
    if (window.L) return;
    $("map").innerHTML = `<div class="map-fallback"><div><b>Siamo qui:</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}<br><br>
      Usa i pulsanti qui sotto per aprire la mappa e avere le indicazioni.</div></div>`;
  }

  function render(s) {
    ISA.socials(s.info, $("socials"));
    // Glovo segue gli orari della bici: si ordina solo quando siamo aperti
    const glovo = s.info && s.info.glovo;
    const gb = $("glovo-btn");
    gb.classList.toggle("hidden", !(glovo && s.open)); if (glovo) gb.href = glovo;
    $("glovo-hint").classList.toggle("hidden", !!glovo || !s.open);
    $("glovo-closed").classList.toggle("hidden", !!s.open);
    const pill = $("pill");
    $("msg").textContent = s.message || "";
    if (!s.open) {
      pill.className = "pill closed"; $("pill-text").textContent = "Chiusi";
      $("updated").textContent = "";
      $("open-box").classList.add("hidden"); $("closed-box").classList.remove("hidden"); $("stale").classList.add("hidden");
      if (s.info && s.info.instagram) { $("closed-social").classList.remove("hidden"); $("closed-ig").href = s.info.instagram; }
      return;
    }
    pill.className = "pill open"; $("pill-text").textContent = s.mode === "live" ? "Aperti · in giro" : "Aperti ora";
    $("updated").textContent = "Posizione " + ago(s.minutes_ago);
    $("closed-box").classList.add("hidden"); $("open-box").classList.remove("hidden");
    $("stale").classList.toggle("hidden", !s.stale);
    const { lat, lng } = s;
    $("go").href = isApple ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
    $("gmaps").href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    if (ensureMap(lat, lng)) {
      marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]); circle.setRadius(Math.max(15, Math.min(s.accuracy_m || 30, 300)));
      if (firstFix) { map.setView([lat, lng], 16); firstFix = false; }
      else if (!last || last.lat !== lat || last.lng !== lng) map.panTo([lat, lng], { animate: true });
      setTimeout(() => map.invalidateSize(), 50);
    } else fallback(lat, lng);
    last = { lat, lng };
  }

  async function tick() {
    try { render(await ISA.status()); }
    catch (e) { if (!last) { $("pill-text").textContent = "Non riesco a caricare la posizione"; } }
  }
  tick();
  setInterval(() => { if (document.visibilityState === "visible") tick(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
})();
