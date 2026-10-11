-- Omaggi e assaggi offerti ai passanti: scaricano il magazzino a prezzo zero
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_waste_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_waste_reason_check
    CHECK (waste_reason IS NULL OR waste_reason IN ('danneggiato','scaduto','sprecato','omaggio','altro'));

CREATE TABLE giveaways (
    id           serial PRIMARY KEY,
    given_at     timestamptz NOT NULL DEFAULT now(),
    notes        text,
    cost_total   numeric(14,4) NOT NULL DEFAULT 0,
    user_id      int REFERENCES users(id),
    voided_at    timestamptz,
    voided_by    int REFERENCES users(id),
    void_reason  text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX giveaways_at_idx ON giveaways (given_at);

CREATE TABLE giveaway_lines (
    id           serial PRIMARY KEY,
    giveaway_id  int NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    product_id   int NOT NULL REFERENCES products(id),
    qty          numeric(14,4) NOT NULL CHECK (qty > 0),
    unit_cost    numeric(16,6) NOT NULL DEFAULT 0
);
