import React, { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Camera, Music, Users, Play, Trophy, Disc, Mic, Upload, AlertTriangle, CheckCircle, RefreshCcw, Eye, Maximize2 } from 'lucide-react';
import ChordSheetViewer from './ChordSheetViewer';

const STORAGE_KEY = 'karaoke_songs';
const CURRENT_USER_KEY = 'karaoke_current_user';
const ADMIN_MODE_KEY = 'karaoke_admin_mode';

const computeResults = (round) => {
  if (!round) return { winner: null, stats: [], tiedSongs: [] };
  const voteCounts = {};
  const songsList = round.songs || [];
  (round.votes || []).forEach(v => {
    voteCounts[v.songId] = (voteCounts[v.songId] || 0) + 1;
  });
  songsList.forEach(song => {
    if (!voteCounts[song.id]) voteCounts[song.id] = 0;
  });
  const sorted = Object.entries(voteCounts)
    .map(([songId, count]) => ({ songId: parseInt(songId, 10), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const songA = songsList.find(s => s.id === a.songId);
      const songB = songsList.find(s => s.id === b.songId);
      return (songA?.title || '').localeCompare(songB?.title || '');
    });
  const threshold = 3;
  const qualified = sorted.filter(s => s.count >= threshold);
  const winner = qualified.length > 0 ? qualified[0] : sorted[0];

  // Controlla se ci sono brani ex aequo al primo posto
  const topVotes = winner?.count || 0;
  const tiedSongs = sorted.filter(s => s.count === topVotes && topVotes > 0);

  // Se ci sono 2 o più brani con lo stesso numero di voti (e almeno 1 voto), c'è pareggio
  const hasTie = tiedSongs.length >= 2;

  return {
    winner: hasTie ? null : (songsList.find(s => s.id === winner?.songId) || null),
    stats: sorted.map(s => ({
      song: songsList.find(song => song.id === s.songId),
      votes: s.count
    })),
    tiedSongs: hasTie ? tiedSongs.map(t => songsList.find(s => s.id === t.songId)).filter(Boolean) : []
  };
};
// Funzione per generare il QR WiFi in formato standard
const generateWifiQR = (ssid, password, encryption = 'WPA') => {
  // Escape caratteri speciali nel SSID e password
  const escapedSSID = ssid.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/:/g, '\\:').replace(/ /g, '\\ ');
  const escapedPassword = password.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/:/g, '\\:');
  return `WIFI:T:${encryption};S:${escapedSSID};P:${escapedPassword};;`;
};

const parseCSVLine = (line, delimiter) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0 || line.endsWith(delimiter)) {
    values.push(current.trim());
  }

  return values;
};

const detectDelimiter = (line) => {
  const commas = (line.match(/,/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;

  if (semicolons > 0 && commas > 0) return ';';
  if (semicolons > 0) return ';';
  if (commas > 0) return ',';
  return ',';
};

const parseSongsFromCSV = (text) => {
  const rows = text.split(/\r?\n/).filter((row) => row.trim().length > 0);
  if (rows.length === 0) {
    return { songs: [], errors: ['Il file CSV è vuoto.'] };
  }

  const delimiter = detectDelimiter(rows[0]);
  const header = parseCSVLine(rows[0], delimiter).map((h) => h.toLowerCase());
  const titleIndex = header.indexOf('title');
  const artistIndex = header.indexOf('artist');
  const yearIndex = header.indexOf('year');

  if (titleIndex === -1) {
    return { songs: [], errors: ['Colonna "title" mancante nell\'header.'] };
  }

  const songs = [];
  const errors = [];

  rows.slice(1).forEach((row, rowIdx) => {
    const cols = parseCSVLine(row, delimiter);
    const title = cols[titleIndex]?.trim();
    const artist = cols[artistIndex]?.trim() || 'Artista sconosciuto';
    const yearRaw = yearIndex !== -1 ? cols[yearIndex]?.trim() : '';

    if (!title) {
      errors.push(`Riga ${rowIdx + 2}: titolo mancante, riga scartata.`);
      return;
    }

    const year = yearRaw ? parseInt(yearRaw, 10) : null;
    songs.push({
      id: songs.length + 1,
      title,
      artist,
      year: Number.isFinite(year) ? year : null
    });
  });

  return { songs, errors };
};

// Parser per file ChordPro (.cho)
const parseChordProFile = (filename, content) => {
  const lines = content.split(/\r?\n/);
  let title = null;
  let artist = null;
  let year = null;

  // Estrai metadati dalle direttive ChordPro
  for (const line of lines) {
    const trimmed = line.trim();

    // Cerca {title: ...} o {t: ...}
    const titleMatch = trimmed.match(/^\{(?:title|t):\s*(.+?)\}$/i);
    if (titleMatch && !title) {
      title = titleMatch[1].trim();
    }

    // Cerca {artist: ...} o {subtitle: ...} o {st: ...}
    const artistMatch = trimmed.match(/^\{(?:artist|subtitle|st):\s*(.+?)\}$/i);
    if (artistMatch && !artist) {
      artist = artistMatch[1].trim();
    }

    // Cerca {year: ...}
    const yearMatch = trimmed.match(/^\{year:\s*(\d+)\}$/i);
    if (yearMatch && !year) {
      year = parseInt(yearMatch[1], 10);
    }
  }

  // Se non troviamo metadati, usa il nome del file
  if (!title) {
    // Rimuovi estensione .cho e usa come titolo
    title = filename.replace(/\.cho$/i, '');
  }

  if (!artist) {
    artist = 'Artista sconosciuto';
  }

  return {
    title,
    artist,
    year,
    chord_sheet: content
  };
};

// ============================================================================
// COMPONENTI UI
// ============================================================================

function PhotoCapture({ onCapture }) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState('');
  const placeholderImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%236366f1" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="80" text-anchor="middle" dy=".3em" fill="white"%3E👤%3C/text%3E%3C/svg%3E';

  const usePlaceholder = () => {
    onCapture(placeholderImg);
    setCaptured(true);
  };

  const startCamera = async () => {
    console.log('🎥 Tentativo di avvio camera...');

    // Controlla se l'API mediaDevices è disponibile
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('❌ API mediaDevices non disponibile');
      setError('Il tuo browser non supporta l\'accesso alla fotocamera. Usa l\'avatar di default.');
      usePlaceholder();
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      console.error('❌ Contesto non sicuro (richiede HTTPS o localhost)');
      setError('La fotocamera richiede https o localhost. Se non puoi abilitarla, continua con l\'avatar di default.');
      usePlaceholder();
      return;
    }

    console.log('✅ Contesto sicuro, richiedo permessi camera...');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }
      });
      console.log('✅ Camera stream ottenuto:', mediaStream);
      console.log('Stream tracks:', mediaStream.getTracks());
      setStream(mediaStream);
      setError('');

      // Piccolo delay per assicurarsi che il video element sia renderizzato
      setTimeout(() => {
        if (videoRef.current) {
          console.log('✅ Assegnazione stream al video element');
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = () => {
            console.log('✅ Video metadata caricato, dimensioni:',
              videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
            videoRef.current?.play().catch(err => {
              console.error('❌ Errore playback video:', err);
            });
          };
          // Forza play anche senza aspettare metadata
          videoRef.current.play().catch(err => {
            console.log('Play anticipato fallito (normale):', err.message);
          });
        } else {
          console.error('❌ videoRef.current è ancora null dopo timeout');
        }
      }, 100);
    } catch (err) {
      console.error('❌ Errore accesso camera:', err.name, err.message);
      let errorMessage = 'Impossibile accedere alla camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Permessi camera negati. Controlla le impostazioni del browser.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'Nessuna fotocamera trovata sul dispositivo.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'La fotocamera è già in uso da un\'altra app.';
      }
      setError(errorMessage + ' Usa l\'avatar di default.');
      usePlaceholder();
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !videoRef.current.videoWidth) {
      setError('Attendi un secondo che la camera parta, poi riprova.');
      setTimeout(() => capturePhoto(), 300);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    const photo = canvas.toDataURL('image/jpeg', 0.8);
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    setCaptured(true);
    onCapture(photo);
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  if (captured) {
    return (
      <div className="text-center text-green-600">
        <Camera className="w-16 h-16 mx-auto mb-2" />
        <p>Foto acquisita! ✓</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      {!stream ? (
        <div className="space-y-2">
          <button
            onClick={startCamera}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto"
          >
            <Camera className="w-5 h-5" />
            Avvia Camera
          </button>
          <button
            onClick={usePlaceholder}
            className="text-sm text-blue-700 underline block mx-auto"
          >
            Continua senza camera (usa avatar)
          </button>
          {error && <p className="text-sm text-red-600 max-w-xs mx-auto">{error}</p>}
        </div>
      ) : (
        <div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-w-md mx-auto rounded-lg mb-4 bg-black"
            style={{ minHeight: '300px', minWidth: '300px' }}
          />
          <button
            onClick={capturePhoto}
            className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700"
          >
            📸 Scatta Foto
          </button>
          {stream && (
            <p className="text-xs text-gray-500 mt-2">
              Camera attiva - se non vedi l'anteprima, attendi qualche secondo
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WheelOfFortune({ items, type = 'users', onComplete, autoSpin = false, preselectedWinnerIndex = null }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (autoSpin && !spinning && !winner) {
      spinWheel();
    }
  }, [autoSpin]);

  const spinWheel = () => {
    if (spinning) return;

    setSpinning(true);
    setShowCelebration(false);

    // Usa il vincitore predeterminato se fornito, altrimenti scegline uno casuale
    const randomWinnerIndex = preselectedWinnerIndex !== null
      ? preselectedWinnerIndex
      : Math.floor(Math.random() * items.length);
    const anglePerItem = 360 / items.length;

    // ANALISI DAL LOG:
    // - Gli items sono posizionati con rotate(angle) dove angle = anglePerItem * i
    // - Item 0 è a 0°, Item 1 è a 180°, etc. (con 2 items)
    // - La freccia punta a 0° (in alto) e non si muove
    //
    // PROBLEMA: Con offset +90 la ruota seleziona l'elemento SUCCESSIVO
    // Dal test: volevo index 0 (a 0°), ruota fermata a 90°, ma arrowAngle = 180° (index 1)
    //
    // SOLUZIONE: Invertire offset da +90 a -90
    // In questo modo l'elemento corretto finirà sotto la freccia

    const itemPosition = anglePerItem * randomWinnerIndex;
    const targetAngle = -itemPosition - 90;

    // Aggiungi giri completi (8-12 giri per effetto più spettacolare)
    const fullSpins = 8 + Math.floor(Math.random() * 5);
    const finalRotation = 360 * fullSpins + targetAngle;

    console.log('🎰 Ruota della Fortuna - Calcolo Preciso:', {
      '1_TotaleItems': items.length,
      '2_WinnerIndex': randomWinnerIndex,
      '3_WinnerName': items[randomWinnerIndex]?.name || items[randomWinnerIndex]?.title,
      '4_AnglePerItem': anglePerItem + '°',
      '5_ItemPosition': itemPosition + '° (posizione iniziale item)',
      '6_TargetAngle': targetAngle + '° (rotazione necessaria)',
      '7_FullSpins': fullSpins + ' giri',
      '8_FinalRotation': finalRotation + '°',
      '9_FinalPosition': (finalRotation % 360) + '° (posizione finale normalizzata)'
    });

    setRotation(finalRotation);

    // Durata totale: 10 secondi per la rotazione
    const spinDuration = 10000;

    // Dopo l'animazione, attendi altri 3 secondi prima di mostrare il vincitore
    setTimeout(() => {
      // Calcola quale elemento è effettivamente sotto la freccia
      // La freccia è a 0°, la ruota ha ruotato di finalRotation gradi
      // Normalizziamo la rotazione finale a 0-360°
      const normalizedRotation = ((finalRotation % 360) + 360) % 360;

      // La freccia punta a 0°. Con la ruota ruotata, quale elemento è a 0°?
      // Se la ruota ha ruotato di X°, l'elemento che era a -X° ora è a 0°
      // Ma dobbiamo considerare l'offset di 90° degli elementi
      const arrowAngle = (360 - normalizedRotation - 90 + 360) % 360;
      const actualWinnerIndex = Math.round(arrowAngle / anglePerItem) % items.length;

      const selectedWinner = items[actualWinnerIndex];

      console.log('✅ Verifica Vincitore:', {
        expectedIndex: randomWinnerIndex,
        expectedName: items[randomWinnerIndex]?.name || items[randomWinnerIndex]?.title,
        normalizedRotation: normalizedRotation + '°',
        arrowAngle: arrowAngle + '°',
        actualIndex: actualWinnerIndex,
        actualName: selectedWinner?.name || selectedWinner?.title,
        match: actualWinnerIndex === randomWinnerIndex ? '✅ CORRETTO' : '❌ ERRORE'
      });

      setWinner(selectedWinner);
      setSpinning(false);

      // Mostra celebrazione dopo un breve delay
      setTimeout(() => {
        setShowCelebration(true);
        if (onComplete) onComplete(selectedWinner);
      }, 500);
    }, spinDuration + 3000);
  };

  return (
    <div className="relative flex flex-col items-center gap-6">
      {/* Confetti Animation quando c'è un vincitore */}
      {showCelebration && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-pulse"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-10%`,
                animation: `fall ${2 + Math.random() * 3}s linear infinite`,
                animationDelay: `${Math.random() * 2}s`,
                fontSize: '2rem',
                opacity: 0.8
              }}
            >
              {['🎉', '🎊', '⭐', '✨', '🎈'][Math.floor(Math.random() * 5)]}
            </div>
          ))}
        </div>
      )}

      {!winner ? (
        <>
          <div className="relative w-[500px] h-[500px]">
            {/* Bordo esterno decorativo */}
            <div className="absolute inset-0 rounded-full border-[12px] border-yellow-500 shadow-2xl animate-pulse"></div>

            {/* Ruota principale */}
            <div
              className="absolute inset-3 rounded-full bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 shadow-2xl"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning ? 'transform 10s cubic-bezier(0.05, 0.7, 0.1, 0.99)' : 'none',
                boxShadow: '0 0 60px rgba(0, 0, 0, 0.5), inset 0 0 30px rgba(255, 255, 255, 0.3)'
              }}
            >
              {/* Centro della ruota */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 border-4 border-white shadow-xl z-20"></div>

              {/* Items sulla ruota */}
              {items.map((item, i) => {
                const angle = (360 / items.length) * i;
                return (
                  <div
                    key={i}
                    className="absolute top-1/2 left-1/2 origin-left"
                    style={{
                      transform: `rotate(${angle}deg) translateX(140px)`,
                      width: '100px',
                      marginTop: '-50px'
                    }}
                  >
                    {type === 'users' ? (
                      <div className="text-center">
                        <div className="w-24 h-24 rounded-full bg-white mx-auto mb-2 overflow-hidden border-4 border-yellow-300 shadow-2xl">
                          <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                        </div>
                        <p className="text-sm font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] bg-black bg-opacity-40 px-2 py-1 rounded-lg">
                          {item.name}
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Music className="w-16 h-16 text-white mx-auto mb-2 drop-shadow-lg" />
                        <p className="text-sm font-bold text-white drop-shadow-lg bg-black bg-opacity-40 px-2 py-1 rounded-lg">
                          {item.title}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Freccia indicatore migliorata */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-6 z-30">
              <div className="relative">
                <div className="w-0 h-0 border-l-[30px] border-l-transparent border-r-[30px] border-r-transparent border-t-[60px] border-t-red-600 drop-shadow-2xl"></div>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[25px] border-l-transparent border-r-[25px] border-r-transparent border-t-[50px] border-t-yellow-400"></div>
              </div>
            </div>
          </div>

          {!autoSpin && (
            <button
              onClick={spinWheel}
              disabled={spinning}
              className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-2xl font-bold px-16 py-5 rounded-full hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 shadow-2xl transform hover:scale-105 transition-all"
            >
              {spinning ? 'GIRANDO...' : '🎰 GIRA LA RUOTA!'}
            </button>
          )}

          {spinning && (
            <p className="text-xl font-semibold text-gray-700 animate-pulse">
              Chi sarà il fortunato? 🤔
            </p>
          )}
        </>
      ) : (
        <div className="text-center">
          <div className="animate-bounce mb-6">
            <h2 className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-600 mb-4">
              🎉 VINCITORE! 🎉
            </h2>
          </div>
          {type === 'users' ? (
            <div className="transform scale-110 transition-all">
              <img
                src={winner.photo}
                alt={winner.name}
                className="w-48 h-48 rounded-full mx-auto border-8 border-yellow-400 mb-4 shadow-2xl animate-pulse"
              />
              <p className="text-5xl font-bold text-gray-800 mb-2">{winner.name}</p>
              <p className="text-2xl text-gray-600">È il tuo turno di cantare! 🎤</p>
            </div>
          ) : (
            <div>
              <Music className="w-32 h-32 text-yellow-400 mx-auto mb-4" />
              <p className="text-4xl font-bold">{winner.title}</p>
              <p className="text-2xl text-gray-600">{winner.artist}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VotingInterface({ songs, onVote }) {
  const [selectedSong, setSelectedSong] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setSelectedSong(null);
    setSubmitted(false);
  }, [songs]);

  const handleSelect = (song) => {
    if (submitted) return;
    if (selectedSong?.id === song.id) {
      setSelectedSong(null);
    } else {
      setSelectedSong(song);
    }
  };

  const handleSubmit = () => {
    if (!selectedSong || submitted) return;
    onVote(selectedSong.id);
    setSubmitted(true);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center">🎵 Vota il tuo brano preferito!</h2>
      <div className="grid grid-cols-1 gap-3">
        {songs.map(song => (
          <button
            key={song.id}
            onClick={() => handleSelect(song)}
            disabled={submitted}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              selectedSong?.id === song.id
                ? 'bg-green-500 text-white border-green-600 scale-105'
                : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
            } disabled:opacity-50`}
          >
            <div className="font-bold text-lg">{song.title}</div>
            <div className="text-sm opacity-75">
              {song.artist}{song.artist ? ' • ' : ''}{song.year ?? ''}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!selectedSong || submitted}
          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          Invia voto
        </button>
        {submitted && selectedSong && (
          <div className="text-center text-green-600 font-bold">
            ✓ Voto registrato per "{selectedSong.title}"!
          </div>
        )}
        {!submitted && selectedSong && (
          <div className="text-xs text-gray-600">Puoi deselezionare o scegliere un altro brano prima di inviare.</div>
        )}
      </div>
    </div>
  );
}

function WinnerSongSelection({ winner, songs, onSelectSong, currentUser }) {
  const [selectedSong, setSelectedSong] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  const isWinner = currentUser && currentUser.id === winner.id;

  const handleConfirm = () => {
    if (!selectedSong || !isWinner) return;
    setConfirmed(true);
    if (onSelectSong) onSelectSong(selectedSong);
  };

  if (confirmed && selectedSong) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <div className="mb-8">
          <h2 className="text-5xl font-bold text-green-600 mb-4">✅ Brano Confermato!</h2>
          <img
            src={winner.photo}
            alt={winner.name}
            className="w-32 h-32 rounded-full mx-auto border-4 border-green-500 mb-4"
          />
          <p className="text-2xl font-semibold text-gray-800 mb-2">{winner.name}</p>
        </div>
        <div className="bg-gradient-to-r from-purple-100 to-pink-100 rounded-2xl p-8 border-4 border-purple-300">
          <Music className="w-20 h-20 text-purple-600 mx-auto mb-4" />
          <p className="text-3xl font-bold text-gray-800 mb-2">{selectedSong.title}</p>
          <p className="text-xl text-gray-600 mb-4">{selectedSong.artist}</p>
          {selectedSong.year && (
            <p className="text-lg text-gray-500">Anno: {selectedSong.year}</p>
          )}
        </div>
        <p className="mt-8 text-xl text-gray-700">Preparati a cantare! 🎤🎶</p>
      </div>
    );
  }

  // Se non è il vincitore, mostra solo un messaggio di attesa
  if (!isWinner) {
    return (
      <div className="max-w-4xl mx-auto py-8 text-center">
        <div className="mb-8">
          <h2 className="text-4xl font-bold text-purple-600 mb-4">🎉 Abbiamo un vincitore!</h2>
          <div className="flex items-center justify-center gap-4 mb-6">
            <img
              src={winner.photo}
              alt={winner.name}
              className="w-32 h-32 rounded-full border-4 border-yellow-400"
            />
            <div className="text-left">
              <p className="text-3xl font-bold text-gray-800">{winner.name}</p>
              <p className="text-xl text-gray-600">Sta scegliendo il brano... 🎵</p>
            </div>
          </div>
        </div>
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
          <p className="text-lg text-gray-700">Attendi che {winner.name} scelga il brano da cantare!</p>
          <div className="animate-pulse mt-4">
            <Music className="w-16 h-16 text-blue-500 mx-auto" />
          </div>
        </div>

        {/* Debug info per admin */}
        {!currentUser && (
          <div className="mt-8">
            <p className="text-sm text-gray-500">
              Admin: Stai visualizzando la schermata di attesa. Solo {winner.name} può scegliere il brano.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Vincitore ID: {winner.id} | CurrentUser: {currentUser ? currentUser.id : 'null'}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Il vincitore può scegliere il brano
  return (
    <div className="max-w-4xl mx-auto py-8">
      {/* Header con vincitore */}
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold text-purple-600 mb-4">🎉 Scegli il tuo brano!</h2>
        <div className="flex items-center justify-center gap-4 mb-6">
          <img
            src={winner.photo}
            alt={winner.name}
            className="w-24 h-24 rounded-full border-4 border-yellow-400"
          />
          <div className="text-left">
            <p className="text-2xl font-bold text-gray-800">{winner.name}</p>
            <p className="text-lg text-gray-600">È il tuo momento! 🌟</p>
          </div>
        </div>
        <p className="text-lg text-gray-700">Scegli uno dei 20 brani estratti per te:</p>
      </div>

      {/* Griglia dei brani */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {songs.map((song, index) => (
          <button
            key={song.id}
            onClick={() => setSelectedSong(song)}
            className={`p-5 rounded-xl border-3 text-left transition-all transform hover:scale-102 ${
              selectedSong?.id === song.id
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-purple-600 scale-105 shadow-2xl'
                : 'bg-white border-gray-200 hover:border-purple-400 hover:shadow-lg'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                selectedSong?.id === song.id ? 'bg-white text-purple-600' : 'bg-purple-100 text-purple-600'
              }`}>
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="font-bold text-lg mb-1">{song.title}</div>
                <div className={`text-sm ${selectedSong?.id === song.id ? 'text-purple-100' : 'text-gray-600'}`}>
                  {song.artist}{song.year ? ` • ${song.year}` : ''}
                </div>
              </div>
              {selectedSong?.id === song.id && (
                <CheckCircle className="w-6 h-6 text-white flex-shrink-0" />
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Pulsante di conferma */}
      <div className="text-center">
        <button
          onClick={handleConfirm}
          disabled={!selectedSong}
          className="bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xl font-bold px-12 py-5 rounded-full hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl transform hover:scale-105 transition-all"
        >
          {selectedSong ? `Conferma "${selectedSong.title}"` : 'Seleziona un brano'}
        </button>
        {selectedSong && (
          <p className="mt-4 text-sm text-gray-600">
            Hai selezionato: <span className="font-bold">{selectedSong.title}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function ResultList({ stats, compact = false }) {
  const maxVotes = Math.max(0, ...stats.map(s => s.votes));
  const minVisible = 4;

  return (
    <div className="space-y-3">
      {stats.map((stat, i) => {
        const percent = maxVotes > 0 ? (stat.votes / maxVotes) * 100 : 0;
        const barWidth = stat.votes > 0 ? Math.max(percent, minVisible) : 0;
        return (
          <div
            key={`${stat.song.id}-${i}`}
            className={`p-3 bg-gray-50 rounded-lg border ${compact ? '' : 'flex flex-col gap-1'}`}
          >
            <div className="flex items-center justify-between text-sm">
              <div className="font-bold text-gray-800">{stat.song.title}</div>
              <div className="flex items-center gap-1 text-gray-700">
                <span className="text-lg font-semibold text-blue-700">{stat.votes}</span>
                <span className="text-xs">voti</span>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500 ease-out"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            {!compact && (
              <div className="text-xs text-gray-500">{stat.song.artist}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QrCode({ value, label, sublabel }) {
  return (
    <div className="flex flex-col items-center p-4 bg-white rounded-xl shadow border">
      <QRCodeCanvas
        value={value}
        size={260}
        level="H"
        includeMargin
      />
      <div className="text-center mt-3">
        <p className="font-bold text-gray-800">{label}</p>
        {sublabel && <p className="text-sm text-gray-600">{sublabel}</p>}
        <p className="mt-2 text-xs text-gray-500 break-all">{value}</p>
        {label === 'Wi‑Fi' && (
          <p className="mt-1 text-[11px] text-gray-500">
            Se non funziona via QR, inserisci SSID e password manualmente.
          </p>
        )}
      </div>
    </div>
  );
}

function UserJoinView({ onJoin, onBack }) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState(null);

  const handleJoin = () => {
    onJoin(name, photo);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
        <h2 className="text-3xl font-bold text-center mb-6">Registrati alla Serata</h2>

        {!photo ? (
          <>
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Il tuo nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Es. Mario Rossi"
              />
            </div>

            {name.length >= 2 && (
              <PhotoCapture onCapture={setPhoto} />
            )}
          </>
        ) : (
          <div className="text-center">
            <img src={photo} alt="Preview" className="w-32 h-32 rounded-full mx-auto mb-4 border-4 border-blue-500" />
            <p className="text-xl font-bold mb-6">Ciao, {name}! 👋</p>
            <button
              onClick={handleJoin}
              className="bg-green-600 text-white px-8 py-4 rounded-lg hover:bg-green-700 text-lg font-semibold"
            >
              ✓ Conferma Registrazione
            </button>
          </div>
        )}

        <button
          onClick={onBack}
          className="mt-6 text-gray-600 hover:text-gray-800 block mx-auto"
        >
          ← Indietro
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// APP PRINCIPALE
// ============================================================================

export default function KaraokeApp() {
  // Rileva se siamo in modalità display/proiezione
  const isDisplayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('display') === 'true';

  const [view, setView] = useState('home');
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
  const [roundResults, setRoundResults] = useState(null);
  const [songLibrary, setSongLibrary] = useState([]);
  const [libraryErrors, setLibraryErrors] = useState([]);
  const [songSearchQuery, setSongSearchQuery] = useState('');
  const [editingSongId, setEditingSongId] = useState(null);
  const [showAddSongForm, setShowAddSongForm] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [roundMessage, setRoundMessage] = useState('');
  const [votesReceived, setVotesReceived] = useState(0);
  const fileInputRef = useRef(null);
  const choFilesInputRef = useRef(null);
  const votesChannelRef = useRef(null);
  const registeredOnceRef = useRef(false);
  const [backendMode, setBackendMode] = useState(isSupabaseConfigured ? 'supabase' : 'mock');
  const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');

  // Configurazione WiFi (salvata in localStorage)
  const [wifiConfig, setWifiConfig] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('wifi_config') : null;
    return saved ? JSON.parse(saved) : { ssid: 'FASTWEB-EUK8T4 5Hz', password: 'BCAXTYDCD9', encryption: 'WPA' };
  });

  // Brani scelti dalla band (salvati in localStorage)
  const [bandPicksList, setBandPicksList] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('band_picks_list') : null;
    return saved ? JSON.parse(saved) : [];
  });
  const [currentBandPickIndex, setCurrentBandPickIndex] = useState(0);
  const isSupabaseReady = isSupabaseConfigured;
  const [isAdminMode, setIsAdminMode] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(ADMIN_MODE_KEY) === 'true';
  });
  const [showQRCodes, setShowQRCodes] = useState(false);
  const [showWiFiConfig, setShowWiFiConfig] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');
  const [songSearch, setSongSearch] = useState('');
  const [viewingSong, setViewingSong] = useState(null);
  const [adminViewMode, setAdminViewMode] = useState('compact'); // 'compact' or 'extended'

  const registerUserSupabase = async (name, photo, silent = false) => {
    if (!supabase) return null;
    if (registeredOnceRef.current && currentUser?.id && !silent) {
      setView('waiting');
      return currentUser;
    }

    // Prima controlla se l'utente esiste già (stesso nome e foto)
    const { data: existingUsers, error: searchError } = await supabase
      .from('k_users')
      .select('*')
      .eq('name', name)
      .eq('photo', photo);

    if (searchError) {
      console.error('Errore ricerca utente esistente', searchError);
    }

    // Se esiste già, usa quello
    if (existingUsers && existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      setCurrentUser(existingUser);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(existingUser));
      }
      if (!silent) {
        registeredOnceRef.current = true;
        setView('waiting');
      }
      return existingUser;
    }

    // Altrimenti crea un nuovo utente
    const { data, error } = await supabase
      .from('k_users')
      .insert({ name, photo })
      .select()
      .single();
    if (error) {
      console.error('Errore registerUser supabase', error);
      return null;
    }
    setCurrentUser(data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data));
    }
    if (!silent) {
      registeredOnceRef.current = true;
      setView('waiting');
    }
    return data;
  };

  const removeUserSupabase = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from('k_users').delete().eq('id', id);
    if (error) console.error('Errore removeUser', error);
    if (currentUser?.id === id) {
      setCurrentUser(null);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(CURRENT_USER_KEY);
      }
    }
  };

  const preparePollSupabase = async () => {
    if (!supabase) return;
    const pool = [...songLibrary];
    if (pool.length < 10) {
      setRoundMessage('Servono almeno 10 brani in libreria per preparare un sondaggio.');
      return;
    }
    const selectedSongs = pool.sort(() => Math.random() - 0.5).slice(0, 10);
    const noneOption = { id: -1, title: 'Nessuno', artist: '—', year: null };
    const songs = [...selectedSongs, noneOption];
    const payload = { songs, votingOpen: false, votes: [], type: 'poll' };
    const { data, error } = await supabase
      .from('k_rounds')
      .insert({ category: 'poll', state: 'prepared', payload })
      .select()
      .single();
    if (error) {
      console.error('Errore preparePoll', error);
      setRoundMessage('Errore nella preparazione del round.');
      return;
    }
    setCurrentRound({ ...payload, id: data.id, state: 'prepared', category: 'poll', type: 'poll' });
    setRoundResults(null);
    setVotesReceived(0);
    setRoundMessage('Round preparato con 10 brani casuali.');
  };

  const openVotingSupabase = async () => {
    if (!supabase || !currentRound?.id) return;
    const payload = { ...currentRound, type: currentRound.type || 'poll' };
    const { error } = await supabase
      .from('k_rounds')
      .update({ state: 'voting', payload: { ...payload, votingOpen: true } })
      .eq('id', currentRound.id);
    if (error) console.error('Errore openVoting', error);
  };

  const closeVotingSupabase = async () => {
    if (!supabase || !currentRound?.id) return;
    const { data: votesData, error: voteErr } = await supabase
      .from('k_votes')
      .select('*')
      .eq('round_id', currentRound.id);
    if (voteErr) console.error('Errore fetch voti', voteErr);
    const roundWithVotes = { ...currentRound, type: currentRound.type || 'poll', votes: (votesData || []).map(v => ({ userId: v.user_id, songId: v.song_id })) };
    const results = computeResults(roundWithVotes);

    // Se c'è un pareggio, avvia automaticamente uno spareggio
    if (results.tiedSongs && results.tiedSongs.length >= 2) {
      console.log('⚖️ Pareggio rilevato! Avvio spareggio con', results.tiedSongs.length, 'brani');
      setRoundMessage(`⚖️ Pareggio! Avvio spareggio tra ${results.tiedSongs.length} brani...`);

      // Termina il round corrente
      const endPayload = { ...currentRound, type: currentRound.type || 'poll', votingOpen: false, votes: roundWithVotes.votes, results };
      await supabase
        .from('k_rounds')
        .update({ state: 'ended', payload: endPayload })
        .eq('id', currentRound.id);

      // Crea un nuovo round di spareggio con solo i brani ex aequo
      const tiebreakPayload = {
        type: 'poll',
        category: 'poll',
        songs: results.tiedSongs,
        votingOpen: false,
        votes: [],
        state: 'prepared',
        isTiebreaker: true,
        previousRoundId: currentRound.id
      };

      const { data: newRound, error: createError } = await supabase
        .from('k_rounds')
        .insert({ category: 'poll', state: 'prepared', payload: tiebreakPayload })
        .select()
        .single();

      if (createError) {
        console.error('Errore creazione spareggio', createError);
        setRoundMessage('Errore nella creazione dello spareggio.');
      } else {
        setCurrentRound({ ...tiebreakPayload, id: newRound.id });
        setRoundResults(null);
        setVotesReceived(0);
        setRoundMessage(`⚖️ Spareggio preparato! Apri la votazione per i ${results.tiedSongs.length} brani ex aequo.`);
      }
    } else {
      // Nessun pareggio, chiudi normalmente
      const payload = { ...currentRound, type: currentRound.type || 'poll', votingOpen: false, votes: roundWithVotes.votes, results };
      const { error } = await supabase
        .from('k_rounds')
        .update({ state: 'ended', payload })
        .eq('id', currentRound.id);
      if (error) console.error('Errore closeVoting', error);
      setRoundResults(results);
      setCurrentRound(null);
      setVotesReceived(0);
    }
  };

  const voteSupabase = async (songId) => {
    if (!supabase || !currentUser || !currentRound?.id) return;

    // Controlla se l'utente ha già votato in questo round
    const { data: existingVote } = await supabase
      .from('k_votes')
      .select('*')
      .eq('round_id', currentRound.id)
      .eq('user_id', currentUser.id)
      .maybeSingle();

    let error;
    if (existingVote) {
      // Aggiorna il voto esistente
      const result = await supabase
        .from('k_votes')
        .update({ song_id: String(songId) })
        .eq('round_id', currentRound.id)
        .eq('user_id', currentUser.id);
      error = result.error;
    } else {
      // Inserisci un nuovo voto
      const result = await supabase
        .from('k_votes')
        .insert({ round_id: currentRound.id, user_id: currentUser.id, song_id: String(songId) });
      error = result.error;
    }

    if (error) {
      console.error('Errore voto', error);
      setRoundMessage('Errore nel registrare il voto. Controlla la connessione.');
    } else {
      setRoundMessage('');
    }
  };

  useEffect(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CURRENT_USER_KEY) : null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setCurrentUser(parsed);
      } catch (err) {
        console.error('Errore nel leggere il profilo salvato', err);
      }
    }
  }, []);

  useEffect(() => {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSongLibrary(parsed);
        }
      }
    } catch (err) {
      console.error('Errore nel caricare libreria locale', err);
    }
  }, []);

  useEffect(() => {
    if (backendMode !== 'supabase' || !currentRound?.id || !supabase) return;
    if (votesChannelRef.current) {
      votesChannelRef.current.unsubscribe();
    }
    const ch = supabase
      .channel(`votes-${currentRound.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'k_votes', filter: `round_id=eq.${currentRound.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setCurrentRound(prev => prev ? { ...prev, votes: [...(prev.votes || []), { userId: payload.new.user_id, songId: payload.new.song_id }] } : prev);
          setVotesReceived(prev => prev + 1);
        } else if (payload.eventType === 'DELETE') {
          setCurrentRound(prev => prev ? { ...prev, votes: (prev.votes || []).filter(v => !(v.userId === payload.old.user_id && v.songId === payload.old.song_id)) } : prev);
          setVotesReceived(prev => Math.max(0, prev - 1));
        }
      })
      .subscribe();
    votesChannelRef.current = ch;
    return () => {
      ch.unsubscribe();
    };
  }, [backendMode, currentRound?.id]);

  useEffect(() => {
    if (!isSupabaseReady) {
      console.error('Supabase non configurato. In produzione non è previsto fallback. In dev uso backend locale.');
      if (!isProd) {
        setBackendMode('mock');
      }
      return;
    }
    setBackendMode('supabase');

    const init = async () => {
      // utenti
      const { data: userData, error: userErr } = await supabase.from('k_users').select('*');
      if (userErr) console.error('Errore fetch utenti', userErr);
      if (userData) setUsers(userData);

      // libreria brani
      const { data: songsData, error: songsErr } = await supabase.from('k_songs').select('*').order('title', { ascending: true });
      if (songsErr) console.error('Errore fetch libreria', songsErr);
      if (songsData && songsData.length > 0) {
        setSongLibrary(songsData);
        // Salva anche in localStorage come cache
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(songsData));
        }
      } else {
        // Se non ci sono brani su Supabase, prova a caricare da localStorage
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSongLibrary(parsed);
            // Sincronizza localStorage con Supabase
            console.log('📤 Sincronizzando libreria locale con Supabase...');
            await syncLibraryToSupabase(parsed);
          }
        }
      }

      // round attivo (non ended)
      const { data: roundData, error: roundErr } = await supabase
        .from('k_rounds')
        .select('*')
        .neq('state', 'ended')
        .order('created_at', { ascending: false })
        .limit(1);
      if (roundErr) console.error('Errore fetch round', roundErr);
      if (roundData && roundData.length > 0) {
        const r = roundData[0];
        const payload = r.payload || {};
        const songs = payload.songs || [];
        setCurrentRound({ ...payload, id: r.id, state: r.state, category: r.category, type: payload.type || r.category || 'poll', votingOpen: payload.votingOpen || false, songs, votes: [] });
        const { data: votesData } = await supabase.from('k_votes').select('*').eq('round_id', r.id);
        if (votesData) {
          setCurrentRound(prev => prev ? { ...prev, votes: votesData.map(v => ({ userId: v.user_id, songId: v.song_id })) } : prev);
          setVotesReceived(votesData.length);
        }
      }

      // auto re-register saved user
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(CURRENT_USER_KEY) : null;
    if (saved && !registeredOnceRef.current) {
      try {
        const parsed = JSON.parse(saved);

        // Se ho un ID salvato, cerca l'utente esistente invece di ricrearlo
        if (parsed.id) {
          const { data: existingUser } = await supabase
            .from('k_users')
            .select('*')
            .eq('id', parsed.id)
            .single();

          if (existingUser) {
            // Utente trovato nel database, usa quello
            registeredOnceRef.current = true;
            setCurrentUser(existingUser);
            console.log('✅ Utente esistente recuperato:', existingUser.name);
            return;
          } else {
            // Utente non trovato (forse è stato eliminato), pulisci localStorage
            console.log('⚠️ Utente salvato non trovato nel DB, pulisco localStorage');
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(CURRENT_USER_KEY);
            }
          }
        }

        // Se non ho ID o l'utente non esiste più, non fare nulla
        // L'utente dovrà registrarsi nuovamente manualmente
      } catch (err) {
        console.error('Errore nel recuperare utente salvato', err);
      }
    }
  };

    init();

    const usersChannel = supabase
      .channel('users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'k_users' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setUsers(prev => prev.some(u => u.id === payload.new.id) ? prev : [...prev, payload.new]);
        } else if (payload.eventType === 'DELETE') {
          setUsers(prev => prev.filter(u => u.id !== payload.old.id));
          if (currentUser?.id === payload.old.id) {
            setCurrentUser(null);
            if (typeof localStorage !== 'undefined') localStorage.removeItem(CURRENT_USER_KEY);
          }
        }
      })
      .subscribe();

    const roundsChannel = supabase
      .channel('rounds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'k_rounds' }, (payload) => {
        console.log('📢 Round aggiornato:', payload.eventType, payload.new);
        const r = payload.new;
        const payloadObj = r?.payload || {};
        const songs = payloadObj.songs || [];
        const roundObj = r ? {
          ...payloadObj,
          id: r.id,
          state: r.state,
          category: r.category,
          type: payloadObj.type || r.category || 'poll',
          votingOpen: payloadObj.votingOpen || false,
          songs,
          votes: payloadObj.votes || []
        } : null;

        console.log('✅ Round object:', { votingOpen: roundObj?.votingOpen, state: roundObj?.state });

        if (roundObj?.state === 'ended' && payloadObj.results) {
          setRoundResults(payloadObj.results);
          setCurrentRound(null);
          setView('display');
        } else {
          setCurrentRound(roundObj);
        }
      })
      .subscribe();

    return () => {
      usersChannel?.unsubscribe();
      roundsChannel?.unsubscribe();
      if (votesChannelRef.current) votesChannelRef.current.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const isAdminView = view === 'admin';
    const isParticipant = currentUser && !isAdminView;

    if (!isParticipant) return; // Non fare nulla se non sei un partecipante

    // Se non c'è un round attivo
    if (!currentRound) {
      // Se ci sono risultati da mostrare, permetti di restare in display
      if (roundResults && view === 'display') {
        console.log('📊 Mostrando risultati, resto in display');
        return;
      }
      // Altrimenti, permetti di restare in home, join, participantHome, waiting
      if (view !== 'waiting' && view !== 'join' && view !== 'participantHome' && view !== 'home' && view !== 'display') {
        console.log('🔄 Auto-redirect a waiting (nessun round)');
        setView('waiting');
      }
      return;
    }

    // Gestisci i redirect in base al tipo di round
    // IMPORTANTE: Non redirigere mai se l'utente è in 'home', 'join' o 'participantHome' (permetti sempre navigazione manuale)
    if (view === 'home' || view === 'join' || view === 'participantHome') {
      return; // Permetti all'utente di restare dove ha scelto di andare
    }

    if (currentRound.type === 'wheel') {
      // Ruota della fortuna: mostra sempre display
      if (currentRound.state === 'spinning' || currentRound.state === 'winner_selected' || currentRound.state === 'song_selected') {
        if (view !== 'display' && view !== 'waiting') {
          console.log('🔄 Auto-redirect a display (ruota attiva)');
          setView('display');
        }
      }
    } else if (currentRound.type === 'poll') {
      // Sondaggio: gestisci votazione
      if (currentRound.votingOpen) {
        if (view !== 'voting' && view !== 'display') {
          console.log('🔄 Auto-redirect a voting (poll aperto)');
          setView('voting');
        }
      } else if (view === 'voting') {
        // Se sei in voting ma la votazione è chiusa, torna a waiting
        console.log('🔄 Auto-redirect a waiting (votazione chiusa)');
        setView('waiting');
      }
    } else if (currentRound.type === 'duet') {
      // Duetto: mostra display
      if (view !== 'display' && view !== 'waiting') {
        console.log('🔄 Auto-redirect a display (duetto attivo)');
        setView('display');
      }
    } else if (currentRound.type === 'band_picks') {
      // Scelti dalla Band: mostra display
      if (view !== 'display' && view !== 'waiting') {
        console.log('🔄 Auto-redirect a display (band picks attivo)');
        setView('display');
      }
    } else if (currentRound.type === 'pass_mic') {
      // Passa il Microfono: mostra display
      if (view !== 'display' && view !== 'waiting') {
        console.log('🔄 Auto-redirect a display (passa il microfono attivo)');
        setView('display');
      }
    }
  }, [currentRound, currentUser, view, roundResults]);

  // Funzione helper per sincronizzare libreria locale con Supabase
  const syncLibraryToSupabase = async (songs) => {
    if (!supabase || songs.length === 0) return;

    try {
      // Inserisci tutti i brani (senza ID, lascia che Supabase generi gli ID)
      const songsToInsert = songs.map(({ title, artist, year }) => ({
        title,
        artist,
        year: year || null
      }));

      const { data, error } = await supabase
        .from('k_songs')
        .insert(songsToInsert)
        .select();

      if (error) {
        console.error('❌ Errore sincronizzazione:', error);
      } else {
        console.log(`✅ ${data.length} brani sincronizzati con Supabase`);
        // Aggiorna lo stato locale con gli ID di Supabase
        setSongLibrary(data);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
      }
    } catch (err) {
      console.error('❌ Errore sync:', err);
    }
  };

  const handleUserJoin = (name, photo) => {
    if (currentUser?.id) {
      setView('waiting');
      return;
    }
    if (backendMode === 'supabase') {
      registeredOnceRef.current = true;
      registerUserSupabase(name, photo);
    } else {
      const user = { id: Date.now(), name, photo, joinedAt: new Date() };
      setUsers(prev => [...prev, user]);
      setCurrentUser(user);
      if (typeof localStorage !== 'undefined') localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
      registeredOnceRef.current = true;
      setView('waiting');
    }
  };

  const handleRemoveUser = (id) => {
    if (backendMode === 'supabase') {
      removeUserSupabase(id);
    } else {
      setUsers(prev => prev.filter(u => u.id !== id));
      setCurrentRound(prev => prev ? { ...prev, votes: (prev.votes || []).filter(v => v.userId !== id) } : prev);
    }
  };

  const handleResetCurrentUser = () => {
    // Cancella il profilo locale e permette di creare un nuovo account
    setCurrentUser(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
    registeredOnceRef.current = false;
    setView('join');
  };

  const handleSongFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const { songs, errors } = parseSongsFromCSV(text);

      setLibraryErrors(errors);
      if (songs.length > 0) {
        // Salva su Supabase se configurato
        if (backendMode === 'supabase' && supabase) {
          setImportMessage('⏳ Caricamento in corso...');

          try {
            // Prima svuota la tabella esistente
            const { error: deleteError } = await supabase
              .from('k_songs')
              .delete()
              .neq('id', 0); // Trucco per eliminare tutti i record

            if (deleteError) {
              console.error('Errore eliminazione brani esistenti:', deleteError);
            }

            // Poi inserisci i nuovi
            await syncLibraryToSupabase(songs);
            setImportMessage(`✅ ${songs.length} brani caricati e sincronizzati!`);
          } catch (err) {
            console.error('Errore import:', err);
            // Fallback: salva solo in locale
            setSongLibrary(songs);
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
            }
            setImportMessage(`⚠️ ${songs.length} brani caricati in locale (errore sincronizzazione)`);
          }
        } else {
          // Modalità locale
          setSongLibrary(songs);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
          }
          setImportMessage(`Caricati ${songs.length} brani dalla libreria CSV.`);
        }
      } else {
        setImportMessage('');
      }
    };
    reader.onerror = () => {
      setLibraryErrors(['Impossibile leggere il file CSV.']);
    };
    reader.readAsText(file, 'UTF-8');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleChoFilesChange = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setImportMessage(`⏳ Importazione di ${files.length} file ChordPro in corso...`);
    setLibraryErrors([]);

    const parsedSongs = [];
    const errors = [];

    // Leggi tutti i file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error(`Errore lettura file ${file.name}`));
          reader.readAsText(file, 'UTF-8');
        });

        const parsed = parseChordProFile(file.name, content);
        parsedSongs.push(parsed);
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    setLibraryErrors(errors);

    if (parsedSongs.length > 0) {
      // Salva su Supabase se configurato
      if (backendMode === 'supabase' && supabase) {
        try {
          // Prepara i dati per l'inserimento
          const songsToInsert = parsedSongs.map(({ title, artist, year, chord_sheet }) => ({
            title,
            artist,
            year: year || null,
            chord_sheet
          }));

          // Inserisci tutti i brani (senza svuotare la libreria esistente)
          const { data, error } = await supabase
            .from('k_songs')
            .insert(songsToInsert)
            .select();

          if (error) {
            console.error('Errore inserimento brani:', error);
            throw error;
          }

          // Aggiorna la libreria locale con i nuovi brani
          const updatedLibrary = [...songLibrary, ...data].sort((a, b) =>
            a.title.localeCompare(b.title)
          );
          setSongLibrary(updatedLibrary);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
          }

          setImportMessage(`✅ ${parsedSongs.length} brani ChordPro importati con successo!`);
        } catch (err) {
          console.error('Errore import ChordPro:', err);
          setImportMessage(`⚠️ Errore durante l'importazione su Supabase`);
        }
      } else {
        // Modalità locale
        const updatedLibrary = [...songLibrary, ...parsedSongs].sort((a, b) =>
          a.title.localeCompare(b.title)
        );
        setSongLibrary(updatedLibrary);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
        }
        setImportMessage(`✅ ${parsedSongs.length} brani ChordPro importati in locale!`);
      }
    }

    // Reset input
    if (choFilesInputRef.current) {
      choFilesInputRef.current.value = '';
    }

    setTimeout(() => setImportMessage(''), 5000);
  };

  const handlePreparePoll = () => {
    setRoundMessage('');
    if (songLibrary.length < 10) {
      setRoundMessage('Servono almeno 10 brani in libreria per preparare un sondaggio.');
      return;
    }

    if (backendMode === 'supabase') {
      preparePollSupabase();
    } else {
      const selectedSongs = [...songLibrary].sort(() => Math.random() - 0.5).slice(0, 10);
      const noneOption = { id: -1, title: 'Nessuno', artist: '—', year: null };
      const songs = [...selectedSongs, noneOption];
      const round = { id: Date.now(), type: 'poll', category: 'poll', songs, votingOpen: false, votes: [], state: 'prepared' };
      setCurrentRound(round);
      setRoundResults(null);
      setVotesReceived(0);
      setRoundMessage('Round preparato con 10 brani casuali.');
    }
  };

  const handleOpenVoting = () => {
    if (!currentRound || currentRound.type !== 'poll') {
      setRoundMessage('Prepara prima un round sondaggio.');
      return;
    }
    if (backendMode === 'supabase') {
      openVotingSupabase();
      setRoundMessage('Votazione aperta: i partecipanti possono votare.');
    } else {
      setCurrentRound(prev => prev ? { ...prev, votingOpen: true, state: 'voting' } : prev);
      setRoundMessage('Votazione aperta: i partecipanti possono votare.');
    }
  };

  const handleCloseVoting = () => {
    if (!currentRound) return;
    if (backendMode === 'supabase') {
      closeVotingSupabase();
      setRoundMessage('Votazione chiusa, calcolo risultati...');
    } else {
      const results = computeResults(currentRound);

      // Gestione spareggio anche in modalità offline
      if (results.tiedSongs && results.tiedSongs.length >= 2) {
        console.log('⚖️ Pareggio rilevato! Avvio spareggio con', results.tiedSongs.length, 'brani');
        setRoundMessage(`⚖️ Pareggio! Preparato spareggio tra ${results.tiedSongs.length} brani.`);

        const tiebreakRound = {
          id: Date.now(),
          type: 'poll',
          category: 'poll',
          songs: results.tiedSongs,
          votingOpen: false,
          votes: [],
          state: 'prepared',
          isTiebreaker: true
        };

        setCurrentRound(tiebreakRound);
        setRoundResults(null);
        setVotesReceived(0);
      } else {
        setRoundResults(results);
        setCurrentRound(null);
        setVotesReceived(0);
        setRoundMessage('Votazione chiusa, risultati pronti.');
        setView('display');
      }
    }
  };

  const handleResetRound = () => {
    if (backendMode === 'supabase') {
      supabase?.from('k_rounds').update({ state: 'ended', payload: { results: null } }).eq('id', currentRound?.id);
    }
    setRoundResults(null);
    setRoundMessage('Round azzerato.');
    setCurrentRound(null);
    setVotesReceived(0);
  };

  const handleResetParticipants = async () => {
    if (backendMode === 'supabase') {
      const { error } = await supabase.from('k_users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        console.error('Errore reset utenti', error);
      }
    }
    setUsers([]);
    setCurrentUser(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  };

  const handleAddSong = async (title, artist, year, chordSheet = null) => {
    if (!title || !artist) {
      alert('Titolo e artista sono obbligatori');
      return;
    }

    if (backendMode === 'supabase' && supabase) {
      // Salva su Supabase
      const { data, error } = await supabase
        .from('k_songs')
        .insert({
          title: title.trim(),
          artist: artist.trim(),
          year: year ? parseInt(year) : null,
          chord_sheet: chordSheet || null
        })
        .select()
        .single();

      if (error) {
        console.error('Errore aggiunta brano:', error);
        alert('Errore durante il salvataggio del brano');
        return;
      }

      // Aggiorna stato locale
      const updatedLibrary = [...songLibrary, data].sort((a, b) => a.title.localeCompare(b.title));
      setSongLibrary(updatedLibrary);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
      }
    } else {
      // Modalità locale
      const newSong = {
        id: Date.now(),
        title: title.trim(),
        artist: artist.trim(),
        year: year ? parseInt(year) : null,
        chord_sheet: chordSheet || null
      };
      const updatedLibrary = [...songLibrary, newSong];
      setSongLibrary(updatedLibrary);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
      }
    }

    setShowAddSongForm(false);
    setImportMessage(`Brano "${title}" aggiunto con successo!`);
    setTimeout(() => setImportMessage(''), 3000);
  };

  const handleUpdateSong = async (id, title, artist, year, chordSheet = undefined) => {
    if (!title || !artist) {
      alert('Titolo e artista sono obbligatori');
      return;
    }

    if (backendMode === 'supabase' && supabase) {
      // Aggiorna su Supabase
      const updateData = {
        title: title.trim(),
        artist: artist.trim(),
        year: year ? parseInt(year) : null
      };
      if (chordSheet !== undefined) {
        updateData.chord_sheet = chordSheet;
      }

      const { error } = await supabase
        .from('k_songs')
        .update(updateData)
        .eq('id', id);

      if (error) {
        console.error('Errore modifica brano:', error);
        alert('Errore durante la modifica del brano');
        return;
      }
    }

    // Aggiorna stato locale
    const updatedLibrary = songLibrary.map(song => {
      if (song.id === id) {
        const updated = {
          ...song,
          title: title.trim(),
          artist: artist.trim(),
          year: year ? parseInt(year) : null
        };
        if (chordSheet !== undefined) {
          updated.chord_sheet = chordSheet;
        }
        return updated;
      }
      return song;
    });
    setSongLibrary(updatedLibrary);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
    }
    setEditingSongId(null);
    setImportMessage('Brano modificato con successo!');
    setTimeout(() => setImportMessage(''), 3000);
  };

  const handleDeleteSong = async (id) => {
    if (!confirm('Sei sicuro di voler eliminare questo brano?')) return;

    if (backendMode === 'supabase' && supabase) {
      // Elimina da Supabase
      const { error } = await supabase
        .from('k_songs')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Errore eliminazione brano:', error);
        alert('Errore durante l\'eliminazione del brano');
        return;
      }
    }

    // Aggiorna stato locale
    const updatedLibrary = songLibrary.filter(song => song.id !== id);
    setSongLibrary(updatedLibrary);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
    }
    setImportMessage('Brano eliminato!');
    setTimeout(() => setImportMessage(''), 3000);
  };

  const handleStartWheel = async () => {
    setRoundMessage('');
    if (users.length < 2) {
      setRoundMessage('Servono almeno 2 partecipanti per la Ruota della Fortuna.');
      return;
    }
    if (songLibrary.length < 20) {
      setRoundMessage('Servono almeno 20 brani in libreria per la Ruota della Fortuna.');
      return;
    }

    // PRE-CALCOLA il vincitore qui (invece che nella ruota) per sincronizzazione
    const randomWinnerIndex = Math.floor(Math.random() * users.length);
    const preselectedWinner = users[randomWinnerIndex];

    // Seleziona 20 brani casuali
    const selectedSongs = [...songLibrary].sort(() => Math.random() - 0.5).slice(0, 20);

    if (backendMode === 'supabase') {
      const payload = {
        type: 'wheel',
        state: 'spinning',
        users: users,
        songs: selectedSongs,
        preselectedWinner: preselectedWinner,  // Vincitore già scelto!
        preselectedWinnerIndex: randomWinnerIndex,
        winner: null,
        selectedSong: null
      };
      const { data, error } = await supabase
        .from('k_rounds')
        .insert({ category: 'wheel', state: 'spinning', payload })
        .select()
        .single();
      if (error) {
        console.error('Errore avvio ruota', error);
        setRoundMessage('Errore nell\'avvio della ruota.');
        return;
      }
      setCurrentRound({ ...payload, id: data.id });
      setRoundMessage('Ruota della Fortuna avviata!');
      setView('display');
    } else {
      const round = {
        id: Date.now(),
        type: 'wheel',
        category: 'wheel',
        state: 'spinning',
        users: users,
        songs: selectedSongs,
        preselectedWinner: preselectedWinner,
        preselectedWinnerIndex: randomWinnerIndex,
        winner: null,
        selectedSong: null
      };
      setCurrentRound(round);
      setRoundMessage('Ruota della Fortuna avviata!');
      setView('display');
    }
  };

  const handleWheelComplete = async (winner) => {
    if (backendMode === 'supabase' && currentRound?.id) {
      const payload = {
        ...currentRound,
        state: 'winner_selected',
        winner: winner
      };
      await supabase
        .from('k_rounds')
        .update({ state: 'winner_selected', payload })
        .eq('id', currentRound.id);
    }
    setCurrentRound(prev => prev ? { ...prev, state: 'winner_selected', winner } : prev);
  };

  const handleSongSelected = async (song) => {
    console.log('🎵 Canzone selezionata:', song.title);
    if (backendMode === 'supabase' && currentRound?.id) {
      const payload = {
        ...currentRound,
        state: 'song_selected',
        selectedSong: song
      };
      console.log('📤 Aggiornamento round a song_selected in Supabase...');
      const { error } = await supabase
        .from('k_rounds')
        .update({ state: 'song_selected', payload })
        .eq('id', currentRound.id);
      if (error) {
        console.error('❌ Errore aggiornamento round:', error);
      } else {
        console.log('✅ Round aggiornato con successo');
      }
    }
    setCurrentRound(prev => prev ? { ...prev, state: 'song_selected', selectedSong: song } : prev);
  };

  const findDuetPair = async () => {
    if (backendMode !== 'supabase' || !supabase) {
      setRoundMessage('I duetti sono disponibili solo con Supabase.');
      return null;
    }

    // Cerca tutti i round passati di tipo 'poll' che sono terminati
    const { data: pastRounds, error: roundsError } = await supabase
      .from('k_rounds')
      .select('*')
      .eq('category', 'poll')
      .eq('state', 'ended')
      .order('created_at', { ascending: false });

    if (roundsError || !pastRounds || pastRounds.length === 0) {
      console.log('Nessun round passato trovato');
      return null;
    }

    // Per ogni round, cerca coppie di utenti che hanno votato la stessa canzone
    for (const round of pastRounds) {
      const { data: votes, error: votesError } = await supabase
        .from('k_votes')
        .select('*')
        .eq('round_id', round.id);

      if (votesError || !votes || votes.length < 2) continue;

      // Raggruppa i voti per canzone
      const votesBySong = {};
      votes.forEach(vote => {
        const songId = vote.song_id;
        if (!votesBySong[songId]) votesBySong[songId] = [];
        votesBySong[songId].push(vote.user_id);
      });

      // Trova una canzone con almeno 2 voti
      for (const [songId, userIds] of Object.entries(votesBySong)) {
        if (userIds.length >= 2) {
          // Prendi i primi 2 utenti casuali che hanno votato questa canzone
          const shuffled = [...userIds].sort(() => Math.random() - 0.5);
          const user1Id = shuffled[0];
          const user2Id = shuffled[1];

          // Trova le info degli utenti
          const user1 = users.find(u => u.id === user1Id);
          const user2 = users.find(u => u.id === user2Id);

          // Trova la canzone dal payload del round
          const roundPayload = round.payload || {};
          const songs = roundPayload.songs || [];
          const song = songs.find(s => String(s.id) === String(songId));

          if (user1 && user2 && song) {
            console.log('✅ Duetto trovato:', user1.name, '+', user2.name, '→', song.title);
            return {
              user1,
              user2,
              song,
              roundId: round.id
            };
          }
        }
      }
    }

    console.log('❌ Nessun duetto trovato');
    return null;
  };

  const handleStartDuet = async () => {
    setRoundMessage('Cercando duetto...');

    const duet = await findDuetPair();

    if (!duet) {
      setRoundMessage('❌ Nessun duetto trovato. Serve almeno 1 votazione passata con 2 utenti che hanno votato la stessa canzone.');
      return;
    }

    // Crea un round di tipo 'duet'
    if (backendMode === 'supabase') {
      const payload = {
        type: 'duet',
        user1: duet.user1,
        user2: duet.user2,
        song: duet.song,
        state: 'ready'
      };

      const { data, error } = await supabase
        .from('k_rounds')
        .insert({ category: 'duet', state: 'ready', payload })
        .select()
        .single();

      if (error) {
        console.error('Errore creazione duetto', error);
        setRoundMessage('❌ Errore nella creazione del duetto.');
        return;
      }

      setCurrentRound({ ...payload, id: data.id });
      setRoundMessage(`✅ Duetto preparato: ${duet.user1.name} + ${duet.user2.name} → ${duet.song.title}`);
      setView('display');
    } else {
      const round = {
        id: Date.now(),
        type: 'duet',
        category: 'duet',
        user1: duet.user1,
        user2: duet.user2,
        song: duet.song,
        state: 'ready'
      };

      setCurrentRound(round);
      setRoundMessage(`✅ Duetto preparato: ${duet.user1.name} + ${duet.user2.name} → ${duet.song.title}`);
      setView('display');
    }
  };

  const handleStartBandPicks = async () => {
    if (bandPicksList.length === 0) {
      setRoundMessage('❌ Aggiungi almeno un brano alla scaletta!');
      return;
    }

    setCurrentBandPickIndex(0);
    const payload = {
      type: 'band_picks',
      songs: bandPicksList,
      currentIndex: 0,
      state: 'showing'
    };

    if (backendMode === 'supabase') {
      const { data, error } = await supabase
        .from('k_rounds')
        .insert({ category: 'band_picks', state: 'showing', payload })
        .select()
        .single();

      if (error) {
        console.error('Errore creazione scaletta band', error);
        setRoundMessage('❌ Errore nella creazione della scaletta.');
        return;
      }

      setCurrentRound({ ...payload, id: data.id });
    } else {
      setCurrentRound({ ...payload, id: Date.now() });
    }

    setRoundMessage(`🎸 Scaletta avviata: ${bandPicksList.length} brani`);
    setView('display');
  };

  const handleNextBandPick = async () => {
    if (!currentRound || currentRound.type !== 'band_picks') return;

    const nextIndex = (currentRound.currentIndex || 0) + 1;

    if (nextIndex >= bandPicksList.length) {
      setRoundMessage('✅ Scaletta completata!');
      handleEndRound();
      return;
    }

    const payload = {
      ...currentRound,
      currentIndex: nextIndex
    };

    if (backendMode === 'supabase' && currentRound.id) {
      await supabase
        .from('k_rounds')
        .update({ payload })
        .eq('id', currentRound.id);
    }

    setCurrentRound(payload);
    setCurrentBandPickIndex(nextIndex);
  };

  const handlePrevBandPick = async () => {
    if (!currentRound || currentRound.type !== 'band_picks') return;

    const prevIndex = Math.max(0, (currentRound.currentIndex || 0) - 1);

    const payload = {
      ...currentRound,
      currentIndex: prevIndex
    };

    if (backendMode === 'supabase' && currentRound.id) {
      await supabase
        .from('k_rounds')
        .update({ payload })
        .eq('id', currentRound.id);
    }

    setCurrentRound(payload);
    setCurrentBandPickIndex(prevIndex);
  };

  const handleStartPassMic = async () => {
    if (users.length === 0) {
      setRoundMessage('❌ Nessun partecipante registrato!');
      return;
    }

    // Seleziona un partecipante a caso
    const randomUser = users[Math.floor(Math.random() * users.length)];

    const payload = {
      type: 'pass_mic',
      selectedUser: randomUser,
      state: 'showing'
    };

    if (backendMode === 'supabase') {
      const { data, error } = await supabase
        .from('k_rounds')
        .insert({ category: 'pass_mic', state: 'showing', payload })
        .select()
        .single();

      if (error) {
        console.error('Errore creazione passa il microfono', error);
        setRoundMessage('❌ Errore nella selezione del partecipante.');
        return;
      }

      setCurrentRound({ ...payload, id: data.id });
    } else {
      setCurrentRound({ ...payload, id: Date.now() });
    }

    setRoundMessage(`🎤 Selezionato: ${randomUser.name}`);
    setView('display');
  };

  const handleStartRound = (category) => {
    if (category === 'poll') {
      handlePreparePoll();
      return;
    }
    if (category === 'wheel') {
      handleStartWheel();
      return;
    }
    if (category === 'duet') {
      handleStartDuet();
      return;
    }
    if (category === 'band_picks') {
      handleStartBandPicks();
      return;
    }
    if (category === 'pass_mic') {
      handleStartPassMic();
      return;
    }
    setRoundMessage('Modalità extra non ancora disponibili.');
  };

  const handleVote = (songId) => {
    if (currentUser && currentRound) {
      if (backendMode === 'supabase') {
        voteSupabase(songId);
      } else {
        setCurrentRound(prev => prev ? { ...prev, votes: [...(prev.votes || []), { userId: currentUser.id, songId }] } : prev);
        setVotesReceived(prev => prev + 1);
      }
    }
  };

  const handleEndRound = () => {
    if (currentRound?.type === 'poll') {
      handleCloseVoting();
    }
  };

  // ============================================================================
  // VISTA DISPLAY/PROIEZIONE
  // ============================================================================
  if (isDisplayMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-8">
        <div className="max-w-7xl w-full">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
              🎤 Karaoke Night 🎶
            </h1>
            <p className="text-2xl text-gray-300">Modalità Proiezione</p>
          </div>

          {/* Round Attivo / Risultati */}
          {currentRound && currentRound.votingOpen && (
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-8 border border-purple-500/30">
              <h2 className="text-4xl font-bold text-amber-400 mb-6 text-center">
                🗳️ Votazione in Corso
              </h2>
              <div className="grid grid-cols-2 gap-6">
                {currentRound.songs?.map((song, idx) => (
                  <div
                    key={song.id}
                    className="bg-gray-700/50 rounded-2xl p-6 border border-gray-600 hover:border-purple-400 transition-all"
                  >
                    <div className="text-3xl font-bold text-white mb-2">{song.title}</div>
                    <div className="text-xl text-gray-300">{song.artist}</div>
                    {song.year && <div className="text-sm text-gray-400 mt-2">Anno: {song.year}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-3 bg-green-600/20 border border-green-500/50 rounded-xl px-6 py-4">
                  <Users className="w-8 h-8 text-green-400" />
                  <span className="text-3xl font-bold text-white">{votesReceived}</span>
                  <span className="text-xl text-gray-300">voti ricevuti</span>
                </div>
              </div>
            </div>
          )}

          {/* Risultati */}
          {roundResults && (
            <div className="space-y-8">
              {roundResults.winner ? (
                <div className="bg-gradient-to-br from-amber-500/20 to-yellow-500/20 backdrop-blur-xl rounded-3xl p-12 border-4 border-amber-400">
                  <div className="text-center">
                    <Trophy className="w-32 h-32 mx-auto mb-6 text-amber-400" />
                    <h2 className="text-5xl font-black text-amber-400 mb-4">🏆 VINCITORE 🏆</h2>
                    <div
                      className={roundResults.winner.chord_sheet ? "cursor-pointer hover:scale-105 transition-transform" : ""}
                      onClick={() => roundResults.winner.chord_sheet && setViewingSong(roundResults.winner)}
                    >
                      <p className="text-6xl font-bold text-white mb-4">{roundResults.winner.title}</p>
                      <p className="text-4xl text-gray-200 mb-2">{roundResults.winner.artist}</p>
                      {roundResults.winner.chord_sheet && (
                        <p className="text-xl text-amber-300 animate-pulse mt-4">📄 Clicca per vedere lo spartito</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : roundResults.tiedSongs?.length > 0 ? (
                <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 backdrop-blur-xl rounded-3xl p-12 border-4 border-orange-400">
                  <h2 className="text-5xl font-black text-orange-400 mb-8 text-center">⚖️ PAREGGIO!</h2>
                  <div className="grid grid-cols-2 gap-6">
                    {roundResults.tiedSongs.map(song => (
                      <div key={song.id} className="bg-gray-800/50 rounded-2xl p-6 border-2 border-orange-400">
                        <p className="text-4xl font-bold text-white mb-2">{song.title}</p>
                        <p className="text-2xl text-gray-300">{song.artist}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Classifica */}
              {roundResults.stats && roundResults.stats.length > 0 && (
                <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-8 border border-gray-700">
                  <h3 className="text-3xl font-bold text-purple-400 mb-6">📊 Classifica Completa</h3>
                  <div className="space-y-4">
                    {roundResults.stats.map((stat, i) => {
                      const maxVotes = Math.max(...roundResults.stats.map(s => s.votes));
                      const percent = maxVotes > 0 ? (stat.votes / maxVotes) * 100 : 0;
                      return (
                        <div key={`${stat.song.id}-${i}`} className="bg-gray-700/50 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-2xl font-bold text-white">{stat.song.title}</div>
                            <div className="text-3xl font-bold text-amber-400">{stat.votes} 🎵</div>
                          </div>
                          <div className="text-lg text-gray-300 mb-2">{stat.song.artist}</div>
                          <div className="h-3 bg-gray-600 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stato Idle */}
          {!currentRound && !roundResults && (
            <div className="text-center">
              <Music className="w-48 h-48 mx-auto mb-8 text-purple-400 opacity-50" />
              <p className="text-4xl text-gray-400">In attesa del prossimo round...</p>
            </div>
          )}
        </div>

        {/* ChordSheetViewer per spartiti */}
        {viewingSong && (
          <ChordSheetViewer
            song={viewingSong}
            onClose={() => setViewingSong(null)}
            onUpdateSong={() => {}}
          />
        )}
      </div>
    );
  }

  if (view === 'home') {
    const siteUrl = import.meta.env.VITE_SITE_URL
      ? import.meta.env.VITE_SITE_URL
      : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <Mic className="w-20 h-20 mx-auto mb-4 text-purple-600" />
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Karaoke Night</h1>
            <p className="text-gray-600">Sistema Interattivo per Serate Musicali</p>
          </div>

          <div className="space-y-3 mb-6">
            <button
              onClick={() => setShowQRCodes(v => !v)}
              className="w-full bg-purple-100 text-purple-800 border border-purple-300 rounded-lg px-4 py-3 hover:bg-purple-200"
            >
              {showQRCodes ? 'Nascondi QR accesso/Wi‑Fi' : 'Mostra QR accesso/Wi‑Fi'}
            </button>
            {showQRCodes && (
              <div className="space-y-3">
                <QrCode
                  value={siteUrl}
                  label="Accedi al sito"
                  sublabel="Inquadra per aprire la webapp"
                />
                <QrCode
                  value={generateWifiQR(wifiConfig.ssid, wifiConfig.password, wifiConfig.encryption)}
                  label="Wi‑Fi"
                  sublabel={`${wifiConfig.ssid} (${wifiConfig.encryption})`}
                />
                <button
                  onClick={() => setShowWiFiConfig(v => !v)}
                  className="w-full text-sm text-purple-700 hover:text-purple-900 underline"
                >
                  {showWiFiConfig ? 'Nascondi configurazione WiFi' : 'Modifica WiFi'}
                </button>
                {showWiFiConfig && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <h4 className="font-semibold text-purple-900 mb-3">Configurazione WiFi</h4>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const formData = new FormData(e.target);
                        const newConfig = {
                          ssid: formData.get('ssid'),
                          password: formData.get('password'),
                          encryption: formData.get('encryption')
                        };
                        setWifiConfig(newConfig);
                        localStorage.setItem('wifi_config', JSON.stringify(newConfig));
                        setShowWiFiConfig(false);
                      }}
                      className="space-y-3"
                    >
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SSID (Nome rete)</label>
                        <input
                          name="ssid"
                          defaultValue={wifiConfig.ssid}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Nome della rete WiFi"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                          name="password"
                          type="text"
                          defaultValue={wifiConfig.password}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Password WiFi"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo crittografia</label>
                        <select
                          name="encryption"
                          defaultValue={wifiConfig.encryption}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="WPA">WPA/WPA2</option>
                          <option value="WEP">WEP</option>
                          <option value="nopass">Nessuna (rete aperta)</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm font-semibold"
                        >
                          Salva
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowWiFiConfig(false)}
                          className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 text-sm font-semibold"
                        >
                          Annulla
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <button
              onClick={() => {
                setIsAdminMode(false);
                if (typeof localStorage !== 'undefined') localStorage.setItem(ADMIN_MODE_KEY, 'false');
                setView('participantHome');
              }}
              className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-3 text-lg font-semibold"
            >
              <Users className="w-6 h-6" />
              Accedi come Partecipante
            </button>

            <button
              onClick={() => {
                setIsAdminMode(true);
                if (typeof localStorage !== 'undefined') localStorage.setItem(ADMIN_MODE_KEY, 'true');
                setView('admin');
              }}
              className="w-full bg-green-600 text-white py-4 rounded-lg hover:bg-green-700 flex items-center justify-center gap-3 text-lg font-semibold"
            >
              <Play className="w-6 h-6" />
              Pannello Organizzatore
            </button>

            <button
              onClick={() => setView('display')}
              className="w-full bg-purple-600 text-white py-4 rounded-lg hover:bg-purple-700 flex items-center justify-center gap-3 text-lg font-semibold"
            >
              <Trophy className="w-6 h-6" />
              Schermo Principale (display)
            </button>
          </div>

          <div className="mt-8 text-center text-sm text-gray-500">
            <p>Utenti connessi: {users.length}</p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'participantHome') {
    const modes = [
      { id: 'poll', name: 'Sondaggio Brani', description: 'Vota il brano preferito' },
      { id: 'duet', name: 'Duetti', description: 'Sfida in coppia' },
      { id: 'wheel', name: 'Ruota della Fortuna', description: 'Selezione casuale' },
      { id: 'free_choice', name: 'Scelta Libera', description: 'Scegli tu il brano' },
      { id: 'year', name: 'Categoria per Anno', description: 'Brani per anno' },
      { id: 'pass_mic', name: 'Passa il Microfono', description: 'Catena di cantanti' }
    ];
    const activeId = currentRound?.type;

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 p-4">
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-3xl font-bold mb-4 text-center text-gray-800">Area Partecipante</h2>
            <p className="text-center text-gray-600 mb-6">Scegli cosa vuoi fare o registrati.</p>

            {currentUser && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center gap-4">
                <img src={currentUser.photo} alt={currentUser.name} className="w-16 h-16 rounded-full border-2 border-blue-400" />
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">Utente corrente:</p>
                  <p className="text-lg text-blue-600">{currentUser.name}</p>
                </div>
                <button
                  onClick={handleResetCurrentUser}
                  className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 font-semibold text-sm"
                >
                  Cambia Account
                </button>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <button
                onClick={() => (currentUser ? setView('waiting') : setView('join'))}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-semibold"
              >
                {currentUser ? `Continua come ${currentUser.name}` : 'Registrati / Entra'}
              </button>
              {currentRound?.votingOpen && (
                <button
                  onClick={() => setView('voting')}
                  className="flex-1 bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 font-semibold"
                >
                  Vai al voto
                </button>
              )}
              <button
                onClick={() => setView('home')}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 font-semibold"
              >
                Home
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {modes.map(mode => (
                <div
                  key={mode.id}
                  className={`p-4 rounded-xl border transition-all ${
                    activeId === mode.id
                      ? 'border-blue-500 bg-blue-50 shadow-lg'
                      : 'border-gray-200 bg-white hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-800">{mode.name}</h3>
                    {activeId === mode.id && (
                      <span className="text-sm text-blue-700 font-semibold">Attivo</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{mode.description}</p>
                  {activeId === mode.id && currentRound?.votingOpen && (
                    <button
                      onClick={() => setView('voting')}
                      className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
                    >
                      Vai al voto
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'adminLogin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-2xl font-bold mb-4 text-center">Accesso Organizzatore</h2>
          <p className="text-sm text-gray-600 text-center mb-6">Inserisci credenziali (user: admin, pw: admin).</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const user = formData.get('user');
              const pass = formData.get('pass');
              if (user === 'admin' && pass === 'admin') {
                setIsAdminMode(true);
                if (typeof localStorage !== 'undefined') localStorage.setItem(ADMIN_MODE_KEY, 'true');
                setAdminLoginError('');
                setView('admin');
              } else {
                setAdminLoginError('Credenziali non valide.');
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-semibold mb-1">User</label>
              <input name="user" className="w-full border rounded-lg px-3 py-2" autoComplete="username" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Password</label>
              <input name="pass" type="password" className="w-full border rounded-lg px-3 py-2" autoComplete="current-password" />
            </div>
            {adminLoginError && <p className="text-sm text-red-600">{adminLoginError}</p>}
            <button
              type="submit"
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-semibold"
            >
              Accedi
            </button>
          </form>
          <button
            onClick={() => setView('home')}
            className="mt-4 text-sm text-gray-600 hover:text-gray-800 block mx-auto"
          >
            ← Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  if (view === 'join') {
    return <UserJoinView onJoin={handleUserJoin} onBack={() => setView('home')} />;
  }

  if (view === 'waiting') {
    if (!currentUser) {
      setView('join');
      return null;
    }
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="mb-6">
            <img src={currentUser.photo} alt={currentUser.name} className="w-32 h-32 rounded-full mx-auto border-4 border-green-500" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Benvenuto, {currentUser.name}! 🎉</h2>
          <p className="text-gray-600 mb-8">Sei registrato! Attendi che l'organizzatore avvii il prossimo round...</p>
          
          <div className="animate-pulse">
            <Music className="w-16 h-16 text-green-500 mx-auto" />
          </div>

          {currentRound?.votingOpen && (
            <button
              onClick={() => setView('voting')}
              className="mt-6 w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700"
            >
              Vai al voto
            </button>
          )}

          <button
            onClick={() => setView('home')}
            className="mt-8 text-gray-600 hover:text-gray-800"
          >
            ← Torna alla Home
          </button>
          {isAdminMode && (
            <button
              onClick={() => setView('admin')}
              className="mt-2 text-gray-600 hover:text-gray-800 block mx-auto"
            >
              Vai al Pannello Organizzatore
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === 'voting' && currentRound && currentRound.votingOpen) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 p-4">
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl p-6">
            <VotingInterface
              songs={currentRound.songs}
              onVote={handleVote}
            />
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-white">
            <button
              onClick={() => setView('waiting')}
              className="hover:text-gray-200"
            >
              ← Torna in attesa
            </button>
            <button
              onClick={() => setView('home')}
              className="hover:text-gray-200"
            >
              Vai alla Home
            </button>
            {isAdminMode && (
              <button
                onClick={() => setView('admin')}
                className="hover:text-gray-200"
              >
                Pannello Organizzatore
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'admin') {
    if (!isAdminMode) {
      setView('adminLogin');
      return null;
    }
    const gameCategories = [
      { id: 'poll', name: 'Sondaggio Brani', icon: Music, color: 'from-purple-500 to-pink-500' },
      { id: 'duet', name: 'Duetti', icon: Users, color: 'from-blue-500 to-cyan-500' },
      { id: 'wheel', name: 'Ruota della Fortuna', icon: Disc, color: 'from-yellow-500 to-orange-500' },
      { id: 'band_picks', name: 'Scelti dalla Band', icon: Music, color: 'from-red-500 to-pink-500' },
      { id: 'pass_mic', name: 'Passa il Microfono', icon: Mic, color: 'from-pink-500 to-rose-500' }
    ];
    const pollPrepared = currentRound && currentRound.type === 'poll';

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4">
        <div className="max-w-6xl mx-auto py-8">
          {/* Header con toggle modalità */}
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-4xl font-bold text-amber-400">
              {adminViewMode === 'compact' ? '🎯 Dashboard' : '🎛️ Pannello Organizzatore'}
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.open(`${window.location.origin}/?display=true`, '_blank', 'width=1920,height=1080')}
                className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6 py-3 rounded-xl transition-all shadow-lg"
                title="Apri display per proiezione"
              >
                <Maximize2 className="w-5 h-5" />
                🖥️ Apri Display
              </button>
              <button
                onClick={() => setAdminViewMode(adminViewMode === 'compact' ? 'extended' : 'compact')}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-6 py-3 rounded-xl transition-all border border-gray-700"
              >
                <Eye className="w-5 h-5" />
                {adminViewMode === 'compact' ? 'Estesa' : 'Compatta'}
              </button>
            </div>
          </div>

          {/* Stats Cards - Solo in modalità compatta */}
          {adminViewMode === 'compact' && (
            <div className="grid grid-cols-3 gap-6 mb-8">
              {/* Card Partecipanti */}
              <div className="bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-blue-500/30 rounded-2xl p-6 text-center backdrop-blur-xl">
                <Users className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{users.length}</p>
                <p className="text-gray-300 font-semibold">Partecipanti</p>
              </div>

              {/* Card Brani */}
              <div className="bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-500/30 rounded-2xl p-6 text-center backdrop-blur-xl">
                <Music className="w-12 h-12 text-purple-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{songLibrary.length}</p>
                <p className="text-gray-300 font-semibold">Brani</p>
              </div>

              {/* Card Round Attivo */}
              <div className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 rounded-2xl p-6 text-center backdrop-blur-xl">
                <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{currentRound ? '✓' : '—'}</p>
                <p className="text-gray-300 font-semibold">{currentRound ? 'Round Attivo' : 'Nessun Round'}</p>
              </div>
            </div>
          )}

          {/* Card Utenti - Solo in modalità estesa */}
          {adminViewMode === 'extended' && (
          <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="w-7 h-7 text-blue-600" />
                  Partecipanti
                </h3>
                <p className="text-sm text-gray-600 mt-1">Gestisci i partecipanti registrati</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold text-blue-600">{users.length}</p>
                <p className="text-xs text-gray-500 uppercase">Totale</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {users.map(user => (
                <div key={user.id} className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-full border border-gray-200 hover:border-blue-400 transition-all">
                  <img src={user.photo} alt={user.name} className="w-8 h-8 rounded-full" />
                  <span className="text-sm font-semibold">{user.name}</span>
                  <button
                    onClick={() => handleRemoveUser(user.id)}
                    className="text-xs text-red-600 hover:text-red-800 ml-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-gray-500">Nessun partecipante registrato</p>
              )}
            </div>
            <button
              onClick={handleResetParticipants}
              className="mt-4 text-sm text-red-600 hover:text-red-700 font-semibold"
            >
              Reset tutti i partecipanti
            </button>
          </div>
          )}

          {/* Card Brani - Solo in modalità estesa */}
          {adminViewMode === 'extended' && (
          <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Music className="w-7 h-7 text-purple-600" />
                  Libreria Brani
                </h3>
                <p className="text-sm text-gray-600 mt-1">Gestisci la tua libreria musicale</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold text-purple-600">{songLibrary.length}</p>
                <p className="text-xs text-gray-500 uppercase">Brani totali</p>
              </div>
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleSongFileChange}
              />
              <input
                ref={choFilesInputRef}
                type="file"
                accept=".cho"
                multiple
                className="hidden"
                onChange={handleChoFilesChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 font-semibold"
              >
                <Upload className="w-5 h-5" />
                Importa CSV
              </button>
              <button
                onClick={() => choFilesInputRef.current?.click()}
                className="flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 font-semibold"
              >
                <Music className="w-5 h-5" />
                Importa ChordPro (.cho)
              </button>
              <button
                onClick={() => setShowAddSongForm(!showAddSongForm)}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-semibold"
              >
                <Music className="w-5 h-5" />
                {showAddSongForm ? 'Annulla' : 'Aggiungi Brano'}
              </button>
            </div>

            {importMessage && (
              <div className="flex items-center gap-2 text-green-800 bg-green-100 border border-green-200 p-3 rounded-lg mb-3">
                <CheckCircle className="w-5 h-5" />
                <span>{importMessage}</span>
              </div>
            )}

            {libraryErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3">
                <p className="font-bold mb-1">Errori di parsing:</p>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {libraryErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Form Aggiungi Brano */}
            {showAddSongForm && (
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 mb-4">
                <h4 className="font-bold text-purple-900 mb-3">Nuovo Brano</h4>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  handleAddSong(
                    formData.get('title'),
                    formData.get('artist'),
                    formData.get('year'),
                    formData.get('chord_sheet') || null
                  );
                  e.target.reset();
                }}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <input
                      name="title"
                      placeholder="Titolo"
                      required
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input
                      name="artist"
                      placeholder="Artista"
                      required
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input
                      name="year"
                      placeholder="Anno (opzionale)"
                      type="number"
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div className="mb-3">
                    <textarea
                      name="chord_sheet"
                      placeholder="Spartito ChordPro (opzionale) - Incolla qui il contenuto in formato ChordPro"
                      rows="6"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Formato ChordPro: usa [Am], [C], [G] per gli accordi e {'{'}title: Titolo{'}'}, {'{'}artist: Artista{'}'} per i metadati
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-semibold"
                  >
                    Aggiungi
                  </button>
                </form>
              </div>
            )}

            {/* Ricerca Brani */}
            {songLibrary.length > 0 && (
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Cerca per titolo o artista..."
                  value={songSearchQuery}
                  onChange={(e) => setSongSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            )}

            {/* Lista Brani */}
            {songLibrary.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <div className="space-y-2">
                  {songLibrary
                    .filter(song => {
                      if (!songSearchQuery) return true;
                      const query = songSearchQuery.toLowerCase();
                      return (
                        song.title.toLowerCase().includes(query) ||
                        song.artist.toLowerCase().includes(query)
                      );
                    })
                    .map(song => (
                      <div key={song.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        {editingSongId === song.id ? (
                          <form onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.target);
                            handleUpdateSong(
                              song.id,
                              formData.get('title'),
                              formData.get('artist'),
                              formData.get('year')
                            );
                          }}>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                              <input
                                name="title"
                                defaultValue={song.title}
                                required
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <input
                                name="artist"
                                defaultValue={song.artist}
                                required
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <input
                                name="year"
                                defaultValue={song.year || ''}
                                type="number"
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                              >
                                Salva
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSongId(null)}
                                className="text-xs bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600"
                              >
                                Annulla
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex-1 p-2">
                              <p className="font-bold text-gray-800 flex items-center gap-2">
                                {song.title}
                                {song.chord_sheet && <Music className="w-4 h-4 text-amber-500" />}
                              </p>
                              <p className="text-sm text-gray-600">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                            </div>
                            <div className="flex gap-2 items-center">
                              {song.chord_sheet && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    console.log('Opening song:', song.title, 'Has chord_sheet:', !!song.chord_sheet);
                                    setViewingSong(song);
                                  }}
                                  className="px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors"
                                >
                                  📄 Apri
                                </button>
                              )}
                              <button
                                onClick={() => setEditingSongId(song.id)}
                                className="text-sm text-blue-600 hover:text-blue-800"
                              >
                                Modifica
                              </button>
                              <button
                                onClick={() => handleDeleteSong(song.id)}
                                className="text-sm text-red-600 hover:text-red-800"
                              >
                                Elimina
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {songLibrary.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">Nessun brano in libreria. Importa un CSV o aggiungi manualmente.</p>
            )}
          </div>
          )}

          {/* Card Modalità di Gioco - Visibile in entrambe le modalità */}
          <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Disc className="w-7 h-7 text-indigo-600" />
              Modalità di Gioco
            </h3>
            <p className="text-sm text-gray-600 mb-6">Seleziona una modalità per avviare un round</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {gameCategories.map(cat => {
                const IconComponent = cat.icon;
                const isActive = currentRound?.type === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      if (cat.id === 'poll') {
                        // Per il sondaggio, scroll alla sezione dedicata
                        document.getElementById('poll-section')?.scrollIntoView({ behavior: 'smooth' });
                      } else if (cat.id === 'band_picks' && isActive) {
                        // Se Band Picks è già attivo, avanza al brano successivo
                        handleNextBandPick();
                      } else {
                        handleStartRound(cat.id);
                      }
                    }}
                    className={`p-6 bg-gradient-to-br ${cat.color} text-white rounded-xl hover:shadow-xl transition-all transform hover:scale-105 ${
                      isActive ? 'ring-4 ring-yellow-400' : ''
                    }`}
                  >
                    <IconComponent className="w-12 h-12 mx-auto mb-2" />
                    <p className="font-bold text-center">{cat.name}</p>
                    {isActive && <p className="text-xs mt-1 text-yellow-200">Attivo</p>}
                  </button>
                );
              })}
            </div>

            {currentRound && currentRound.type !== 'poll' && (
              <button
                onClick={handleEndRound}
                className="mt-6 w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 font-semibold"
              >
                Termina Round Corrente
              </button>
            )}
          </div>

          {/* Card Scelti dalla Band */}
          <div className="bg-gradient-to-br from-red-50 to-pink-50 border-2 border-red-200 rounded-2xl shadow-2xl p-6 mb-6">
            <h3 className="text-2xl font-bold text-red-900 mb-4 flex items-center gap-2">
              <Music className="w-7 h-7" />
              Scelti dalla Band
            </h3>
            <p className="text-sm text-gray-700 mb-4">
              Crea una scaletta personalizzata. I brani verranno mostrati uno alla volta nell'ordine scelto.
            </p>

            {/* Lista brani scelti */}
            {bandPicksList.length > 0 && (
              <div className="mb-4">
                <h4 className="font-semibold text-red-800 mb-2">Scaletta ({bandPicksList.length} brani)</h4>
                <div className="bg-white rounded-lg p-3 max-h-60 overflow-y-auto">
                  {bandPicksList.map((song, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 hover:bg-gray-50 rounded border-b last:border-b-0"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <span className="text-sm font-bold text-gray-500 w-6">{index + 1}.</span>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800">{song.title}</p>
                          <p className="text-xs text-gray-600">{song.artist}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const newList = [...bandPicksList];
                            if (index > 0) {
                              [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
                              setBandPicksList(newList);
                              localStorage.setItem('band_picks_list', JSON.stringify(newList));
                            }
                          }}
                          disabled={index === 0}
                          className="text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Sposta su"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => {
                            const newList = [...bandPicksList];
                            if (index < bandPicksList.length - 1) {
                              [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
                              setBandPicksList(newList);
                              localStorage.setItem('band_picks_list', JSON.stringify(newList));
                            }
                          }}
                          disabled={index === bandPicksList.length - 1}
                          className="text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Sposta giù"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => {
                            const newList = bandPicksList.filter((_, i) => i !== index);
                            setBandPicksList(newList);
                            localStorage.setItem('band_picks_list', JSON.stringify(newList));
                          }}
                          className="text-red-600 hover:text-red-800 text-sm"
                          title="Rimuovi"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Form aggiungi brano */}
            <div className="mb-4">
              <h4 className="font-semibold text-red-800 mb-2">Aggiungi brano alla scaletta</h4>
              <div className="bg-white rounded-lg p-3">
                <input
                  type="text"
                  placeholder="Cerca brano nella libreria..."
                  value={songSearch}
                  onChange={(e) => setSongSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 text-sm"
                />
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {songLibrary
                    .filter(s =>
                      s.title.toLowerCase().includes(songSearch.toLowerCase()) ||
                      s.artist.toLowerCase().includes(songSearch.toLowerCase())
                    )
                    .map(song => (
                      <button
                        key={song.id}
                        onClick={() => {
                          if (!bandPicksList.find(s => s.id === song.id)) {
                            const newList = [...bandPicksList, song];
                            setBandPicksList(newList);
                            localStorage.setItem('band_picks_list', JSON.stringify(newList));
                            setSongSearch('');
                          }
                        }}
                        className="w-full text-left p-2 hover:bg-red-50 rounded text-sm border border-gray-200"
                      >
                        <p className="font-semibold text-gray-800">{song.title}</p>
                        <p className="text-xs text-gray-600">{song.artist}</p>
                      </button>
                    ))}
                </div>
              </div>
            </div>

            {/* Pulsanti azione */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (bandPicksList.length === 0) {
                    alert('Aggiungi almeno un brano alla scaletta!');
                    return;
                  }
                  handleStartRound('band_picks');
                }}
                disabled={bandPicksList.length === 0}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Avvia Scaletta ({bandPicksList.length} brani)
              </button>
              <button
                onClick={() => {
                  if (confirm('Vuoi svuotare la scaletta?')) {
                    setBandPicksList([]);
                    setCurrentBandPickIndex(0);
                    localStorage.removeItem('band_picks_list');
                  }
                }}
                className="bg-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-400 font-semibold"
              >
                Svuota
              </button>
            </div>
          </div>

          {/* Card Sondaggio Brani - Sezione dedicata */}
          <div id="poll-section" className={`bg-gradient-to-br rounded-2xl shadow-2xl p-6 mb-6 border-2 ${
            currentRound?.isTiebreaker
              ? 'from-yellow-50 to-orange-50 border-yellow-300'
              : 'from-purple-50 to-pink-50 border-purple-200'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-purple-900 flex items-center gap-2">
                  <Music className="w-7 h-7" />
                  {currentRound?.isTiebreaker ? '⚖️ Spareggio' : 'Sondaggio Brani'}
                </h3>
                <p className="text-sm text-gray-700 mt-1">
                  {currentRound?.isTiebreaker
                    ? `Votazione di spareggio tra ${currentRound.songs?.length || 0} brani ex aequo`
                    : 'Prepara 10 brani casuali e gestisci la votazione'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase text-gray-500">Stato</p>
                <p className="text-lg font-bold text-purple-900">{pollPrepared ? (currentRound?.state || 'in attesa') : 'Nessun round'}</p>
              </div>
            </div>

            {songLibrary.length < 10 && (
              <div className="flex items-center gap-2 text-yellow-800 bg-yellow-100 border border-yellow-200 p-3 rounded-lg mb-4">
                <AlertTriangle className="w-5 h-5" />
                <span>Carica almeno 10 brani per preparare il sondaggio.</span>
              </div>
            )}

            {roundMessage && (
              <div className="flex items-center gap-2 text-blue-900 bg-blue-50 border border-blue-200 p-3 rounded-lg mb-4">
                <CheckCircle className="w-5 h-5 text-blue-700" />
                <span>{roundMessage}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <button
                onClick={handlePreparePoll}
                disabled={songLibrary.length < 10}
                className="p-4 bg-white text-purple-900 rounded-lg border-2 border-purple-200 hover:border-purple-400 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                Prepara round
              </button>
              <button
                onClick={handleOpenVoting}
                disabled={!pollPrepared || currentRound?.votingOpen}
                className="p-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                Apri votazione
              </button>
              <button
                onClick={handleCloseVoting}
                disabled={!currentRound || !currentRound.votingOpen}
                className="p-4 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                Chiudi votazione
              </button>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-700">
              <span className="font-semibold">Voti ricevuti: {votesReceived}</span>
              <button
                onClick={handleResetRound}
                className="flex items-center gap-2 text-purple-800 hover:text-purple-900 font-semibold"
              >
                <RefreshCcw className="w-4 h-4" />
                Reset round
              </button>
            </div>
          </div>

          {/* Card Anteprima Display */}
          {currentRound && (
            <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Eye className="w-6 h-6 text-gray-600" />
                  Anteprima Display
                </h3>
                <button
                  onClick={() => setView('display')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-semibold"
                >
                  Apri schermo intero
                </button>
              </div>
              {!currentRound.votingOpen && currentRound.songs && (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Round preparato, votazione non ancora aperta.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentRound.songs.map(song => (
                      <div key={song.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="font-bold">{song.title}</p>
                        <p className="text-sm text-gray-600">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {currentRound.votingOpen && currentRound.songs && (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Votazione in corso ({currentRound.votes?.length || 0}/{users.length} voti)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentRound.songs.map(song => {
                      const votes = (currentRound.votes || []).filter(v => v.songId === song.id).length;
                      return (
                        <div key={song.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <p className="font-bold">{song.title}</p>
                          <p className="text-sm text-gray-600">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-purple-500 h-full transition-all"
                                style={{ width: `${users.length > 0 ? (votes / users.length) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-gray-700">{votes}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Card Risultati */}
          {roundResults && (
            <div className="bg-gradient-to-br from-green-50 to-teal-50 rounded-2xl shadow-2xl p-6 mb-6 border-2 border-green-200">
              <h3 className="text-2xl font-bold text-green-800 mb-4">Risultati Ultimi Round</h3>
              {roundResults.winner && (
                <div className="mb-4">
                  <p className="text-sm uppercase text-gray-500">Vincitore</p>
                  <div
                    className={roundResults.winner.chord_sheet ? "cursor-pointer hover:bg-green-100 p-3 rounded-lg transition-colors" : ""}
                    onClick={() => roundResults.winner.chord_sheet && setViewingSong(roundResults.winner)}
                  >
                    <p className="text-3xl font-bold text-green-700 flex items-center gap-2">
                      {roundResults.winner.title}
                      {roundResults.winner.chord_sheet && <Music className="w-6 h-6 text-amber-500" />}
                    </p>
                    <p className="text-lg text-gray-600">{roundResults.winner.artist}</p>
                    {roundResults.winner.chord_sheet && (
                      <p className="text-xs text-amber-600 mt-1">👆 Clicca per vedere lo spartito</p>
                    )}
                  </div>
                </div>
              )}
              {roundResults.stats && <ResultList stats={roundResults.stats} compact />}
              <button
                onClick={() => setRoundResults(null)}
                className="mt-4 text-sm text-gray-600 hover:text-gray-800 font-semibold"
              >
                Nascondi risultati
              </button>
            </div>
          )}

          <button
            onClick={() => setView('home')}
            className="mt-4 text-white hover:text-gray-300 block mx-auto font-semibold"
          >
            ← Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  if (view === 'display') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-bold text-white text-center mb-12">🎤 Karaoke Night 🎤</h1>

          {!currentRound && !roundResults && (
            <div className="text-center text-white">
              <Music className="w-32 h-32 mx-auto mb-6 animate-pulse" />
              <p className="text-2xl">In attesa del prossimo round...</p>
              <p className="text-lg mt-4 opacity-75">Partecipanti: {users.length}</p>
            </div>
          )}

          {currentRound && (
          <div className="bg-white rounded-3xl p-8 shadow-2xl">
              <h2 className="text-3xl font-bold text-center mb-8">
                {currentRound.type === 'poll' && (currentRound.isTiebreaker ? '⚖️ Spareggio' : '🗳️ Sondaggio Brani')}
                {currentRound.type === 'duet' && '🎭 Duetto'}
                {currentRound.type === 'wheel' && '🎰 Ruota della Fortuna'}
                {currentRound.type === 'band_picks' && '🎸 Scelti dalla Band'}
                {currentRound.type === 'pass_mic' && '🎤 Passa il Microfono'}
              </h2>
              {currentRound.isTiebreaker && (
                <div className="mb-6 bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 text-center">
                  <p className="text-lg font-bold text-yellow-800">⚖️ Votazione di Spareggio</p>
                  <p className="text-sm text-yellow-700 mt-1">I brani erano ex aequo, vota per decretare il vincitore!</p>
                </div>
              )}

              <div className="flex items-center justify-between mb-6 text-sm text-gray-600">
                <span className="px-3 py-1 bg-gray-100 rounded-full border border-gray-200">
                  Stato: {currentRound.state || (currentRound.votingOpen ? 'voting' : 'prepared')}
                </span>
                {currentRound.songs && (
                  <span className="font-semibold text-gray-700">
                    Voti: {currentRound.votes?.length || 0}
                  </span>
                )}
              </div>

              {/* Poll - Solo se tipo poll E non è una ruota */}
              {currentRound.type === 'poll' && (
                <>
                  {!currentRound.votingOpen && currentRound.songs && (
                    <div>
                      <p className="text-center text-lg mb-6 text-gray-600">
                        Round preparato, in attesa di apertura della votazione.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        {currentRound.songs.map(song => (
                          <div key={song.id} className="p-4 bg-gray-50 rounded-lg border">
                            <p className="font-bold text-lg">{song.title}</p>
                            <p className="text-sm text-gray-600">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentRound.votingOpen && currentRound.songs && (
                    <div>
                      <p className="text-center text-lg mb-6 text-gray-600">
                        Votazione in corso... ({currentRound.votes?.length || 0}/{users.length} voti)
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        {currentRound.songs.map(song => {
                          const votes = (currentRound.votes || []).filter(v => v.songId === song.id).length;
                          return (
                            <div key={song.id} className="p-4 bg-gray-50 rounded-lg">
                              <p className="font-bold text-lg">{song.title}</p>
                              <p className="text-sm text-gray-600">{song.artist}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-3 overflow-hidden">
                                  <div
                                    className="bg-blue-600 h-full transition-all"
                                    style={{ width: `${users.length > 0 ? (votes / users.length) * 100 : 0}%` }}
                                  />
                                </div>
                                <span className="text-sm font-bold">{votes}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Ruota della Fortuna */}
              {currentRound.type === 'wheel' && (
                <div>
                  {currentRound.state === 'spinning' && currentRound.users && (
                    <WheelOfFortune
                      items={currentRound.users}
                      type="users"
                      autoSpin={true}
                      onComplete={handleWheelComplete}
                      preselectedWinnerIndex={currentRound.preselectedWinnerIndex}
                    />
                  )}
                  {currentRound.state === 'winner_selected' && currentRound.winner && currentRound.songs && (
                    <WinnerSongSelection
                      winner={currentRound.winner}
                      songs={currentRound.songs}
                      onSelectSong={handleSongSelected}
                      currentUser={currentUser}
                    />
                  )}
                  {currentRound.state === 'song_selected' && currentRound.winner && currentRound.selectedSong && (
                    <div className="text-center py-12">
                      <h2 className="text-4xl font-bold text-green-600 mb-8">🎉 È tutto pronto! 🎉</h2>
                      <div className="mb-8">
                        <img
                          src={currentRound.winner.photo}
                          alt={currentRound.winner.name}
                          className="w-40 h-40 rounded-full mx-auto border-8 border-yellow-400 mb-4"
                        />
                        <p className="text-3xl font-bold text-gray-800">{currentRound.winner.name}</p>
                      </div>
                      <div className="bg-gradient-to-r from-purple-100 to-pink-100 rounded-2xl p-8 max-w-2xl mx-auto border-4 border-purple-300">
                        <Music className="w-24 h-24 text-purple-600 mx-auto mb-4" />
                        <p className="text-4xl font-bold text-gray-800 mb-2">{currentRound.selectedSong.title}</p>
                        <p className="text-2xl text-gray-600">{currentRound.selectedSong.artist}</p>
                        {currentRound.selectedSong.year && (
                          <p className="text-xl text-gray-500 mt-2">Anno: {currentRound.selectedSong.year}</p>
                        )}
                      </div>
                      <p className="mt-8 text-2xl text-gray-700">Preparati a cantare! 🎤🎶</p>

                      {/* Pulsanti per terminare il round */}
                      {isAdminMode && (
                        <div className="mt-12 flex gap-4 justify-center">
                          <button
                            onClick={handleEndRound}
                            className="bg-red-600 text-white px-8 py-4 rounded-lg hover:bg-red-700 font-semibold text-lg"
                          >
                            Termina Round
                          </button>
                          <button
                            onClick={() => setView('admin')}
                            className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 font-semibold text-lg"
                          >
                            Pannello Organizzatore
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Duetti */}
              {currentRound.type === 'duet' && currentRound.state === 'ready' && (
                <div className="text-center py-12">
                  <h2 className="text-5xl font-bold text-pink-600 mb-12">💕 Duetto! 💕</h2>

                  {/* Due utenti affiancati */}
                  <div className="flex justify-center items-center gap-16 mb-12">
                    {/* Primo utente */}
                    <div className="text-center">
                      <img
                        src={currentRound.user1.photo}
                        alt={currentRound.user1.name}
                        className="w-48 h-48 rounded-full mx-auto border-8 border-pink-400 mb-4 shadow-2xl"
                      />
                      <p className="text-3xl font-bold text-gray-800">{currentRound.user1.name}</p>
                    </div>

                    {/* Simbolo cuore */}
                    <div className="text-8xl text-pink-500">
                      ❤️
                    </div>

                    {/* Secondo utente */}
                    <div className="text-center">
                      <img
                        src={currentRound.user2.photo}
                        alt={currentRound.user2.name}
                        className="w-48 h-48 rounded-full mx-auto border-8 border-pink-400 mb-4 shadow-2xl"
                      />
                      <p className="text-3xl font-bold text-gray-800">{currentRound.user2.name}</p>
                    </div>
                  </div>

                  {/* Canzone selezionata */}
                  <div className="bg-gradient-to-r from-pink-100 via-purple-100 to-pink-100 rounded-3xl p-10 max-w-3xl mx-auto border-4 border-pink-300 shadow-2xl">
                    <p className="text-2xl text-gray-600 mb-4">🎵 Canterete insieme 🎵</p>
                    <Music className="w-28 h-28 text-pink-600 mx-auto mb-6" />
                    <p className="text-5xl font-bold text-gray-800 mb-4">{currentRound.song.title}</p>
                    <p className="text-3xl text-gray-600">{currentRound.song.artist}</p>
                    {currentRound.song.year && (
                      <p className="text-2xl text-gray-500 mt-4">Anno: {currentRound.song.year}</p>
                    )}
                  </div>

                  <p className="mt-12 text-3xl text-gray-700 font-semibold">
                    Entrambi avete votato per questa canzone! Preparatevi a duettare! 🎤✨
                  </p>

                  {/* Pulsanti per terminare il round */}
                  {isAdminMode && (
                    <div className="mt-12 flex gap-4 justify-center">
                      <button
                        onClick={handleEndRound}
                        className="bg-red-600 text-white px-8 py-4 rounded-lg hover:bg-red-700 font-semibold text-lg"
                      >
                        Termina Round
                      </button>
                      <button
                        onClick={() => setView('admin')}
                        className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 font-semibold text-lg"
                      >
                        Pannello Organizzatore
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Scelti dalla Band */}
              {currentRound.type === 'band_picks' && currentRound.songs && (
                <div className="text-center py-12">
                  <h2 className="text-5xl font-bold text-red-600 mb-8">🎸 Scelti dalla Band 🎸</h2>

                  {/* Brano corrente */}
                  <div className="mb-8">
                    <div className="bg-gradient-to-r from-red-100 via-pink-100 to-red-100 rounded-3xl p-12 max-w-3xl mx-auto border-4 border-red-300 shadow-2xl">
                      <Music className="w-32 h-32 text-red-600 mx-auto mb-6" />
                      <p className="text-6xl font-bold text-gray-800 mb-4">
                        {currentRound.songs[currentRound.currentIndex || 0].title}
                      </p>
                      <p className="text-4xl text-gray-600">
                        {currentRound.songs[currentRound.currentIndex || 0].artist}
                      </p>
                      {currentRound.songs[currentRound.currentIndex || 0].year && (
                        <p className="text-2xl text-gray-500 mt-4">
                          Anno: {currentRound.songs[currentRound.currentIndex || 0].year}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Barra progresso */}
                  <div className="mb-8 max-w-2xl mx-auto">
                    <div className="bg-gray-200 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-red-600 h-full transition-all duration-500"
                        style={{
                          width: `${((currentRound.currentIndex || 0) + 1) / currentRound.songs.length * 100}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Pulsanti navigazione (solo admin) */}
                  {isAdminMode && (
                    <div className="mt-12 flex gap-4 justify-center">
                      <button
                        onClick={handlePrevBandPick}
                        disabled={(currentRound.currentIndex || 0) === 0}
                        className="bg-gray-600 text-white px-8 py-4 rounded-lg hover:bg-gray-700 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ← Precedente
                      </button>
                      <button
                        onClick={handleNextBandPick}
                        className="bg-red-600 text-white px-8 py-4 rounded-lg hover:bg-red-700 font-semibold text-lg"
                      >
                        {(currentRound.currentIndex || 0) + 1 < currentRound.songs.length
                          ? 'Successivo →'
                          : 'Termina Scaletta ✓'}
                      </button>
                      <button
                        onClick={() => setView('admin')}
                        className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 font-semibold text-lg"
                      >
                        Pannello Organizzatore
                      </button>
                    </div>
                  )}
                </div>
              )}

              {currentRound.type === 'pass_mic' && currentRound.selectedUser && (
                <div className="text-center py-12">
                  <h2 className="text-5xl font-bold text-pink-600 mb-12">🎤 Passa il Microfono! 🎤</h2>

                  {/* Utente selezionato */}
                  <div className="mb-8">
                    <p className="text-2xl text-gray-600 mb-6">È il turno di...</p>
                    <img
                      src={currentRound.selectedUser.photo}
                      alt={currentRound.selectedUser.name}
                      className="w-56 h-56 rounded-full mx-auto border-8 border-pink-400 mb-6 shadow-2xl"
                    />
                    <p className="text-6xl font-bold text-gray-800 mb-4">{currentRound.selectedUser.name}</p>
                  </div>

                  <div className="bg-gradient-to-r from-pink-100 via-purple-100 to-pink-100 rounded-3xl p-10 max-w-3xl mx-auto border-4 border-pink-300 shadow-2xl">
                    <Mic className="w-28 h-28 text-pink-600 mx-auto mb-6" />
                    <p className="text-3xl text-gray-700 font-semibold">
                      Scegli il brano che preferisci e preparati a cantare!
                    </p>
                  </div>

                  {/* Pulsanti admin */}
                  {isAdminMode && (
                    <div className="mt-12 flex gap-4 justify-center">
                      <button
                        onClick={handleStartPassMic}
                        className="bg-pink-600 text-white px-8 py-4 rounded-lg hover:bg-pink-700 font-semibold text-lg"
                      >
                        Seleziona Nuovo Partecipante
                      </button>
                      <button
                        onClick={handleEndRound}
                        className="bg-red-600 text-white px-8 py-4 rounded-lg hover:bg-red-700 font-semibold text-lg"
                      >
                        Termina Round
                      </button>
                      <button
                        onClick={() => setView('admin')}
                        className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 font-semibold text-lg"
                      >
                        Pannello Organizzatore
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {roundResults && (
            <div className="bg-white rounded-3xl p-8 shadow-2xl text-center">
              <h2 className="text-4xl font-bold mb-8 text-yellow-600">🏆 Risultati 🏆</h2>
              
              {roundResults.winner && (
                <div className="mb-8">
                  <Music className="w-32 h-32 mx-auto mb-4 text-yellow-500" />
                  <div
                    className={roundResults.winner.chord_sheet ? "cursor-pointer hover:bg-yellow-50 p-4 rounded-xl transition-colors" : ""}
                    onClick={() => roundResults.winner.chord_sheet && setViewingSong(roundResults.winner)}
                  >
                    <p className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
                      {roundResults.winner.title}
                      {roundResults.winner.chord_sheet && <Music className="w-8 h-8 text-amber-500" />}
                    </p>
                    <p className="text-xl text-gray-600">{roundResults.winner.artist}</p>
                    {roundResults.winner.chord_sheet && (
                      <p className="text-sm text-amber-600 mt-2">👆 Clicca per vedere lo spartito</p>
                    )}
                  </div>

                  {/* Pulsanti azioni */}
                  <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => {
                        const text = roundResults.winner.title;
                        navigator.clipboard.writeText(text);
                        alert('📋 Titolo copiato negli appunti!\n\n' + text);
                      }}
                      className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-semibold"
                    >
                      📋 Copia Titolo
                    </button>
                    {roundResults.winner.chord_sheet && (
                      <button
                        onClick={() => setViewingSong(roundResults.winner)}
                        className="flex items-center gap-2 bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 font-semibold"
                      >
                        📄 Apri Testo
                      </button>
                    )}
                  </div>
                </div>
              )}

              {roundResults.stats && (
                <ResultList stats={roundResults.stats} />
              )}

              <button
                onClick={() => setRoundResults(null)}
                className="mt-8 bg-purple-600 text-white px-8 py-3 rounded-lg hover:bg-purple-700"
              >
                Continua
              </button>
            </div>
          )}

          <button
            onClick={() => setView('home')}
            className="mt-8 text-white hover:text-gray-300 block mx-auto"
          >
            ← Torna alla Home
          </button>
        </div>

        {/* ChordSheetViewer Modal */}
        {viewingSong && (
          <ChordSheetViewer
            song={viewingSong}
            onClose={() => setViewingSong(null)}
            onUpdateSong={async (updatedSong) => {
              if (backendMode === 'supabase' && supabase) {
                const { error } = await supabase
                  .from('k_songs')
                  .update({ chord_sheet: updatedSong.chord_sheet })
                  .eq('id', updatedSong.id);

                if (error) {
                  console.error('Errore aggiornamento spartito:', error);
                  return;
                }
              }

              const updatedLibrary = songLibrary.map(s =>
                s.id === updatedSong.id ? { ...s, chord_sheet: updatedSong.chord_sheet } : s
              );
              setSongLibrary(updatedLibrary);
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLibrary));
              }
              setViewingSong(updatedSong);
            }}
          />
        )}
      </div>
    );
  }

  setView('home');
  return null;
}
