// Isaa Rolls — modulo richieste per eventi e catering
(function () {
  const $ = (id) => document.getElementById(id);
  const form = $("form"), msg = $("form-msg"), send = $("send");
  const TYPES = ["Matrimonio", "Compleanno / festa privata", "Evento aziendale", "Battesimo / comunione", "Fiera / mercatino", "Altro"];
  const fill = (types) => {
    const sel = $("event_type");
    sel.length = 1;
    for (const t of types) { const o = document.createElement("option"); o.value = o.textContent = t; sel.appendChild(o); }
  };
  fill(TYPES);
  const d = new Date(); $("event_date").min = d.toISOString().slice(0, 10);

  ISA.status().then((s) => {
    ISA.socials(s.info, $("socials"));
    if (s.event_types) fill(s.event_types);
    if (s.info && s.info.whatsapp) {
      const wa = $("wa");
      wa.href = ISA.wa(s.info.whatsapp) + "?text=" + encodeURIComponent("Ciao Isaa Rolls! Vorrei informazioni per un evento.");
      wa.innerHTML = ISA.ICONS.whatsapp + "<span>Scrivici su WhatsApp</span>";
      wa.classList.remove("hidden");
    }
  }).catch(() => {});

  const show = (text, ok) => { msg.textContent = text; msg.className = "form-msg " + (ok ? "ok" : "err"); msg.scrollIntoView({ behavior: "smooth", block: "center" }); };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      name: (f.get("name") || "").trim(), phone: (f.get("phone") || "").trim(), email: (f.get("email") || "").trim(),
      event_type: f.get("event_type") || "", event_date: f.get("event_date") || null, place: (f.get("place") || "").trim(),
      guests: f.get("guests") ? parseInt(f.get("guests"), 10) : null, message: (f.get("message") || "").trim() || null,
      privacy: !!f.get("privacy"), website: f.get("website") || "",
    };
    const missing = [];
    if (body.name.length < 2) missing.push("nome");
    if (body.phone.replace(/\D/g, "").length < 6) missing.push("telefono");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) missing.push("e-mail");
    if (!body.event_type) missing.push("tipo di evento");
    if (body.place.length < 2) missing.push("luogo");
    if (missing.length) return show("Controlla questi campi: " + missing.join(", ") + ".", false);
    if (!body.privacy) return show("Per inviare la richiesta spunta il consenso all'informativa privacy.", false);
    send.disabled = true; send.textContent = "Invio in corso…";
    try {
      const r = await fetch("/api/public/event-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || (j.details && j.details[0] && j.details[0].message) || "Invio non riuscito");
      form.reset();
      show("Grazie! Abbiamo ricevuto la tua richiesta: ti ricontattiamo al più presto.", true);
    } catch (err) {
      show(err.message || "Invio non riuscito: riprova tra poco.", false);
    } finally {
      send.disabled = false; send.textContent = "Invia la richiesta";
    }
  });
})();
