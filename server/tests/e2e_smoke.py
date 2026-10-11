"""Prova di tutte le schermate in un browser reale (facoltativa).

    pip install playwright && playwright install chromium
    BASE_URL=http://localhost:8000 ADMIN_EMAIL=... ADMIN_PASSWORD=... python tests/e2e_smoke.py
Segnala errori JavaScript, chiamate API fallite e riquadri di errore su ogni pagina.
"""
import os

from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE_URL", "http://localhost:8000")
OUT = os.environ.get("OUT", ".")
routes = ["/", "/cassa", "/vendite", "/vendite/100", "/chiusura", "/incassi", "/incassi~tab=ricevuti", "/magazzino", "/magazzino/1", "/magazzino/15",
 "/magazzino~tab=movimenti", "/magazzino~tab=inventari", "/prodotti", "/prodotti/1", "/spese", "/spese/1", "/fornitori", "/fornitori/1", "/ordini", "/ordini/nuovo",
 "/ricevimento", "/report", "/report~tab=confronto", "/report~tab=analisi", "/utenti", "/impostazioni", "/cambia-password"]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width":1366,"height":850}).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append((pg.url, str(e))))
    api_err=[]; pg.on("response", lambda r: api_err.append((r.status, r.url)) if "/api/" in r.url and r.status >= 400 and "auth/me" not in r.url else None)
    pg.goto(BASE + "/"); pg.wait_for_timeout(500)
    pg.fill("input[type=email]",os.environ["ADMIN_EMAIL"]); pg.fill("input[type=password]",os.environ["ADMIN_PASSWORD"]); pg.click("button[type=submit]"); pg.wait_for_timeout(1200)
    for r in routes:
        pg.goto(BASE + "/#"+r.replace("~","?")); pg.wait_for_timeout(1300)
        eb = pg.locator(".error-box").all_inner_texts()
        if eb: print("ERRORBOX", r, eb)
    # drill dalla dashboard
    pg.goto(BASE + "/#/"); pg.wait_for_timeout(1800)
    pg.click("text=Materie prime consumate"); pg.wait_for_timeout(1200)
    pg.screenshot(path=f"{OUT}/drill.png")
    pg.keyboard.press("Escape")
    # nuova spesa
    pg.goto(BASE + "/#/spese"); pg.wait_for_timeout(1000)
    pg.click("button:has-text('Nuova spesa')"); pg.wait_for_timeout(500)
    m = pg.locator(".modal")
    m.locator("label:has-text('Descrizione') input").first.fill("Riparazione impastatrice")
    m.locator("label:has-text('Categoria') select").select_option(label="Manutenzione")
    m.locator("label:has-text('Imponibile') input").fill("150,50")
    pg.screenshot(path=f"{OUT}/expense-modal.png")
    m.locator("button:has-text('Registra spesa')").click(); pg.wait_for_timeout(1500)
    print("after expense url:", pg.url)
    pg.click("button:has-text('Registra pagamento')"); pg.wait_for_timeout(400)
    pg.locator(".modal button:has-text('Registra pagamento')").click(); pg.wait_for_timeout(1200)
    print("status badge:", pg.locator(".stat .badge").all_inner_texts())
    # editor ricetta con anteprima
    pg.goto(BASE + "/#/prodotti/2"); pg.wait_for_timeout(1200)
    pg.click("button:has-text('Modifica ricetta')"); pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{OUT}/recipe-editor.png", full_page=True)
    print("page errors:", errs); print("api errors:", api_err[:10])
    b.close()
