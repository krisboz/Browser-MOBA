-- Balance: one row per version. Exactly one is active; new matches pin it.
CREATE TABLE balance_versions (
  id          serial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  note        text NOT NULL DEFAULT '',
  parent_id   integer REFERENCES balance_versions(id),
  data        jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX balance_versions_one_active ON balance_versions (is_active) WHERE is_active;

-- Players: unused in v0, here so v0.1 needs no migration of history.
CREATE TABLE players (
  id             text PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  hidden_rating  double precision
);

-- Match records: written once by the server at match end.
CREATE TABLE matches (
  id                  bigserial PRIMARY KEY,
  balance_version_id  integer NOT NULL REFERENCES balance_versions(id),
  mode                text NOT NULL,
  map                 text NOT NULL,
  started_at          timestamptz NOT NULL,
  length_s            double precision NOT NULL,
  winner_side         smallint
);

CREATE TABLE match_players (
  match_id      bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side          smallint NOT NULL,
  player_ref    text NOT NULL, -- guest session id or account id
  preset        text,
  stat_build    jsonb NOT NULL,
  spells        jsonb NOT NULL,
  summoners     jsonb NOT NULL,
  result        text NOT NULL,
  kills         integer NOT NULL DEFAULT 0,
  deaths        integer NOT NULL DEFAULT 0,
  assists       integer NOT NULL DEFAULT 0,
  damage_dealt  double precision NOT NULL DEFAULT 0,
  damage_taken  double precision NOT NULL DEFAULT 0,
  gold          integer NOT NULL DEFAULT 0,
  items         jsonb NOT NULL DEFAULT '[]', -- [{ item, time }]
  kill_times    jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (match_id, player_ref)
);
