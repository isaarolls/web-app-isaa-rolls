-- Collegamento automatico tra prodotto in vendita e articolo di magazzino "pezzi pronti"
ALTER TABLE products ADD COLUMN stock_item_id int REFERENCES items(id);
CREATE UNIQUE INDEX products_stock_item_uq ON products (stock_item_id) WHERE stock_item_id IS NOT NULL;
