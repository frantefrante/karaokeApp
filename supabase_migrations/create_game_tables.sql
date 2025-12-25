-- Tabelle per il sistema di gioco karaoke

-- Tabella utenti/partecipanti
CREATE TABLE IF NOT EXISTS k_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  photo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per ricerca
CREATE INDEX IF NOT EXISTS idx_k_users_name ON k_users(name);

-- Tabella round/turni di gioco
CREATE TABLE IF NOT EXISTS k_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'active', -- 'active', 'closed', 'completed'
  category TEXT, -- 'poll', 'wheel', 'duet', 'band_picks', 'pass_mic'
  payload JSONB, -- Contiene configurazione del round (songs, settings, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per ricerca
CREATE INDEX IF NOT EXISTS idx_k_rounds_state ON k_rounds(state);
CREATE INDEX IF NOT EXISTS idx_k_rounds_category ON k_rounds(category);

-- Tabella voti
CREATE TABLE IF NOT EXISTS k_votes (
  id BIGSERIAL PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES k_rounds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES k_users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(round_id, user_id) -- Un voto per utente per round
);

-- Indici per query veloci
CREATE INDEX IF NOT EXISTS idx_k_votes_round_id ON k_votes(round_id);
CREATE INDEX IF NOT EXISTS idx_k_votes_user_id ON k_votes(user_id);

-- RLS (Row Level Security) - permetti lettura/scrittura a tutti
ALTER TABLE k_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE k_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE k_votes ENABLE ROW LEVEL SECURITY;

-- Policy per k_users
CREATE POLICY "Enable all access for k_users" ON k_users
  FOR ALL USING (true);

-- Policy per k_rounds
CREATE POLICY "Enable all access for k_rounds" ON k_rounds
  FOR ALL USING (true);

-- Policy per k_votes
CREATE POLICY "Enable all access for k_votes" ON k_votes
  FOR ALL USING (true);

-- Trigger per aggiornare updated_at su k_rounds
CREATE TRIGGER update_k_rounds_updated_at
  BEFORE UPDATE ON k_rounds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
