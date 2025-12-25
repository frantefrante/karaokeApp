-- Tabella per la libreria brani condivisa
CREATE TABLE IF NOT EXISTS k_songs (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  year INTEGER,
  chord_sheet TEXT, -- Per futura integrazione ChordPro
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indice per ricerca veloce per titolo e artista
CREATE INDEX IF NOT EXISTS idx_k_songs_title ON k_songs(title);
CREATE INDEX IF NOT EXISTS idx_k_songs_artist ON k_songs(artist);

-- Indice per ricerca full-text (opzionale, per ricerca avanzata)
CREATE INDEX IF NOT EXISTS idx_k_songs_search ON k_songs USING gin(to_tsvector('italian', title || ' ' || artist));

-- RLS (Row Level Security) - permetti lettura a tutti, scrittura solo autenticati
ALTER TABLE k_songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON k_songs
  FOR SELECT USING (true);

CREATE POLICY "Enable insert for all users" ON k_songs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for all users" ON k_songs
  FOR UPDATE USING (true);

CREATE POLICY "Enable delete for all users" ON k_songs
  FOR DELETE USING (true);

-- Trigger per aggiornare updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_k_songs_updated_at
  BEFORE UPDATE ON k_songs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
