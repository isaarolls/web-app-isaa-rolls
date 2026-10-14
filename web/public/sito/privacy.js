ISA.status().then(function (s) { ISA.contacts(s.info); if (s.info && s.info.email) document.getElementById("pv-contact").textContent = " – contatto: " + s.info.email; }).catch(function () {});
