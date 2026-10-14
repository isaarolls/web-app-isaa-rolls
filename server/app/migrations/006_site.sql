-- Sito pubblico: posizione della bici e richieste per eventi / catering
CREATE TABLE bike_status (
    id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_open     boolean NOT NULL DEFAULT false,
    mode        text NOT NULL DEFAULT 'fissa' CHECK (mode IN ('live', 'fissa')),
    lat         numeric(9,6),
    lng         numeric(9,6),
    accuracy_m  int,
    message     text,
    updated_at  timestamptz,
    opened_at   timestamptz,
    updated_by  int REFERENCES users(id)
);
INSERT INTO bike_status(id) VALUES (1);

CREATE TABLE event_requests (
    id          serial PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    name        text NOT NULL,
    phone       text NOT NULL,
    email       text NOT NULL,
    event_type  text NOT NULL,
    event_date  date,
    place       text NOT NULL,
    guests      int,
    message     text,
    status      text NOT NULL DEFAULT 'nuova' CHECK (status IN ('nuova', 'in_contatto', 'preventivo', 'confermato', 'persa')),
    notes       text,
    ip          text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  int REFERENCES users(id)
);
CREATE INDEX event_requests_created_idx ON event_requests (created_at DESC);

CREATE TABLE public_posts (ip text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX public_posts_idx ON public_posts (ip, at);

INSERT INTO settings(key, value) VALUES ('site', '{"instagram": "", "tiktok": "", "whatsapp": "", "phone": "", "email": "", "notify_email": ""}')
ON CONFLICT (key) DO NOTHING;
