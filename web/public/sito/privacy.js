ISA.status().then(function (s) {
  ISA.apply(s);
  var i = s.info || {}, parts = [];
  if (i.legal_name) parts.push(i.legal_name);
  if (i.vat) parts.push(ISA.t("P.IVA ", "VAT ") + i.vat);
  if (i.address) parts.push(ISA.t("sede: ", "registered office: ") + i.address);
  if (i.email) parts.push(ISA.t("contatto: ", "contact: ") + i.email);
  if (parts.length) document.getElementById("pv-contact").textContent = " – " + parts.join(", ");
}).catch(function () {});
