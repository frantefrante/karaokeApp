# Karaoke Night - Documentazione Completa

## Panoramica del Progetto

Applicazione web interattiva per gestire serate karaoke con multiple modalità di gioco, votazioni in tempo reale, gestione spartiti e proiezione su display esterni.

## Stack Tecnologico

- **Frontend**: React 18 con Hooks
- **Styling**: Tailwind CSS
- **Icone**: Lucide React
- **Backend/Database**: Supabase (PostgreSQL + Real-time subscriptions)
- **Parsing Spartiti**: ChordSheetJS (formato ChordPro)
- **Build Tool**: Vite
- **Deploy**: Vercel

## Architettura dell'Applicazione

### File Principali

```
src/
├── App.jsx                    # Componente principale con routing e game logic
├── ProjectionView.jsx         # Vista proiezione spartiti avanzata (NEW)
├── ChordSheetViewer.jsx       # Visualizzatore spartiti modale
├── WheelOfFortune.jsx         # Componente ruota della fortuna
├── WinnerSongSelection.jsx    # Selezione brano vincitore ruota
└── index.css                  # Stili globali Tailwind
```

### Database Supabase

#### Tabelle

**k_users** - Partecipanti
```sql
- id (uuid, PK)
- name (text)
- photo (text, URL)
- created_at (timestamp)
```

**k_rounds** - Round di gioco
```sql
- id (uuid, PK)
- type (text): 'poll' | 'wheel' | 'duet' | 'band_picks' | 'pass_mic'
- state (text): 'prepared' | 'voting' | 'spinning' | 'winner_selected' | 'song_selected' | 'ready'
- songs (jsonb): array di oggetti song
- votes (jsonb): array di voti
- votingOpen (boolean)
- winner (jsonb): oggetto user vincitore
- selectedSong (jsonb): brano selezionato
- user1, user2 (jsonb): per duetti
- song (jsonb): brano duetto
- currentIndex (integer): indice corrente band picks
- created_at (timestamp)
```

**k_votes** - Voti partecipanti
```sql
- id (uuid, PK)
- round_id (uuid, FK -> k_rounds)
- user_id (uuid, FK -> k_users)
- song_id (uuid)
- created_at (timestamp)
```

## Modalità di Visualizzazione

### 1. Home (`view = 'home'`)
Pagina iniziale con scelta ruolo:
- **Partecipante**: Accesso con nome e foto
- **Organizzatore**: Accesso al pannello admin

### 2. Admin (`view = 'admin'`)
Dashboard organizzatore con due modalità:

#### Modalità Compatta (Default)
Cards riassuntive per accesso rapido:
- **Partecipanti Collegati** (contatore + gestione)
- **Round Corrente** (clicca per aprire game mode)
- **Libreria Brani** (ricerca e gestione)
- **Scaletta Band** (gestione "Scelti dalla Band")

Sezioni espandibili:
- **Partecipanti**: Lista completa con foto, elimina
- **Libreria**: Ricerca, filtri, import CSV/CHO, CRUD brani
- **Scelti dalla Band**: Gestione completa scaletta

#### Modalità Estesa
Vista completa con tutte le funzionalità espanse

### 3. Display (`view = 'display'`)
Vista per proiezione su schermo esterno/TV:
- Mostra round attivo in tempo reale
- Aggiornamenti live via Supabase
- Design ottimizzato per visibilità da lontano

### 4. Projection (`view = 'projection'`)
**NOVITÀ**: Vista proiezione spartiti avanzata con controlli completi

Accesso: `?view=projection&songId=[ID]`

Funzionalità:
- ✅ **Auto-scroll** con controllo velocità (0.5x - 5x)
- ✅ **Trasposizione** tonalità (+/- 11 semitoni)
- ✅ **Dark/Light mode** toggle
- ✅ **Link Spotify/YouTube** per ricerca brano
- ✅ **Accordi posizionati sopra il testo** (non inline)
- ✅ **Toolbar sticky** sempre visibile
- ✅ **Design responsive**

### 5. Participant Home (`view = 'participantHome'`)
Dashboard partecipante con pulsanti:
- Visualizza Display
- Profilo
- Logout

### 6. Waiting/Voting
Schermate di attesa e votazione per partecipanti

## Modalità di Gioco

### 1. Sondaggio Brani (`type: 'poll'`)

**Flusso**:
1. Admin seleziona 2-5 brani dalla libreria
2. Prepara round
3. Apre votazione
4. Partecipanti votano (1 voto a testa)
5. Admin chiude votazione
6. Sistema calcola vincitore
7. Mostra risultati con classifica completa

**Gestione Pareggio**:
- Se più brani hanno stesso punteggio massimo → Round di spareggio automatico
- Nuova votazione solo tra brani ex aequo

**Proiezione Spartito**:
- Pulsanti "📄 Spartito" e "📺 Proietta" sul vincitore
- Spartito: apre ChordSheetViewer in finestra corrente
- Proietta: apre ProjectionView in nuova finestra

### 2. Duetti (`type: 'duet'`)

**Flusso**:
1. Sistema estrae casualmente 2 partecipanti
2. Mostra mini-votazione con 3 brani
3. Entrambi votano
4. Se votano stesso brano → Duetto annunciato
5. Se votano brani diversi → Ripete estrazione

**Proiezione**:
- Pulsanti spartito disponibili sul brano duetto selezionato

### 3. Ruota della Fortuna (`type: 'wheel'`)

**Flusso**:
1. Admin seleziona brani per il round
2. Clicca "Gira la Ruota"
3. Animazione ruota con foto partecipanti
4. Vincitore estratto vede schermata selezione brano
5. Vincitore sceglie tra i brani del round
6. Brano annunciato a tutti

**Caratteristiche**:
- ✅ Ruota visibile nella dashboard admin (non forza redirect a display)
- ✅ Pulsante opzionale "Apri anche su Display Esterno"
- ✅ Reset round funzionante

**Proiezione**:
- Pulsanti spartito disponibili dopo selezione brano

### 4. Scelti dalla Band (`type: 'band_picks'`)

**Due Modalità**:

#### A) Preparazione (Modalità Compatta)
- Card "Scaletta Band" nella dashboard
- Sezione espandibile per gestione completa
- Aggiunta brani dalla libreria con pulsante 🎸
- Riordinamento con frecce ▲▼
- Indicatore brani aggiunti in fondo alla sezione libreria
- Persistenza in localStorage

#### B) Presentazione (Modalità Gioco)
- Admin avvia round con scaletta preparata
- Mostra brani uno alla volta
- Navigazione con "Precedente" / "Successivo"
- Barra progressione (X di Y)
- Termina alla fine della scaletta

**Proiezione**:
- Pulsanti spartito su ogni brano della scaletta

### 5. Passa il Microfono (`type: 'pass_mic'`)

**Status**: In sviluppo
- Estrazione casuale partecipante
- Placeholder UI pronto

## Gestione Spartiti

### Formati Supportati

**ChordPro** (.cho, .chopro, .crd):
```
{title: Nome Canzone}
{artist: Artista}

{start_of_chorus}
[C]Testo con [G]accordi [Am]sopra
{end_of_chorus}

{start_of_verse}
[F]Strofa del [C]brano
{end_of_verse}
```

### Import Spartiti

1. **Singolo File**: Upload .cho
2. **Batch Import**: Upload multipli .cho
3. **Import CSV**: File con campi title, artist, year, chord_sheet

### Visualizzazione Spartiti

#### ChordSheetViewer (Modale)
File: `src/ChordSheetViewer.jsx`

**Funzionalità**:
- ✅ Trasposizione accordi (+/- semitoni)
- ✅ Ridimensionamento testo (12-24px)
- ✅ Auto-scroll con velocità regolabile
- ✅ Fullscreen mode
- ✅ Stampa/Export PDF
- ✅ Link Spotify/YouTube
- ✅ Reset impostazioni
- ✅ Accordi posizionati sopra testo (absolute positioning)
- ✅ Styling sezioni (Chorus, Verse, Bridge)
- ✅ Responsive + Print-friendly CSS

#### ProjectionView (Finestra Separata)
File: `src/ProjectionView.jsx`

**Uso**: Proiezione su display/tendone esterno

**Differenze da ChordSheetViewer**:
- Design minimalista senza X chiudi
- Controlli ottimizzati per uso da lontano
- Toggle Dark/Light mode
- Toolbar sticky sempre visibile
- Font size fisso ma leggibile (20px base)
- Scroll dell'intera finestra (non container interno)

**Accesso**:
```javascript
const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${songId}`;
window.open(url, '_blank');
```

### Rendering ChordSheetJS

**Parser**: `ChordSheetJS.ChordProParser()`
**Formatter**: `ChordSheetJS.HtmlDivFormatter()`

Output HTML:
- `.row`: Riga di testo
- `.chord`: Accordo (absolute position sopra testo)
- `.lyrics`: Testo canzone
- `.paragraph`: Sezione/Strofa
- `.label`: Etichetta sezione (Chorus, Verse, etc.)
- `.comment`: Commenti/note

## Real-Time Synchronization

### Supabase Subscriptions

```javascript
// Listener Partecipanti
supabase
  .channel('users_channel')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'k_users'
  }, handleUserChange)
  .subscribe();

// Listener Round
supabase
  .channel('rounds_channel')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'k_rounds'
  }, handleRoundChange)
  .subscribe();

// Listener Voti
supabase
  .channel('votes_channel')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'k_votes'
  }, handleVoteInsert)
  .subscribe();
```

### Eventi Gestiti

**INSERT**: Nuovo record → Aggiungi a stato locale
**UPDATE**: Record modificato → Aggiorna stato locale
**DELETE**: Record eliminato → Rimuovi da stato locale + reset UI

## Funzionalità Chiave

### Reset Round

**Funzione Unificata** (App.jsx:2277-2313):
```javascript
const handleEndRound = async () => {
  if (currentRound.type === 'poll') {
    handleCloseVoting(); // Chiude votazione e calcola risultati
  } else {
    // Per tutti gli altri tipi: elimina da Supabase
    await supabase.from('k_rounds').delete().eq('id', currentRound.id);
    setCurrentRound(null);
    setSelectedGameMode(null);
  }
};
```

**Disponibile in**:
- Sondaggio Brani
- Duetti
- Ruota della Fortuna
- Scelti dalla Band

### Auto-redirect Partecipanti

Sistema intelligente che reindirizza automaticamente i partecipanti alla vista corretta in base al round attivo:

```javascript
useEffect(() => {
  // Poll con votazione aperta → redirect a voting
  // Wheel spinning → redirect a display
  // Duet → redirect a voting
  // Band picks → redirect a display
  // Nessun round → redirect a waiting
}, [currentRound, currentUser, view]);
```

### Gestione Libreria Brani

**Operazioni CRUD**:
- ✅ Aggiungi brano manualmente
- ✅ Modifica brano esistente
- ✅ Elimina brano
- ✅ Import CSV (batch)
- ✅ Import CHO files
- ✅ Ricerca real-time
- ✅ Filtro spartiti disponibili
- ✅ Sincronizzazione Supabase

**Persistenza**:
- LocalStorage per libreria locale (fallback)
- Supabase per storage cloud + sync real-time

## URL Parameters & Routing

### View Parameter
```
?view=home          → Homepage
?view=admin         → Dashboard organizzatore
?view=display       → Schermo proiezione
?view=projection    → Proiezione spartito (+ songId)
?view=join          → Form accesso partecipante
?view=participantHome → Dashboard partecipante
?view=waiting       → Attesa round
?view=voting        → Votazione attiva
```

### Projection Parameter
```
?view=projection&songId=123
```

## State Management

### Stati Principali (App.jsx)

```javascript
// Visualizzazione
const [view, setView] = useState('home');
const [adminViewMode, setAdminViewMode] = useState('compact'); // 'compact' | 'extended'
const [compactSection, setCompactSection] = useState(null); // 'users' | 'library' | 'band_picks'
const [selectedGameMode, setSelectedGameMode] = useState(null); // 'poll' | 'wheel' | 'duet' | etc.

// Utenti
const [currentUser, setCurrentUser] = useState(null);
const [users, setUsers] = useState([]);

// Round
const [currentRound, setCurrentRound] = useState(null);
const [roundResults, setRoundResults] = useState(null);
const [votesReceived, setVotesReceived] = useState(0);

// Libreria
const [songLibrary, setSongLibrary] = useState([]);
const [songSearchQuery, setSongSearchQuery] = useState('');
const [editingSongId, setEditingSongId] = useState(null);
const [showAddSongForm, setShowAddSongForm] = useState(false);

// Spartiti
const [viewingSong, setViewingSong] = useState(null);
const [songViewContext, setSongViewContext] = useState(null); // 'admin' | 'display'

// Band Picks
const [bandPicksList, setBandPicksList] = useState([]);
const [currentBandPickIndex, setCurrentBandPickIndex] = useState(0);

// Messaggi
const [roundMessage, setRoundMessage] = useState('');
const [importMessage, setImportMessage] = useState('');
```

## Componenti Chiave

### WheelOfFortune

**Props**:
- `items`: Array di users/songs
- `type`: 'users' | 'songs'
- `autoSpin`: boolean
- `onComplete`: callback(winner)
- `preselectedWinnerIndex`: numero (per consistenza display/admin)

**Funzionalità**:
- Animazione rotazione 3 secondi
- Estrazione casuale pre-calcolata
- Callback al completamento

### WinnerSongSelection

**Props**:
- `winner`: oggetto user
- `songs`: array brani tra cui scegliere
- `onSelectSong`: callback(song)
- `currentUser`: user loggato (abilita selezione solo per vincitore)

**UI**:
- Foto vincitore
- Grid brani cliccabili
- Disabilitato per non-vincitori

### ChordSheetViewer

**Props**:
- `song`: oggetto brano
- `onClose`: callback chiusura
- `onUpdateSong`: callback aggiornamento (non usato attualmente)

**UI**:
- Modale fullscreen-able
- Toolbar con tutti i controlli
- Contenuto scrollabile
- CSS ottimizzato per print

### ProjectionView

**Props**:
- `song`: oggetto brano

**Caratteristiche**:
- Nessun onClose (finestra dedicata)
- Toolbar sticky top
- Dark/Light mode state interno
- Auto-scroll su window, non container

## Styling & Design System

### Colori per Game Mode

```javascript
// Sondaggio Brani
from-blue-500/20 to-purple-600/20
border-blue-500/30

// Duetti
from-pink-500/20 to-rose-600/20
border-pink-500/30

// Ruota della Fortuna
from-amber-500/20 to-orange-600/20
border-amber-500/30

// Scelti dalla Band
from-red-500/20 to-pink-600/20
border-red-500/30

// Passa il Microfono
from-green-500/20 to-teal-600/20
border-green-500/30
```

### Tailwind Utilities Comuni

```css
backdrop-blur-xl          /* Effetto vetro sfumato */
bg-gradient-to-br        /* Gradienti background */
rounded-2xl, rounded-3xl /* Bordi arrotondati */
shadow-lg, shadow-2xl    /* Ombre */
transition-all           /* Transizioni smooth */
hover:scale-105          /* Effetto zoom hover */
```

## Funzioni Helper Importanti

### handleCloseVoting (App.jsx ~2190)
Chiude votazione, calcola vincitore, gestisce pareggi, salva risultati

### handleStartDuet (App.jsx ~2100)
Estrae 2 utenti casuali, prepara votazione duetto

### handleWheelComplete (App.jsx ~1900)
Callback completamento ruota, aggiorna round con vincitore

### handleSongSelected (App.jsx ~1950)
Callback selezione brano da vincitore ruota

### handleStartBandPicks (App.jsx ~2050)
Avvia presentazione scaletta band con primo brano

### handleNextBandPick / handlePrevBandPick (App.jsx ~2070)
Navigazione scaletta band picks

## Problemi Risolti (Storico)

### 1. Ruota non visibile in dashboard
**Problema**: Click "Gira la Ruota" forzava redirect a display
**Soluzione**: Rimosso `setView('display')` da handleStartWheel, integrato WheelOfFortune in admin view

### 2. Reset round inconsistente
**Problema**: Reset funzionava solo per poll
**Soluzione**: Unificato handleEndRound per tutti i game modes, gestione DELETE su Supabase

### 3. DELETE loop infinito
**Problema**: Listener DELETE chiamava handleEndRound creando loop
**Soluzione**: Early return su DELETE event con solo reset stato locale

### 4. Accordi inline con testo
**Problema**: Accordi interrompevano parole invece di stare sopra
**Soluzione**: CSS absolute positioning con transform translateY

### 5. Proietta solo su primo brano
**Problema**: Pulsante proietta mostrato solo su currentBandPickIndex === 0
**Soluzione**: Rimosso conditional, pulsanti sempre visibili se chord_sheet presente

## Convenzioni di Codice

### Naming
- **Componenti**: PascalCase (es. `WheelOfFortune`)
- **Funzioni handler**: camelCase con prefisso `handle` (es. `handleStartWheel`)
- **State**: camelCase (es. `currentRound`, `songLibrary`)
- **CSS classes**: kebab-case Tailwind

### Commenti
```javascript
// ==================== SEZIONE TITOLO ====================
// Commenti descrittivi sopra blocchi logici complessi
```

### Conditional Rendering
```javascript
{condizione && <Componente />}
{condizione ? <A /> : <B />}
```

## Deploy & Ambiente

### Variabili Ambiente (.env.local)
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
```

### Build
```bash
npm run build     # Build produzione
npm run dev       # Dev server
npm run preview   # Preview build locale
```

### Vercel Deploy
- Auto-deploy da branch main
- Environment variables configurate in Vercel dashboard
- Build command: `npm run build`
- Output directory: `dist`

## Browser Support

**Funzionalità Fullscreen**: Richiede browser moderni
**ChordSheetJS**: Compatibile con tutti i browser
**Supabase Real-time**: WebSocket support richiesto

## Prossimi Sviluppi Possibili

### Implementati ✅
- [x] Proiezione spartiti avanzata
- [x] Auto-scroll spartiti
- [x] Trasposizione accordi
- [x] Dark/Light mode proiezione
- [x] Link Spotify/YouTube
- [x] Reset round unificato
- [x] Gestione band picks da compact mode
- [x] Ruota visibile in dashboard

### In Roadmap 🔄
- [ ] Passa il Microfono - completare implementazione
- [ ] Embedded Spotify player (richiede Spotify API)
- [ ] Export scaletta PDF
- [ ] Statistiche serate (brani più votati, partecipanti attivi)
- [ ] Multi-lingua (i18n)
- [ ] Tema personalizzabile (color scheme)
- [ ] Backup/Restore libreria
- [ ] Condivisione round via QR code

## Troubleshooting

### Spartiti non si vedono
- Verificare che il brano abbia `chord_sheet` non vuoto
- Controllare che il formato ChordPro sia valido
- Verificare console per errori parsing ChordSheetJS

### Real-time non funziona
- Controllare connessione Supabase
- Verificare che le subscriptions siano attive (dev console)
- Controllare che la tabella abbia Realtime abilitato in Supabase dashboard

### Reset round non funziona
- Verificare che currentRound sia popolato
- Controllare permessi DELETE su Supabase
- Verificare console per errori

### Display non aggiorna
- Controllare che view sia 'display'
- Verificare che Supabase subscription sia attiva
- Refresh pagina display se necessario

## Contatti & Supporto

Per domande o supporto sullo sviluppo:
- Documentazione ChordSheetJS: https://github.com/martijnversluis/ChordSheetJS
- Documentazione Supabase: https://supabase.com/docs
- Tailwind CSS: https://tailwindcss.com/docs

---

**Ultima modifica**: 2025-12-26
**Versione App**: 2.0 (con ProjectionView integrato)
