// Isaa Rolls — modulo richieste per eventi e catering
(function () {
  const $ = (id) => document.getElementById(id);
  const form = $("form"), msg = $("form-msg"), send = $("send");
  const t = ISA.t;
  const TYPES = ["Matrimonio", "Compleanno / festa privata", "Evento aziendale", "Battesimo / comunione", "Fiera / mercatino", "Altro"];
  // il valore inviato resta in italiano (è quello che vedete nel gestionale), l'etichetta segue la lingua della pagina
  const EN_TYPES = { "Matrimonio": "Wedding", "Compleanno / festa privata": "Birthday / private party", "Evento aziendale": "Corporate event",
    "Battesimo / comunione": "Christening / communion", "Fiera / mercatino": "Fair / market", "Altro": "Other" };
  const fill = (types) => {
    const sel = $("event_type");
    sel.length = 1;
    for (const ty of types) { const o = document.createElement("option"); o.value = ty; o.textContent = ISA.EN ? (EN_TYPES[ty] || ty) : ty; sel.appendChild(o); }
  };
  fill(TYPES);
  const d = new Date(); $("event_date").min = d.toISOString().slice(0, 10);

  ISA.status().then((s) => {
    ISA.apply(s);
    if (s.event_types) fill(s.event_types);
    if (s.info && s.info.whatsapp) {
      const wa = $("wa");
      wa.href = ISA.wa(s.info.whatsapp) + "?text=" + encodeURIComponent(t("Ciao Isaa Rolls! Vorrei informazioni per un evento.", "Hi Isaa Rolls! I'd like some information about an event."));
      wa.innerHTML = ISA.ICONS.whatsapp + "<span>" + t("Scrivici su WhatsApp", "Message us on WhatsApp") + "</span>";
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
    if (body.name.length < 2) missing.push(t("nome", "name"));
    if (body.phone.replace(/\D/g, "").length < 6) missing.push(t("telefono", "phone"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) missing.push("e-mail");
    if (!body.event_type) missing.push(t("tipo di evento", "type of event"));
    if (body.place.length < 2) missing.push(t("luogo", "venue"));
    if (missing.length) return show(t("Controlla questi campi: ", "Please check these fields: ") + missing.join(", ") + ".", false);
    if (!body.privacy) return show(t("Per inviare la richiesta spunta il consenso all'informativa privacy.", "To send the request, please tick the privacy consent box."), false);
    send.disabled = true; send.textContent = t("Invio in corso…", "Sending…");
    try {
      const r = await fetch("/api/public/event-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(ISA.EN ? "Sending failed: please check the fields or message us on WhatsApp." : (j.error || (j.details && j.details[0] && j.details[0].message) || "Invio non riuscito"));
      form.reset();
      show(t("Grazie! Abbiamo ricevuto la tua richiesta: ti ricontattiamo al più presto.", "Thank you! We've received your request and will get back to you soon."), true);
    } catch (err) {
      show(err.message || t("Invio non riuscito: riprova tra poco.", "Sending failed: please try again shortly."), false);
    } finally {
      send.disabled = false; send.textContent = t("Invia la richiesta", "Send request");
    }
  });
})();
