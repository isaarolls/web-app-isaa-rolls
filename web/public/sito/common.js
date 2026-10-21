// Isaa Rolls — funzioni comuni del sito pubblico
(function () {
  const ICONS = {
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c.4 2.3 1.9 3.9 4.2 4.1v3.1c-1.5 0-2.9-.4-4.2-1.2v6.4c0 3.3-2.6 5.6-5.7 5.6-3.2 0-5.6-2.5-5.6-5.6 0-3.4 3-5.9 6.4-5.5v3.2c-1.6-.4-3.2.7-3.2 2.3 0 1.4 1.1 2.5 2.4 2.5 1.5 0 2.6-1 2.6-2.8V3h3.1z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  };
  const wa = (n) => "https://wa.me/" + String(n).replace(/[^\d]/g, "").replace(/^00/, "").replace(/^(?=3\d{8,9}$)/, "39");

  const EN = document.documentElement.lang === "en";
  const t = (it, en) => (EN ? en : it);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.ISA = {
    ICONS, wa, EN, t, esc,
    // applica allo scheletro della pagina i dati presi dal gestionale
    apply(s) {
      const info = s && s.info;
      if (!info) return;
      ISA.socials(info, document.getElementById("socials"));
      ISA.legal(info);
      ISA.review(info);
      const al = document.getElementById("allergens");
      if (al && s.allergen_catalog) ISA.allergens(info.allergens || {}, s.allergen_catalog, al);
    },
    legal(info) {
      const parts = [];
      if (info.legal_name) parts.push(info.legal_name);
      if (info.vat) parts.push(t("P.IVA ", "VAT ") + info.vat);
      if (info.address) parts.push(info.address);
      document.querySelectorAll("[data-legal]").forEach((el) => { el.textContent = parts.join(" · "); el.classList.toggle("hidden", !parts.length); });
    },
    review(info) {
      document.querySelectorAll("[data-review]").forEach((el) => {
        el.classList.toggle("hidden", !info.review);
        const a = el.tagName === "A" ? el : el.querySelector("a[data-review-link]");
        if (a && info.review) a.href = info.review;
      });
    },
    allergens(map, cat, el) {
      const name = Object.fromEntries(cat.allergens.map((a) => [a.code, EN ? a.en : a.it]));
      const rows = cat.items.filter((it) => (map[it.code] || []).length);
      let html = "";
      if (rows.length) {
        html += '<div class="al-list">' + rows.map((it) =>
          `<div class="al-row"><b>${esc(EN ? it.en : it.it)}</b><span>${map[it.code].map((c) => `<i>${esc(name[c] || c)}</i>`).join("")}</span></div>`).join("") + "</div>";
        html += `<p class="note" style="margin-top:12px">${t("Tutto è preparato al momento sulla bici con gli stessi strumenti: ogni prodotto può contenere tracce degli altri allergeni. Se hai un'allergia o un'intolleranza, diccelo prima di ordinare.",
          "Everything is made to order on the bike with the same tools, so every product may contain traces of the other allergens. If you have an allergy or intolerance, please tell us before ordering.")}</p>`;
      } else {
        html = `<p style="margin:0">${t("Hai un'allergia o un'intolleranza? Chiedi al nostro personale prima di ordinare: ti diciamo esattamente cosa contiene ogni prodotto.",
          "Do you have an allergy or intolerance? Ask our staff before ordering: we'll tell you exactly what each product contains.")}</p>`;
      }
      el.innerHTML = html;
    },
    async status() {
      const r = await fetch("/api/public/status", { cache: "no-store" });
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    },
    socials(info, el) {
      if (info) ISA.contacts(info);
      if (!el || !info) return;
      const items = [];
      if (info.instagram) items.push(["Instagram", info.instagram, ICONS.instagram]);
      if (info.tiktok) items.push(["TikTok", info.tiktok, ICONS.tiktok]);
      if (info.whatsapp) items.push(["WhatsApp", wa(info.whatsapp), ICONS.whatsapp]);
      if (info.phone) items.push([info.phone, "tel:" + info.phone.replace(/\s/g, ""), ICONS.phone]);
      if (info.email) items.push([info.email, "mailto:" + info.email, ICONS.email]);
      el.innerHTML = "";
      for (const [label, href, icon] of items) {
        const a = document.createElement("a");
        a.className = "soc"; a.href = href; a.rel = "noopener";
        if (href.startsWith("http")) a.target = "_blank";
        a.innerHTML = icon; a.appendChild(document.createTextNode(label));
        el.appendChild(a);
      }
    },
  };
  // pulsanti fissi WhatsApp e telefono, sempre visibili in basso a destra
  ISA.contacts = function (info) {
    if (!info || document.getElementById("fab")) return;
    const box = document.createElement("div");
    box.id = "fab"; box.className = "fab";
    if (info.whatsapp) {
      const a = document.createElement("a");
      a.className = "fab-btn wa"; a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", t("Scrivici su WhatsApp", "Message us on WhatsApp"));
      a.href = wa(info.whatsapp) + "?text=" + encodeURIComponent(t("Ciao Isaa Rolls! ", "Hi Isaa Rolls! "));
      a.innerHTML = ICONS.whatsapp + "<span>WhatsApp</span>";
      box.appendChild(a);
    }
    if (info.phone) {
      const a = document.createElement("a");
      a.className = "fab-btn tel"; a.href = "tel:" + info.phone.replace(/[^\d+]/g, ""); a.setAttribute("aria-label", t("Chiamaci", "Call us"));
      a.innerHTML = ICONS.phone + "<span>" + t("Chiamaci", "Call us") + "</span>";
      box.appendChild(a);
    }
    if (box.children.length) document.body.appendChild(box);
  };
  const y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
  // ingrandimento delle immagini del menu
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-zoom]");
    if (!a) return;
    e.preventDefault();
    const box = document.createElement("div");
    box.className = "lightbox"; box.innerHTML = `<img src="${a.getAttribute("href")}" alt="" />`;
    box.addEventListener("click", () => box.remove());
    document.body.appendChild(box);
  });
})();
