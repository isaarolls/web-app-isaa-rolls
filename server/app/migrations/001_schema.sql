-- Isaa Rolls Manager — schema iniziale
-- Convenzioni:
--   importi in euro NUMERIC(14,2); quantità NUMERIC(14,4); costi unitari NUMERIC(16,6)
--   le date/ore sono timestamptz; il fuso dell'attività è Europe/Rome
--   i movimenti di magazzino e il registro attività sono immutabili (vedi trigger)

-- =====================================================================
-- Impostazioni, utenti, ruoli, sessioni, audit
-- =====================================================================
CREATE TABLE settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE roles (
    id          serial PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text,
    is_system   boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
    role_id    int  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission text NOT NULL,
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
    id                   serial PRIMARY KEY,
    email                text NOT NULL,
    full_name            text NOT NULL,
    password_hash        text NOT NULL,
    role_id              int  NOT NULL REFERENCES roles(id),
    is_active            boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    failed_logins        int NOT NULL DEFAULT 0,
    locked_until         timestamptz,
    last_login_at        timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    anonymized_at        timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- Eccezioni ai permessi del ruolo, per singolo utente (concessione o revoca)
CREATE TABLE user_permissions (
    user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission text NOT NULL,
    granted    boolean NOT NULL,
    PRIMARY KEY (user_id, permission)
);

CREATE TABLE sessions (
    id           bigserial PRIMARY KEY,
    token_hash   text NOT NULL UNIQUE,
    user_id      int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    ip           text,
    user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_resets (
    token_hash text PRIMARY KEY,
    user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE TABLE login_attempts (
    id    bigserial PRIMARY KEY,
    email text,
    ip    text,
    at    timestamptz NOT NULL DEFAULT now(),
    ok    boolean NOT NULL
);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, at);

CREATE TABLE audit_log (
    id        bigserial PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    user_id   int REFERENCES users(id),
    action    text NOT NULL,         -- create | update | void | delete | login | ...
    entity    text NOT NULL,         -- es. 'sale', 'expense', 'item'
    entity_id text,
    summary   text,
    before    jsonb,
    after     jsonb,
    ip        text
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_at_idx ON audit_log (at DESC);

-- =====================================================================
-- Anagrafiche di base
-- =====================================================================
CREATE TABLE units (
    code      text PRIMARY KEY,           -- kg, g, l, ml, pz, conf ...
    name      text NOT NULL,
    dimension text NOT NULL,              -- massa | volume | pezzi | <personalizzata>
    factor    numeric(20,10) NOT NULL DEFAULT 1   -- fattore verso l'unità base della dimensione
);

CREATE TABLE item_categories (
    id   serial PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE product_categories (
    id         serial PRIMARY KEY,
    name       text NOT NULL UNIQUE,
    sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE suppliers (
    id             serial PRIMARY KEY,
    legal_name     text NOT NULL,
    trade_name     text,
    vat_number     text,
    tax_code       text,
    email          text,
    phone          text,
    contact_person text,
    address        text,
    city           text,
    zip            text,
    province       text,
    lead_time_days int,
    payment_terms  text,
    payment_days   int,           -- giorni per calcolare la scadenza predefinita
    notes          text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Conti di liquidità: cassa contanti, banca, ecc.
CREATE TABLE accounts (
    id              serial PRIMARY KEY,
    name            text NOT NULL UNIQUE,
    kind            text NOT NULL CHECK (kind IN ('cassa','banca','altro')),
    opening_balance numeric(14,2) NOT NULL DEFAULT 0,
    opening_date    date NOT NULL DEFAULT current_date,
    is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE payment_methods (
    id                 serial PRIMARY KEY,
    name               text NOT NULL UNIQUE,
    kind               text NOT NULL DEFAULT 'altro' CHECK (kind IN ('contanti','carta','elettronico','piattaforma','altro')),
    account_id         int REFERENCES accounts(id),
    received_immediately boolean NOT NULL DEFAULT true,   -- false = genera un credito da incassare
    is_active          boolean NOT NULL DEFAULT true,
    sort_order         int NOT NULL DEFAULT 0
);

CREATE TABLE sales_channels (
    id                    serial PRIMARY KEY,
    name                  text NOT NULL UNIQUE,
    commission_pct        numeric(7,4) NOT NULL DEFAULT 0,   -- % sul lordo
    commission_fixed      numeric(14,2) NOT NULL DEFAULT 0,  -- € per ordine
    commission_vat_rate   numeric(5,2) NOT NULL DEFAULT 22,  -- IVA applicata dalla piattaforma sulla commissione
    default_payment_method_id int REFERENCES payment_methods(id),
    is_active             boolean NOT NULL DEFAULT true,
    sort_order            int NOT NULL DEFAULT 0
);

-- =====================================================================
-- Magazzino
-- =====================================================================
CREATE TABLE items (
    id                  serial PRIMARY KEY,
    sku                 text NOT NULL,
    name                text NOT NULL,
    kind                text NOT NULL DEFAULT 'materia_prima'
                        CHECK (kind IN ('materia_prima','semilavorato','confezione','rivendita','consumabile')),
    category_id         int REFERENCES item_categories(id),
    description         text,
    unit_code           text NOT NULL REFERENCES units(code),
    default_supplier_id int REFERENCES suppliers(id),
    min_qty             numeric(14,4) NOT NULL DEFAULT 0,
    vat_rate            numeric(5,2) NOT NULL DEFAULT 10,
    last_purchase_price numeric(16,6),           -- prezzo netto dell'ultimo acquisto, per unità di magazzino
    last_purchase_date  date,
    location            text,
    track_lots          boolean NOT NULL DEFAULT false,
    -- solo semilavorati: 'esplodi' = alla vendita si scaricano direttamente gli ingredienti;
    --                    'produzione' = si registra la produzione e si scarica il semilavorato
    semi_mode           text NOT NULL DEFAULT 'esplodi' CHECK (semi_mode IN ('esplodi','produzione')),
    notes               text,
    is_active           boolean NOT NULL DEFAULT true,
    -- valori derivati, aggiornati SOLO dalle funzioni di movimentazione nella stessa transazione
    qty_on_hand         numeric(14,4) NOT NULL DEFAULT 0,
    avg_cost            numeric(16,6) NOT NULL DEFAULT 0,  -- costo medio ponderato netto per unità
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX items_sku_uq ON items (lower(sku));
CREATE INDEX items_name_idx ON items (lower(name));

CREATE TABLE stock_lots (
    id            serial PRIMARY KEY,
    item_id       int NOT NULL REFERENCES items(id),
    lot_code      text,
    expiry_date   date,
    qty_remaining numeric(14,4) NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_item_idx ON stock_lots (item_id, expiry_date);

CREATE TABLE stock_movements (
    id            bigserial PRIMARY KEY,
    item_id       int  NOT NULL REFERENCES items(id),
    at            timestamptz NOT NULL DEFAULT now(),
    type          text NOT NULL CHECK (type IN (
                     'giacenza_iniziale','acquisto','carico','produzione_carico',
                     'scarico','consumo_vendita','produzione_scarico','spreco',
                     'rettifica_inventario','reso_fornitore','storno')),
    qty           numeric(14,4) NOT NULL CHECK (qty <> 0),   -- con segno, in unità di magazzino
    unit_cost     numeric(16,6) NOT NULL,                     -- netto IVA
    value         numeric(14,4) NOT NULL,                     -- qty * unit_cost (con segno)
    qty_after     numeric(14,4) NOT NULL,
    avg_cost_after numeric(16,6) NOT NULL,
    reason        text,
    waste_reason  text CHECK (waste_reason IS NULL OR waste_reason IN ('danneggiato','scaduto','sprecato','altro')),
    lot_id        int REFERENCES stock_lots(id),
    ref_type      text,      -- sale | goods_receipt | inventory_count | production | movement
    ref_id        bigint,
    reversal_of   bigint REFERENCES stock_movements(id),
    user_id       int REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_mov_item_idx ON stock_movements (item_id, at);
CREATE INDEX stock_mov_at_idx ON stock_movements (at);
CREATE INDEX stock_mov_ref_idx ON stock_movements (ref_type, ref_id);
CREATE UNIQUE INDEX stock_mov_reversal_uq ON stock_movements (reversal_of) WHERE reversal_of IS NOT NULL;

CREATE TABLE inventory_counts (
    id           serial PRIMARY KEY,
    count_date   timestamptz NOT NULL DEFAULT now(),
    status       text NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza','confermato','annullato')),
    notes        text,
    created_by   int REFERENCES users(id),
    confirmed_by int REFERENCES users(id),
    confirmed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_count_lines (
    id           serial PRIMARY KEY,
    count_id     int NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
    item_id      int NOT NULL REFERENCES items(id),
    counted_qty  numeric(14,4),
    expected_qty numeric(14,4),      -- fissata alla conferma
    difference   numeric(14,4),
    UNIQUE (count_id, item_id)
);

-- =====================================================================
-- Prodotti di vendita e ricette (distinte base con versioni)
-- =====================================================================
CREATE TABLE products (
    id                serial PRIMARY KEY,
    code              text,
    name              text NOT NULL,
    category_id       int REFERENCES product_categories(id),
    description       text,
    sale_price        numeric(14,2) NOT NULL DEFAULT 0,   -- prezzo al pubblico IVA inclusa
    vat_rate          numeric(5,2) NOT NULL DEFAULT 10,
    target_margin_pct numeric(6,2),                       -- null = valore predefinito nelle impostazioni
    unload_stock      boolean NOT NULL DEFAULT true,      -- scarica ingredienti alla vendita
    is_active         boolean NOT NULL DEFAULT true,
    sort_order        int NOT NULL DEFAULT 0,
    color             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX products_code_uq ON products (lower(code)) WHERE code IS NOT NULL AND code <> '';

-- Una ricetta appartiene a un prodotto di vendita OPPURE a un articolo semilavorato
CREATE TABLE recipe_versions (
    id          serial PRIMARY KEY,
    product_id  int REFERENCES products(id),
    item_id     int REFERENCES items(id),
    version_no  int NOT NULL,
    valid_from  timestamptz NOT NULL DEFAULT now(),
    yield_qty   numeric(14,4) NOT NULL DEFAULT 1 CHECK (yield_qty > 0),  -- resa: unità prodotte (per i semilavorati, in unità di magazzino)
    notes       text,
    created_by  int REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((product_id IS NULL) <> (item_id IS NULL))
);
CREATE UNIQUE INDEX recipe_versions_prod_uq ON recipe_versions (product_id, version_no) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX recipe_versions_item_uq ON recipe_versions (item_id, version_no) WHERE item_id IS NOT NULL;

CREATE TABLE recipe_lines (
    id                serial PRIMARY KEY,
    recipe_version_id int NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
    item_id           int NOT NULL REFERENCES items(id),
    qty               numeric(14,4) NOT NULL CHECK (qty > 0),
    unit_code         text NOT NULL REFERENCES units(code),
    waste_pct         numeric(6,2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct < 100),
    sort_order        int NOT NULL DEFAULT 0
);

CREATE TABLE productions (
    id                serial PRIMARY KEY,
    item_id           int NOT NULL REFERENCES items(id),
    recipe_version_id int NOT NULL REFERENCES recipe_versions(id),
    qty_produced      numeric(14,4) NOT NULL CHECK (qty_produced > 0),
    produced_at       timestamptz NOT NULL DEFAULT now(),
    total_cost        numeric(14,4) NOT NULL,
    notes             text,
    user_id           int REFERENCES users(id),
    voided_at         timestamptz,
    voided_by         int REFERENCES users(id),
    void_reason       text
);

-- =====================================================================
-- Vendite e incassi
-- =====================================================================
CREATE SEQUENCE sale_number_seq;

CREATE TABLE sales (
    id                bigserial PRIMARY KEY,
    number            bigint NOT NULL DEFAULT nextval('sale_number_seq') UNIQUE,
    sold_at           timestamptz NOT NULL DEFAULT now(),
    business_date     date NOT NULL,                         -- giorno lavorativo (Europe/Rome)
    kind              text NOT NULL DEFAULT 'vendita' CHECK (kind IN ('vendita','rimborso')),
    mode              text NOT NULL DEFAULT 'analitica' CHECK (mode IN ('analitica','riepilogo')),
    channel_id        int NOT NULL REFERENCES sales_channels(id),
    refund_of         bigint REFERENCES sales(id),
    gross_before_discount numeric(14,2) NOT NULL,            -- somma righe a prezzo pieno IVA inclusa
    discount_total    numeric(14,2) NOT NULL DEFAULT 0,      -- sconti IVA inclusa
    gross_total       numeric(14,2) NOT NULL,                -- totale incassabile IVA inclusa (negativo per i rimborsi)
    net_total         numeric(14,2) NOT NULL,                -- imponibile
    vat_total         numeric(14,2) NOT NULL,
    commission_gross  numeric(14,2) NOT NULL DEFAULT 0,      -- commissione trattenuta dalla piattaforma (IVA inclusa)
    commission_net    numeric(14,2) NOT NULL DEFAULT 0,
    commission_vat    numeric(14,2) NOT NULL DEFAULT 0,
    cost_total        numeric(14,4) NOT NULL DEFAULT 0,      -- costo teorico materie prime (da ricetta, al momento della vendita)
    notes             text,
    status            text NOT NULL DEFAULT 'valida' CHECK (status IN ('valida','annullata')),
    user_id           int REFERENCES users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    voided_at         timestamptz,
    voided_by         int REFERENCES users(id),
    void_reason       text
);
CREATE INDEX sales_date_idx ON sales (business_date);
CREATE INDEX sales_channel_idx ON sales (channel_id, business_date);

CREATE TABLE sale_lines (
    id                bigserial PRIMARY KEY,
    sale_id           bigint NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id        int REFERENCES products(id),
    description       text,
    qty               numeric(14,4) NOT NULL,
    unit_price        numeric(14,2) NOT NULL,       -- IVA inclusa, prima dello sconto
    discount          numeric(14,2) NOT NULL DEFAULT 0,  -- sconto sulla riga, IVA inclusa
    line_total        numeric(14,2) NOT NULL,       -- IVA inclusa
    vat_rate          numeric(5,2) NOT NULL,
    line_net          numeric(14,2) NOT NULL,
    line_vat          numeric(14,2) NOT NULL,
    recipe_version_id int REFERENCES recipe_versions(id),
    unit_cost         numeric(16,6) NOT NULL DEFAULT 0      -- costo teorico unitario al momento della vendita
);
CREATE INDEX sale_lines_sale_idx ON sale_lines (sale_id);
CREATE INDEX sale_lines_product_idx ON sale_lines (product_id);

-- Incassi delle vendite: una vendita può avere più pagamenti; 'in_attesa' = credito da incassare
CREATE TABLE sale_payments (
    id                bigserial PRIMARY KEY,
    sale_id           bigint NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method_id         int NOT NULL REFERENCES payment_methods(id),
    amount            numeric(14,2) NOT NULL,      -- importo lordo pagato dal cliente (negativo per rimborsi)
    status            text NOT NULL CHECK (status IN ('incassato','in_attesa','annullato')),
    received_at       date,                        -- data di incasso effettivo
    received_amount   numeric(14,2),               -- importo effettivamente accreditato (può essere al netto commissioni)
    account_id        int REFERENCES accounts(id),
    settlement_id     int,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_status_idx ON sale_payments (status, received_at);

-- Accrediti cumulativi delle piattaforme (es. bonifico Glovo settimanale)
CREATE TABLE settlements (
    id           serial PRIMARY KEY,
    channel_id   int REFERENCES sales_channels(id),
    received_at  date NOT NULL,
    account_id   int NOT NULL REFERENCES accounts(id),
    amount       numeric(14,2) NOT NULL,     -- importo accreditato
    notes        text,
    user_id      int REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    voided_at    timestamptz
);
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_settlement_fk FOREIGN KEY (settlement_id) REFERENCES settlements(id);

-- Chiusura di cassa giornaliera
CREATE TABLE day_closures (
    business_date date PRIMARY KEY,
    expected      jsonb NOT NULL,     -- {method_id: importo atteso}
    counted       jsonb NOT NULL,     -- {method_id: importo contato}
    difference    numeric(14,2) NOT NULL,
    notes         text,
    closed_by     int REFERENCES users(id),
    closed_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Spese, pagamenti, ricorrenze
-- =====================================================================
CREATE TABLE expense_categories (
    id                  serial PRIMARY KEY,
    name                text NOT NULL UNIQUE,
    -- gruppo del conto economico gestionale
    pl_group            text NOT NULL CHECK (pl_group IN (
                           'materie_prime','costi_variabili','costi_fissi','personale',
                           'altri_operativi','oneri_finanziari','imposte','investimenti','non_economica')),
    is_inventory        boolean NOT NULL DEFAULT false,  -- acquisti che entrano in magazzino (costo rilevato al consumo)
    is_platform_commission boolean NOT NULL DEFAULT false, -- fatture commissioni piattaforme (già stimate sulle vendite)
    amortization_months int,                             -- se valorizzato: costo ripartito in N mesi
    is_active           boolean NOT NULL DEFAULT true,
    sort_order          int NOT NULL DEFAULT 0
);

CREATE TABLE recurring_expenses (
    id              serial PRIMARY KEY,
    description     text NOT NULL,
    category_id     int NOT NULL REFERENCES expense_categories(id),
    supplier_id     int REFERENCES suppliers(id),
    net_amount      numeric(14,2) NOT NULL,
    vat_rate        numeric(5,2) NOT NULL DEFAULT 0,
    vat_deductible  boolean NOT NULL DEFAULT true,
    frequency       text NOT NULL CHECK (frequency IN ('mensile','bimestrale','trimestrale','semestrale','annuale')),
    day_of_month    int NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
    start_date      date NOT NULL,
    end_date        date,
    due_days        int NOT NULL DEFAULT 0,
    last_generated  date,
    is_active       boolean NOT NULL DEFAULT true,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Acquisti: ordini e ricevimenti merce
-- =====================================================================
CREATE SEQUENCE po_number_seq;

CREATE TABLE purchase_orders (
    id            serial PRIMARY KEY,
    number        text NOT NULL UNIQUE,
    supplier_id   int NOT NULL REFERENCES suppliers(id),
    order_date    date NOT NULL DEFAULT current_date,
    expected_date date,
    status        text NOT NULL DEFAULT 'bozza'
                  CHECK (status IN ('bozza','inviato','parziale','ricevuto','chiuso','annullato')),
    notes         text,
    created_by    int REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_lines (
    id           serial PRIMARY KEY,
    po_id        int NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id      int NOT NULL REFERENCES items(id),
    qty_ordered  numeric(14,4) NOT NULL CHECK (qty_ordered > 0),
    unit_price   numeric(16,6) NOT NULL DEFAULT 0,  -- netto IVA, per unità di magazzino
    vat_rate     numeric(5,2) NOT NULL DEFAULT 10,
    qty_received numeric(14,4) NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipts (
    id           serial PRIMARY KEY,
    supplier_id  int REFERENCES suppliers(id),
    po_id        int REFERENCES purchase_orders(id),
    received_at  timestamptz NOT NULL DEFAULT now(),
    doc_ref      text,          -- numero DDT o documento
    notes        text,
    user_id      int REFERENCES users(id),
    voided_at    timestamptz,
    voided_by    int REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE goods_receipt_lines (
    id          serial PRIMARY KEY,
    receipt_id  int NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_line_id  int REFERENCES purchase_order_lines(id),
    item_id     int NOT NULL REFERENCES items(id),
    qty         numeric(14,4) NOT NULL CHECK (qty > 0),
    unit_cost   numeric(16,6) NOT NULL CHECK (unit_cost >= 0),   -- netto IVA per unità di magazzino
    vat_rate    numeric(5,2) NOT NULL DEFAULT 10,
    lot_code    text,
    expiry_date date
);

CREATE TABLE supplier_items (
    supplier_id    int NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    item_id        int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    supplier_code  text,
    unit_price     numeric(16,6),       -- netto, per unità di magazzino
    last_price_at  date,
    lead_time_days int,
    PRIMARY KEY (supplier_id, item_id)
);

CREATE TABLE expenses (
    id               serial PRIMARY KEY,
    description      text NOT NULL,
    category_id      int NOT NULL REFERENCES expense_categories(id),
    supplier_id      int REFERENCES suppliers(id),
    doc_type         text NOT NULL DEFAULT 'fattura' CHECK (doc_type IN ('fattura','ricevuta','scontrino','f24','busta_paga','altro')),
    doc_number       text,
    doc_date         date NOT NULL,
    competence_date  date NOT NULL,        -- mese di competenza nel conto economico
    net_amount       numeric(14,2) NOT NULL,
    vat_amount       numeric(14,2) NOT NULL DEFAULT 0,
    total_amount     numeric(14,2) NOT NULL,
    vat_deductible   boolean NOT NULL DEFAULT true,
    due_date         date,
    paid_amount      numeric(14,2) NOT NULL DEFAULT 0,   -- derivato da expense_payments
    status           text NOT NULL DEFAULT 'da_pagare' CHECK (status IN ('da_pagare','parziale','pagata')),
    recurring_id     int REFERENCES recurring_expenses(id),
    recurring_period date,
    po_id            int REFERENCES purchase_orders(id),
    receipt_id       int REFERENCES goods_receipts(id),
    notes            text,
    voided_at        timestamptz,
    voided_by        int REFERENCES users(id),
    void_reason      text,
    created_by       int REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    version          int NOT NULL DEFAULT 1,
    CHECK (total_amount = net_amount + vat_amount)
);
CREATE INDEX expenses_comp_idx ON expenses (competence_date);
CREATE INDEX expenses_due_idx ON expenses (due_date) WHERE status <> 'pagata' AND voided_at IS NULL;
CREATE UNIQUE INDEX expenses_recurring_uq ON expenses (recurring_id, recurring_period) WHERE recurring_id IS NOT NULL;

CREATE TABLE expense_payments (
    id          serial PRIMARY KEY,
    expense_id  int NOT NULL REFERENCES expenses(id),
    paid_at     date NOT NULL,
    amount      numeric(14,2) NOT NULL CHECK (amount <> 0),
    method_id   int REFERENCES payment_methods(id),
    account_id  int NOT NULL REFERENCES accounts(id),
    notes       text,
    user_id     int REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    voided_at   timestamptz,
    voided_by   int REFERENCES users(id)
);
CREATE INDEX expense_payments_exp_idx ON expense_payments (expense_id);

-- Movimenti di cassa/banca non legati a vendite o spese (versamenti, apporti, prelievi, giroconti)
CREATE TABLE cash_movements (
    id          serial PRIMARY KEY,
    account_id  int NOT NULL REFERENCES accounts(id),
    moved_at    date NOT NULL,
    amount      numeric(14,2) NOT NULL CHECK (amount <> 0),
    kind        text NOT NULL CHECK (kind IN ('giroconto','apporto','prelievo','finanziamento','rettifica','altro')),
    transfer_group uuid,
    description text,
    user_id     int REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    voided_at   timestamptz
);

-- Altre componenti economiche manuali (ricavi diversi, accantonamenti, ammortamenti manuali...)
CREATE TABLE economic_entries (
    id          serial PRIMARY KEY,
    entry_date  date NOT NULL,
    pl_group    text NOT NULL CHECK (pl_group IN ('altri_ricavi','costi_variabili','costi_fissi','personale',
                                                  'altri_operativi','oneri_finanziari','imposte','altre_componenti')),
    amount      numeric(14,2) NOT NULL,   -- positivo = ricavo per 'altri_ricavi', costo per gli altri gruppi
    description text NOT NULL,
    user_id     int REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    voided_at   timestamptz
);

-- =====================================================================
-- Allegati (salvati nel database: inclusi automaticamente nei backup)
-- =====================================================================
CREATE TABLE attachments (
    id          serial PRIMARY KEY,
    owner_type  text NOT NULL CHECK (owner_type IN ('expense','supplier','goods_receipt','purchase_order')),
    owner_id    int NOT NULL,
    filename    text NOT NULL,
    mime        text NOT NULL,
    size_bytes  int NOT NULL,
    content     bytea NOT NULL,
    uploaded_by int REFERENCES users(id),
    uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_owner_idx ON attachments (owner_type, owner_id);

-- =====================================================================
-- Chiusura dei periodi (mesi chiusi non modificabili)
-- =====================================================================
CREATE TABLE period_closures (
    period     date PRIMARY KEY,    -- primo giorno del mese
    closed_at  timestamptz NOT NULL DEFAULT now(),
    closed_by  int REFERENCES users(id),
    snapshot   jsonb                -- conto economico al momento della chiusura
);

-- =====================================================================
-- Immutabilità: movimenti di magazzino e registro attività
-- =====================================================================
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'I record di % non possono essere modificati o cancellati: usare uno storno', TG_TABLE_NAME
        USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Blocco delle registrazioni nei mesi chiusi (controllo anche a livello di database)
CREATE FUNCTION check_period_open(d date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM period_closures WHERE period = date_trunc('month', d)::date) THEN
        RAISE EXCEPTION 'Il mese % è chiuso: riaprirlo per registrare o modificare operazioni', to_char(d, 'MM/YYYY')
            USING ERRCODE = 'P0002';
    END IF;
END $$;

CREATE FUNCTION trg_period_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM check_period_open((NEW.at AT TIME ZONE 'Europe/Rome')::date); RETURN NEW; END $$;
CREATE TRIGGER stock_movements_period BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION trg_period_stock();

CREATE FUNCTION trg_period_sales() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM check_period_open(NEW.business_date);
    IF TG_OP = 'UPDATE' THEN PERFORM check_period_open(OLD.business_date); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER sales_period BEFORE INSERT OR UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION trg_period_sales();

CREATE FUNCTION trg_period_expenses() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- modifiche solo di pagamento/stato non toccano la competenza economica
    IF TG_OP = 'UPDATE' AND NEW.competence_date = OLD.competence_date AND NEW.net_amount = OLD.net_amount
       AND NEW.vat_amount = OLD.vat_amount AND NEW.category_id = OLD.category_id
       AND NEW.vat_deductible = OLD.vat_deductible
       AND NEW.voided_at IS NOT DISTINCT FROM OLD.voided_at THEN
        RETURN NEW;
    END IF;
    PERFORM check_period_open(NEW.competence_date);
    IF TG_OP = 'UPDATE' THEN PERFORM check_period_open(OLD.competence_date); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER expenses_period BEFORE INSERT OR UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION trg_period_expenses();

CREATE FUNCTION trg_period_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM check_period_open(NEW.entry_date);
    IF TG_OP = 'UPDATE' THEN PERFORM check_period_open(OLD.entry_date); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER economic_entries_period BEFORE INSERT OR UPDATE ON economic_entries
    FOR EACH ROW EXECUTE FUNCTION trg_period_entries();
