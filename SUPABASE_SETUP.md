# Setup Sincronizzazione con Supabase

## Panoramica

L'applicazione karaoke è ora completamente sincronizzata tramite Supabase, permettendo a tutti i dispositivi di:
- Vedere la stessa libreria brani in tempo reale
- Partecipare ai giochi (sondaggi, ruota, duetti, etc.)
- Votare e vedere i risultati in tempo reale
- Registrarsi come partecipanti

## Setup Iniziale

### 1. Esegui le Migrazioni SQL

Devi eseguire DUE migrazioni SQL nel tuo progetto Supabase:

#### Migrazione 1: Libreria Brani

1. Vai su https://supabase.com/dashboard
2. Seleziona il tuo progetto
3. Vai in **SQL Editor** (menu laterale)
4. Clicca **New query**
5. Copia e incolla il contenuto del file `supabase_migrations/create_k_songs.sql`
6. Clicca **Run** per eseguire

Questa migrazione crea:
- Tabella `k_songs` con campi: id, title, artist, year, chord_sheet, created_at, updated_at
- Indici per ricerca veloce
- Policy RLS per accesso pubblico
- Trigger per aggiornamento automatico di `updated_at`

#### Migrazione 2: Sistema di Gioco

1. Nel **SQL Editor** di Supabase
2. Clicca **New query**
3. Copia e incolla il contenuto del file `supabase_migrations/create_game_tables.sql`
4. Clicca **Run** per eseguire

Questa migrazione crea:
- Tabella `k_users`: utenti/partecipanti registrati
- Tabella `k_rounds`: turni di gioco (sondaggi, ruota, etc.)
- Tabella `k_votes`: voti degli utenti per i brani
- Indici per query veloci
- Policy RLS per accesso pubblico
- Trigger per timestamp automatici

### 2. Verifica Creazione Tabelle

1. Nel dashboard Supabase, vai in **Table Editor**
2. Dovresti vedere queste 4 tabelle:
   - `k_songs` (libreria brani)
   - `k_users` (partecipanti)
   - `k_rounds` (turni di gioco)
   - `k_votes` (voti)
3. Verifica che le colonne siano corrette

## Come Funziona

### Caricamento Iniziale (All'avvio app)

Quando carichi l'app:
1. L'app prova a caricare i brani da Supabase
2. Se ci sono brani su Supabase, li usa
3. Se Supabase è vuoto, carica da localStorage
4. Se trova brani in localStorage, li sincronizza automaticamente su Supabase

### Import CSV

Quando importi un CSV:
1. I brani vengono parsati
2. La tabella `k_songs` viene svuotata
3. I nuovi brani vengono inseriti su Supabase
4. Tutti i dispositivi vedono immediatamente la nuova libreria

### Aggiunta Manuale Brano

Quando aggiungi un brano manualmente:
1. Il brano viene salvato su Supabase
2. Lo stato locale viene aggiornato
3. Tutti i dispositivi vedono il nuovo brano

### Modifica/Eliminazione

Stessa logica: modifiche salvate su Supabase e visibili da tutti i dispositivi.

## Migrazione da localStorage a Supabase

Se hai già una libreria in localStorage:

1. Apri l'app (assicurati che Supabase sia configurato)
2. L'app rileverà automaticamente i brani in localStorage
3. Verrà mostrato in console: "📤 Sincronizzando libreria locale con Supabase..."
4. Tutti i brani verranno caricati su Supabase
5. Da quel momento, tutti i dispositivi vedranno la stessa libreria

## Struttura Tabella k_songs

```sql
CREATE TABLE k_songs (
  id BIGSERIAL PRIMARY KEY,           -- ID autogenerato
  title TEXT NOT NULL,                -- Titolo brano
  artist TEXT NOT NULL,               -- Artista
  year INTEGER,                       -- Anno (opzionale)
  chord_sheet TEXT,                   -- Spartito ChordPro (per futura integrazione)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Preparazione per Integrazione ChordSheetJS

La colonna `chord_sheet` è già predisposta per salvare spartiti in formato ChordPro.

Quando implementerai l'integrazione con SongBook Pro:
1. I brani potranno includere il campo `chord_sheet`
2. Potrai visualizzare gli spartiti direttamente nell'app
3. Potrai trasporre le tonalità
4. Potrai linkare a Spotify/YouTube per il playback

## Troubleshooting

### "Errore fetch libreria"
- Verifica che la migrazione SQL sia stata eseguita correttamente
- Controlla le policy RLS nella tabella

### "Errore sincronizzazione"
- Verifica le credenziali Supabase nel file `.env`
- Controlla i log della console per dettagli

### I brani non si sincronizzano
- Apri la console del browser (F12)
- Cerca messaggi di errore
- Verifica che `backendMode` sia impostato su 'supabase'

## Test Multi-Dispositivo

1. **Dispositivo A**: Importa CSV con la libreria
2. **Dispositivo B**: Apri l'app → Dovresti vedere tutti i brani
3. **Dispositivo A**: Aggiungi un nuovo brano
4. **Dispositivo B**: Ricarica la pagina → Dovresti vedere il nuovo brano

## Prossimi Passi

Fase 2: Integrazione ChordSheetJS per visualizzazione spartiti e trasposizione tonalità.
