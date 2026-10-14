ISA.status().then(function (s) { if (s.info && s.info.email) document.getElementById("pv-contact").textContent = " – contatto: " + s.info.email; }).catch(function () {});
