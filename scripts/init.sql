-- =====================================================================
-- Trocly · PI_4A_12 · ENSAM Meknès · Schéma PostgreSQL 16 (v2.1 : aucun prix stocké, 3FN)
-- Exécution : psql -U trocly -d trocly -f 01_schema.sql
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------- Types énumérés -------------------------------------------
CREATE TYPE user_role          AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE user_status        AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE item_condition     AS ENUM ('neuf', 'comme_neuf', 'tres_bon', 'bon', 'use');
CREATE TYPE listing_status     AS ENUM ('active', 'archived', 'exchanged', 'unavailable');
CREATE TYPE negotiation_status AS ENUM ('open', 'accepted', 'rejected', 'expired', 'cancelled');
CREATE TYPE offer_status       AS ENUM ('pending', 'accepted', 'rejected', 'countered', 'expired', 'cancelled');
CREATE TYPE offer_side         AS ENUM ('give', 'receive');   -- relatif à l'auteur de l'offre
CREATE TYPE message_kind       AS ENUM ('text', 'system');
CREATE TYPE meeting_status     AS ENUM ('proposed', 'accepted', 'validated', 'cancelled', 'expired', 'completed');
CREATE TYPE report_reason      AS ENUM ('misleading', 'forbidden_item', 'fraud', 'inappropriate', 'other');
CREATE TYPE report_status      AS ENUM ('open', 'dismissed', 'actioned');

-- ---------- Fonction utilitaire updated_at ---------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------- Référentiels ---------------------------------------------
CREATE TABLE cities (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  varchar(80) NOT NULL UNIQUE
);

CREATE TABLE categories (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(60) NOT NULL UNIQUE,
  -- Modèle des caractéristiques proposées dans l'app (écran « Caractéristiques »)
  -- ex. [{"key":"marque","label":"Marque","type":"text","required":true}]
  attributes_schema jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- ---------- Utilisateurs ---------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         varchar(13) NOT NULL UNIQUE,
  display_name  varchar(60),                       -- NULL tant que le profil n'est pas complété (étape 3/3)
  avatar_url    text,
  city_id       smallint REFERENCES cities(id),    -- ville principale
  role          user_role   NOT NULL DEFAULT 'user',
  status        user_status NOT NULL DEFAULT 'active',
  suspended_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT users_phone_ma CHECK (phone ~ '^\+212[67][0-9]{8}$')
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refresh_tokens (                       -- déconnexion = révocation (A4/A5)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  char(64) NOT NULL UNIQUE,             -- SHA-256 du refresh token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE TABLE device_tokens (                        -- FCM (C5)
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token  text NOT NULL UNIQUE,
  platform   varchar(10) NOT NULL DEFAULT 'android',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Annonces --------------------------------------------------
CREATE TABLE listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id         smallint NOT NULL REFERENCES cities(id),
  category_id     smallint NOT NULL REFERENCES categories(id),
  title           varchar(120) NOT NULL,
  description     text NOT NULL DEFAULT '',
  condition       item_condition NOT NULL,
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,                    -- caractéristiques variables (EF-A04)
  status          listing_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listings_attributes_object CHECK (jsonb_typeof(attributes) = 'object')
);
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- EF-A07 / B2 : unicité des annonces ACTIVES d'un même utilisateur
CREATE UNIQUE INDEX uq_listing_active_unique
  ON listings (user_id, lower(title), category_id, condition, city_id)
  WHERE status = 'active';
CREATE INDEX idx_listings_feed    ON listings (city_id, created_at DESC) WHERE status = 'active';
CREATE INDEX idx_listings_filters ON listings (category_id, condition) WHERE status = 'active';
CREATE INDEX idx_listings_user    ON listings (user_id, status);
CREATE INDEX idx_listings_attrs   ON listings USING gin (attributes jsonb_path_ops);

CREATE TABLE listing_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url        text NOT NULL,
  position   smallint NOT NULL CHECK (position BETWEEN 1 AND 5),         -- 1 à 5 photos
  UNIQUE (listing_id, position)
);

CREATE TABLE wishes (                               -- liste « Je recherche » (EF-A02)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  label       varchar(80) NOT NULL,
  category_id smallint REFERENCES categories(id)
);
CREATE INDEX idx_wishes_listing ON wishes(listing_id);

-- ---------- Négociation : offres, contre-offres, messages -------------
CREATE TABLE negotiations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  initiator_id      uuid NOT NULL REFERENCES users(id),
  status            negotiation_status NOT NULL DEFAULT 'open',
  expires_at        timestamptz NOT NULL,           -- EF-O06
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);  -- destinataire = propriétaire de l'annonce cible (listings.user_id) : pas de colonne redondante (3FN)
CREATE TRIGGER trg_negotiations_updated BEFORE UPDATE ON negotiations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX uq_negotiation_open ON negotiations (initiator_id, target_listing_id) WHERE status = 'open';
CREATE INDEX idx_negotiations_initiator ON negotiations (initiator_id, status);
CREATE INDEX idx_negotiations_target ON negotiations (target_listing_id, status);
CREATE INDEX idx_negotiations_expiry ON negotiations (expires_at) WHERE status = 'open';

CREATE TABLE offers (                                -- une ligne par proposition (v1, v2 = contre-offre…)
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES users(id),
  version        integer NOT NULL CHECK (version >= 1),
  with_cash_adjustment boolean NOT NULL DEFAULT false,  -- soulte possible ; le montant se discute dans le chat (aucun prix stocké)
  message        text,
  status         offer_status NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now(),
  responded_at   timestamptz,
  UNIQUE (negotiation_id, version)
);
CREATE INDEX idx_offers_negotiation ON offers (negotiation_id, version DESC);
CREATE UNIQUE INDEX uq_offer_pending  ON offers (negotiation_id) WHERE status = 'pending';    -- une seule offre en attente
CREATE UNIQUE INDEX uq_offer_accepted ON offers (negotiation_id) WHERE status = 'accepted';   -- une seule offre acceptée

CREATE TABLE offer_items (                           -- objets de chaque côté (multi-objets, EF-O01)
  offer_id   uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id),
  side       offer_side NOT NULL,
  PRIMARY KEY (offer_id, listing_id)
);
CREATE INDEX idx_offer_items_listing ON offer_items(listing_id);

CREATE TABLE messages (                              -- chat temps réel (EF-O04)
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  negotiation_id uuid NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  sender_id      uuid REFERENCES users(id),           -- NULL pour un message système
  kind           message_kind NOT NULL DEFAULT 'text',
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz
);
CREATE INDEX idx_messages_negotiation ON messages (negotiation_id, created_at);

-- ---------- Rencontre, QR, avis ----------------------------------------
CREATE TABLE meetings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL UNIQUE REFERENCES negotiations(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id),            -- offre acceptée
  proposed_by    uuid NOT NULL REFERENCES users(id),
  place          varchar(200) NOT NULL,                          -- texte libre
  scheduled_at   timestamptz NOT NULL,
  status         meeting_status NOT NULL DEFAULT 'proposed',
  validated_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);  -- expiration = scheduled_at + 2 h : valeur dérivée, donc non stockée (3FN)
CREATE TRIGGER trg_meetings_updated BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_meetings_expiry ON meetings (scheduled_at) WHERE status IN ('proposed', 'accepted');

CREATE TABLE meeting_participants (                  -- 2 lignes par RDV : QR + confirmation
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  qr_nonce      char(32) NOT NULL UNIQUE,            -- aléatoire, signé dans le payload du QR
  scanned_by    uuid REFERENCES users(id),           -- l'autre participant qui a scanné ce QR
  scanned_at    timestamptz,
  confirmed_at  timestamptz,                         -- « Oui, confirmer l'échange » (EF-R06)
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewee_id uuid NOT NULL REFERENCES users(id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, reviewer_id),
  CHECK (reviewer_id <> reviewee_id)
);
CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id);

-- ---------- Modération et notifications --------------------------------
CREATE TABLE reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       uuid NOT NULL REFERENCES users(id),
  target_listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  target_user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  reason            report_reason NOT NULL,
  details           text,
  status            report_status NOT NULL DEFAULT 'open',
  handled_by        uuid REFERENCES users(id),
  handled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_one_target CHECK ((target_listing_id IS NOT NULL) <> (target_user_id IS NOT NULL))  -- exactement une cible
);
CREATE INDEX idx_reports_open ON reports (created_at DESC) WHERE status = 'open';

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       varchar(40) NOT NULL,                   -- new_offer, counter_offer, message, meeting_reminder…
  title      varchar(120) NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- ex. {"negotiationId": "..."} pour le deep link
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

-- ---------- Vue : réputation (score de confiance, EF-C01) ----------------
CREATE VIEW v_user_reputation AS
SELECT u.id AS user_id,
       COALESCE(round(avg(r.rating)::numeric, 1), 0) AS rating_avg,
       count(DISTINCT r.id)                          AS rating_count,
       (SELECT count(*) FROM meetings m
          JOIN meeting_participants mp ON mp.meeting_id = m.id
         WHERE mp.user_id = u.id AND m.status = 'completed') AS completed_exchanges
FROM users u
LEFT JOIN reviews r ON r.reviewee_id = u.id
GROUP BY u.id;
