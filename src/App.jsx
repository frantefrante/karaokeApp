import React, { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Camera, Music, Users, Play, Trophy, Disc, Mic, Upload, AlertTriangle, CheckCircle, RefreshCcw, Eye, Maximize2 } from 'lucide-react';
import ChordSheetViewer from './ChordSheetViewer';
import ProjectionView from './ProjectionView';
import SongImporter from './SongImporter';

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
  const wheelRef = useRef(null);

  useEffect(() => {
    if (autoSpin && !spinning && !winner) {
      spinWheel();
    }
  }, [autoSpin]);

  // Scroll automatico verso la ruota quando inizia a girare
  useEffect(() => {
    if (spinning && wheelRef.current) {
      wheelRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [spinning]);

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
        // Chiama onComplete dopo 5 secondi per dare tempo di vedere il vincitore
        setTimeout(() => {
          if (onComplete) onComplete(selectedWinner);
        }, 5000);
      }, 500);
    }, spinDuration + 3000);
  };

  const arcadeColors = ['#FF0055', '#00FF9F', '#FFE900', '#00D4FF', '#FF6B00', '#C800FF', '#00FF66', '#FF3399'];

  return (
    <div className="relative flex flex-col items-center gap-6">
      <style>{`
        @keyframes ledBlink {
          0% { opacity: 0.4; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>

      {/* Confetti Animation quando c'è un vincitore */}
      {showCelebration && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-10%`,
                animation: `confettiFall ${2 + Math.random() * 3}s linear infinite`,
                animationDelay: `${Math.random() * 2}s`,
                fontSize: '2rem',
                opacity: 0.8
              }}
            >
              {['🎉', '🎊', '⭐', '✨', '🎈', '🏆', '🎤'][Math.floor(Math.random() * 7)]}
            </div>
          ))}
        </div>
      )}

      {!winner ? (
        <>
          <div ref={wheelRef} className="relative w-[600px] h-[600px]">
            {/* Luci LED esterne - 32 cerchietti animati */}
            {[...Array(32)].map((_, i) => {
              const angle = (360 / 32) * i;
              const radius = 280;
              const x = Math.cos((angle - 90) * Math.PI / 180) * radius;
              const y = Math.sin((angle - 90) * Math.PI / 180) * radius;
              const color = arcadeColors[i % arcadeColors.length];

              return (
                <div
                  key={i}
                  className="absolute w-4 h-4 rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                    backgroundColor: color,
                    boxShadow: `0 0 12px ${color}, 0 0 24px ${color}`,
                    animation: `ledBlink 0.8s ease-in-out ${i * 0.025}s infinite alternate`
                  }}
                />
              );
            })}

            {/* Cornice dorata esterna */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 25%, #FFD700 50%, #FF8C00 75%, #FFD700 100%)',
                padding: '15px',
                boxShadow: '0 0 40px rgba(255,215,0,0.6), inset 0 0 30px rgba(0,0,0,0.4), 0 10px 40px rgba(0,0,0,0.5)'
              }}
            >
              {/* Bordo decorativo interno */}
              <div className="w-full h-full rounded-full border-4 border-yellow-600/50" style={{ padding: '8px' }}>
                {/* Ruota principale con SVG per segmenti colorati */}
                <div className="relative w-full h-full rounded-full overflow-hidden">
                  <svg className="absolute inset-0 w-full h-full" style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 10s cubic-bezier(0.05, 0.7, 0.1, 0.99)' : 'none' }}>
                    {/* Segmenti colorati */}
                    {items.map((item, i) => {
                      const anglePerSegment = 360 / items.length;
                      const startAngle = anglePerSegment * i - 90;
                      const endAngle = startAngle + anglePerSegment;

                      const startRad = startAngle * Math.PI / 180;
                      const endRad = endAngle * Math.PI / 180;

                      const x1 = 50 + 50 * Math.cos(startRad);
                      const y1 = 50 + 50 * Math.sin(startRad);
                      const x2 = 50 + 50 * Math.cos(endRad);
                      const y2 = 50 + 50 * Math.sin(endRad);

                      const largeArc = anglePerSegment > 180 ? 1 : 0;
                      const pathData = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArc} 1 ${x2} ${y2} Z`;

                      return (
                        <g key={i}>
                          <path
                            d={pathData}
                            fill={arcadeColors[i % arcadeColors.length]}
                            stroke="#FFD700"
                            strokeWidth="3"
                          />
                          {/* Effetto metallico */}
                          <path
                            d={pathData}
                            fill="url(#metalGradient)"
                            opacity="0.3"
                          />
                        </g>
                      );
                    })}

                    {/* Gradiente per effetto metallico */}
                    <defs>
                      <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style={{ stopColor: 'white', stopOpacity: 0.8 }} />
                        <stop offset="50%" style={{ stopColor: 'white', stopOpacity: 0 }} />
                        <stop offset="100%" style={{ stopColor: 'black', stopOpacity: 0.3 }} />
                      </linearGradient>
                    </defs>
                  </svg>

                  {/* Items sulla ruota */}
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: `rotate(${rotation}deg)`,
                      transition: spinning ? 'transform 10s cubic-bezier(0.05, 0.7, 0.1, 0.99)' : 'none'
                    }}
                  >
                    {items.map((item, i) => {
                      const angle = (360 / items.length) * i;
                      const color = arcadeColors[i % arcadeColors.length];

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
                              <div
                                className="w-14 h-14 rounded-lg mx-auto mb-2 overflow-hidden border-3"
                                style={{
                                  borderColor: '#FFD700',
                                  borderWidth: '3px',
                                  boxShadow: `0 0 15px ${color}, 0 4px 8px rgba(0,0,0,0.5)`
                                }}
                              >
                                <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                              </div>
                              <div
                                className="text-xs font-bold uppercase px-2 py-0.5 rounded inline-block"
                                style={{
                                  backgroundColor: color,
                                  color: '#000',
                                  letterSpacing: '0.05em',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                  textShadow: '0 0 5px rgba(255,255,255,0.5)'
                                }}
                              >
                                {item.name}
                              </div>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Music className="w-14 h-14 mx-auto mb-2" style={{ color: '#FFD700', filter: 'drop-shadow(0 0 10px rgba(255,215,0,0.8))' }} />
                              <div
                                className="text-xs font-bold uppercase px-2 py-0.5 rounded inline-block"
                                style={{
                                  backgroundColor: color,
                                  color: '#000',
                                  letterSpacing: '0.05em',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                  textShadow: '0 0 5px rgba(255,255,255,0.5)'
                                }}
                              >
                                {item.title}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Centro della ruota */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <defs>
                        <radialGradient id="centerGradient">
                          <stop offset="0%" style={{ stopColor: '#FF0055' }} />
                          <stop offset="70%" style={{ stopColor: '#AA0033' }} />
                          <stop offset="100%" style={{ stopColor: '#660022' }} />
                        </radialGradient>
                      </defs>
                      <circle cx="60" cy="60" r="60" fill="#1a1a1a" stroke="#FFD700" strokeWidth="5" />
                      <circle cx="60" cy="60" r="50" fill="url(#centerGradient)" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ fontFamily: 'Impact, sans-serif', color: '#FFD700', fontWeight: 'bold' }}>
                      <div style={{ fontSize: '16px', lineHeight: '1' }}>KARAOKE</div>
                      <div style={{ fontSize: '14px', lineHeight: '1' }}>NIGHT</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Freccia indicatore - Doppio triangolo oro/rosso */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-6 z-30" style={{ filter: 'drop-shadow(0 0 15px rgba(255,215,0,0.8))' }}>
              <div className="relative">
                {/* Triangolo esterno ORO */}
                <div className="w-0 h-0" style={{
                  borderLeft: '30px solid transparent',
                  borderRight: '30px solid transparent',
                  borderTop: '60px solid #FFD700'
                }}></div>
                {/* Triangolo interno ROSSO */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0" style={{
                  borderLeft: '18px solid transparent',
                  borderRight: '18px solid transparent',
                  borderTop: '38px solid #FF0055'
                }}></div>
                {/* Puntino bianco */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white"></div>
              </div>
            </div>
          </div>

          {!autoSpin && (
            <button
              onClick={spinWheel}
              disabled={spinning}
              className="font-black uppercase px-16 py-6 rounded-full transform transition-all hover:scale-110"
              style={{
                background: spinning ? '#374151' : 'linear-gradient(to bottom, #FFD700, #FFA500, #FF8C00)',
                color: spinning ? '#6B7280' : '#1a1a1a',
                letterSpacing: '0.1em',
                boxShadow: spinning ? 'none' : '0 0 30px rgba(255,215,0,0.6), 0 10px 30px rgba(0,0,0,0.4), inset 0 2px 0 rgba(255,255,255,0.4)',
                fontSize: '1.25rem'
              }}
            >
              {spinning ? 'GIRANDO...' : '🎰 GIRA LA RUOTA!'}
            </button>
          )}

          {spinning && (
            <p className="text-xl font-semibold animate-pulse" style={{ color: '#FFD700', textShadow: '0 0 10px rgba(255,215,0,0.8), 0 2px 4px rgba(0,0,0,0.8)' }}>
              Chi sarà il fortunato? 🤔
            </p>
          )}
        </>
      ) : (
        <div className="text-center">
          <div className="animate-bounce mb-6">
            <h2
              className="text-6xl font-bold mb-4"
              style={{
                background: 'linear-gradient(to right, #FFD700, #FF6B00, #FF0055, #FF6B00, #FFD700)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              🎉 VINCITORE! 🎉
            </h2>
          </div>
          {type === 'users' ? (
            <div className="transform scale-110 transition-all relative">
              {/* Glow radiale dietro avatar */}
              <div
                className="absolute inset-0 mx-auto w-48 h-48 rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgba(255,215,0,0.6) 0%, transparent 70%)',
                  filter: 'blur(20px)',
                  transform: 'translateY(25%)'
                }}
              ></div>
              <img
                src={winner.photo}
                alt={winner.name}
                className="w-48 h-48 rounded-full mx-auto mb-4 relative z-10"
                style={{
                  border: '8px solid #FFD700',
                  boxShadow: '0 0 50px rgba(255,215,0,0.8), 0 20px 40px rgba(0,0,0,0.5)'
                }}
              />
              <p className="text-5xl font-bold text-gray-800 mb-2">{winner.name}</p>
              <p className="text-2xl text-gray-600">È il tuo turno di cantare! 🎤</p>
            </div>
          ) : (
            <div className="relative">
              <div
                className="absolute inset-0 mx-auto w-32 h-32"
                style={{
                  background: 'radial-gradient(circle, rgba(255,215,0,0.6) 0%, transparent 70%)',
                  filter: 'blur(20px)',
                  transform: 'translateY(25%)'
                }}
              ></div>
              <Music className="w-32 h-32 mx-auto mb-4 relative z-10" style={{ color: '#FFD700', filter: 'drop-shadow(0 0 30px rgba(255,215,0,0.8))' }} />
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
  const [showSongImporter, setShowSongImporter] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [roundMessage, setRoundMessage] = useState('');
  const [votesReceived, setVotesReceived] = useState(0);
  const fileInputRef = useRef(null);
  const choFilesInputRef = useRef(null);
  const votesChannelRef = useRef(null);
  const registeredOnceRef = useRef(false);
  const lastRoundRef = useRef(null); // Tiene traccia dell'ultimo round (anche se terminato) per sincronizzare lo spartito
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

  // Aggiorna bandPicksList quando cambia songLibrary per sincronizzare gli ID
  useEffect(() => {
    if (songLibrary.length === 0 || bandPicksList.length === 0) return;

    const updatedBandPicks = bandPicksList.map(oldSong => {
      // Trova il brano corrispondente per titolo e artista
      const newSong = songLibrary.find(s =>
        s.title.toLowerCase() === oldSong.title.toLowerCase() &&
        s.artist.toLowerCase() === oldSong.artist.toLowerCase()
      );
      return newSong || oldSong; // Se non trovato, mantieni il vecchio
    }).filter(song => songLibrary.find(s => s.id === song.id)); // Rimuovi brani che non esistono più

    // Aggiorna solo se ci sono differenze negli ID
    const hasChanges = updatedBandPicks.some((song, idx) => song.id !== bandPicksList[idx]?.id);
    if (hasChanges && updatedBandPicks.length > 0) {
      setBandPicksList(updatedBandPicks);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('band_picks_list', JSON.stringify(updatedBandPicks));
      }
    }
  }, [songLibrary]);

  // Aggiorna currentRound quando cambia songLibrary per sincronizzare gli ID
  useEffect(() => {
    if (!currentRound || songLibrary.length === 0) return;
    if (!currentRound.songs || currentRound.songs.length === 0) return;

    const updatedSongs = currentRound.songs.map(oldSong => {
      // Trova il brano corrispondente per titolo e artista
      const newSong = songLibrary.find(s =>
        s.title.toLowerCase() === oldSong.title.toLowerCase() &&
        s.artist.toLowerCase() === oldSong.artist.toLowerCase()
      );
      return newSong || oldSong; // Se non trovato, mantieni il vecchio
    }).filter(song => songLibrary.find(s => s.id === song.id)); // Rimuovi brani che non esistono più

    // Aggiorna solo se ci sono differenze negli ID
    const hasChanges = updatedSongs.some((song, idx) => song.id !== currentRound.songs[idx]?.id);
    if (hasChanges && updatedSongs.length > 0) {
      setCurrentRound({
        ...currentRound,
        songs: updatedSongs
      });
    }
  }, [songLibrary, currentRound]);

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
  const [songViewContext, setSongViewContext] = useState(null); // 'admin', 'home', etc. - per sapere dove tornare quando si chiude lo spartito
  const [compactSection, setCompactSection] = useState(null); // 'users', 'songs', 'round'
  const [selectedGameMode, setSelectedGameMode] = useState(null); // 'poll', 'duet', 'wheel', 'band_picks', 'pass_mic'
  // NUOVO: Stato per spartito attivo sincronizzato tra dispositivi
  const [activeSheetSongId, setActiveSheetSongId] = useState(null);
  const sanitizePayloadForSync = (payload) => {
    if (!payload) return payload;
    const clone = { ...payload };
    if (Array.isArray(clone.songs)) {
      clone.songs = clone.songs.map(({ chord_sheet, ...rest }) => rest);
    }
    if (clone.selectedSong) {
      const { chord_sheet, ...rest } = clone.selectedSong;
      clone.selectedSong = rest;
    }
    if (clone.song) {
      const { chord_sheet, ...rest } = clone.song;
      clone.song = rest;
    }
    return clone;
  };

  // Pulisci compactSection quando viene selezionata una modalità di gioco
  useEffect(() => {
    if (selectedGameMode) {
      setCompactSection(null);
    }
  }, [selectedGameMode]);

  // Leggi il parametro 'view' dall'URL all'avvio
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      if (viewParam && ['home', 'admin', 'display', 'projection'].includes(viewParam)) {
        setView(viewParam);
      }
    }
  }, []);

  // Funzione per impostare lo spartito attivo (sincronizza con tutti i dispositivi)
  const setActiveSheet = async (songId) => {
    console.log('📖 Impostazione spartito attivo:', songId);
    setActiveSheetSongId(songId);

    const targetRoundId = currentRound?.id || lastRoundRef.current?.id;
    const basePayload = currentRound || lastRoundRef.current?.payload;

    if (backendMode === 'supabase' && supabase && targetRoundId) {
      const sanitized = sanitizePayloadForSync(basePayload);
      const updatedPayload = {
        ...(sanitized || {}),
        activeSheetSongId: songId
      };

      const { error } = await supabase
        .from('k_rounds')
        .update({ payload: updatedPayload })
        .eq('id', targetRoundId);

      if (error) {
        console.error('❌ Errore impostazione spartito attivo:', error);
      } else {
        lastRoundRef.current = { id: targetRoundId, payload: updatedPayload };
        console.log('✅ Spartito attivo sincronizzato con Supabase');
      }
    }
  };

  const clearActiveSheet = async () => {
    console.log('🔒 Chiusura spartito attivo');
    setActiveSheetSongId(null);

    const targetRoundId = currentRound?.id || lastRoundRef.current?.id;
    const basePayload = currentRound || lastRoundRef.current?.payload;

    if (backendMode === 'supabase' && supabase && targetRoundId) {
      const sanitized = sanitizePayloadForSync(basePayload);
      const updatedPayload = {
        ...(sanitized || {}),
        activeSheetSongId: null
      };

      await supabase
        .from('k_rounds')
        .update({ payload: updatedPayload })
        .eq('id', targetRoundId);
      lastRoundRef.current = { id: targetRoundId, payload: updatedPayload };
    }
  };

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
      if (error) {
        console.error('Errore closeVoting', error);
      } else {
        lastRoundRef.current = { id: currentRound.id, payload };
      }
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

  // Keep-alive: aggiorna periodicamente dallo stato su Supabase per non perdere la sincronizzazione spartito
  useEffect(() => {
    if (backendMode !== 'supabase' || !supabase) return;

    const interval = setInterval(async () => {
      const targetId = currentRound?.id || lastRoundRef.current?.id;
      if (!targetId) return;

      const { data, error } = await supabase
        .from('k_rounds')
        .select('id, payload, state, category')
        .eq('id', targetId)
        .maybeSingle();

      if (error || !data?.payload) return;

      const payloadObj = data.payload;
      lastRoundRef.current = { id: data.id, payload: payloadObj };

      if (payloadObj.activeSheetSongId !== undefined) {
        setActiveSheetSongId(payloadObj.activeSheetSongId);
      }

      if (currentRound && currentRound.id === data.id) {
        setCurrentRound(prev => prev ? {
          ...prev,
          ...payloadObj,
          id: data.id,
          state: data.state,
          category: data.category,
          type: payloadObj.type || data.category || prev.type
        } : prev);
      }
    }, 60000); // ogni 60 secondi

    return () => clearInterval(interval);
  }, [backendMode, supabase, currentRound?.id]);

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

        // Aggiorna bandPicksList con i nuovi ID dalla libreria
        const savedBandPicks = typeof localStorage !== 'undefined' ? localStorage.getItem('band_picks_list') : null;
        if (savedBandPicks) {
          try {
            const oldBandPicks = JSON.parse(savedBandPicks);
            const updatedBandPicks = oldBandPicks.map(oldSong => {
              // Trova il brano corrispondente per titolo e artista
              const newSong = songsData.find(s =>
                s.title.toLowerCase() === oldSong.title.toLowerCase() &&
                s.artist.toLowerCase() === oldSong.artist.toLowerCase()
              );
              return newSong || oldSong; // Se non trovato, mantieni il vecchio (sarà rimosso dopo)
            }).filter(song => songsData.find(s => s.id === song.id)); // Rimuovi brani che non esistono più

            setBandPicksList(updatedBandPicks);
            localStorage.setItem('band_picks_list', JSON.stringify(updatedBandPicks));
          } catch (e) {
            console.error('Errore aggiornamento band picks:', e);
          }
        }

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
        lastRoundRef.current = { id: r.id, payload };
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

        // Se il round è stato eliminato (DELETE), resetta semplicemente lo stato locale
        if (payload.eventType === 'DELETE') {
          console.log('🗑️ Round eliminato dal database, reset locale');
          setCurrentRound(null);
          setRoundResults(null);
          setVotesReceived(0);
          return;
        }

        const r = payload.new;
        const payloadObj = r?.payload || {};
        const songs = payloadObj.songs || [];
        lastRoundRef.current = { id: r.id, payload: payloadObj };
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

        // NUOVO: Sincronizza lo spartito attivo
        if (payloadObj.activeSheetSongId !== undefined) {
          setActiveSheetSongId(payloadObj.activeSheetSongId);
          console.log('📖 Spartito attivo sincronizzato:', payloadObj.activeSheetSongId);
        }

        if (roundObj?.state === 'ended' && payloadObj.results) {
          console.log('🏁 Round terminato. View corrente:', view, 'isAdminMode:', isAdminMode);
          setRoundResults(payloadObj.results);
          setCurrentRound(null);
          // Non cambiare view se sei in modalità admin, mostra i risultati nella dashboard
          // Solo i partecipanti vengono reindirizzati a display
          if (!isAdminMode) {
            console.log('➡️ Redirect a display (non sei admin)');
            setView('display');
          } else {
            console.log('✅ Rimango in admin, mostro risultati nella dashboard');
            // Se eri in home ma sei admin, torna ad admin
            if (view !== 'admin') {
              setView('admin');
            }
          }
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

    // Non fare redirect se sei in projection view (è una view standalone)
    if (view === 'projection') return;

    if (!isParticipant) return; // Non fare nulla se non sei un partecipante

    // Se non c'è un round attivo
    if (!currentRound) {
      // Se ci sono risultati da mostrare, permetti di restare in display
      if (roundResults && view === 'display') {
        console.log('📊 Mostrando risultati, resto in display');
        return;
      }
      // Altrimenti, permetti di restare in home, join, participantHome, waiting, projection
      if (view !== 'waiting' && view !== 'join' && view !== 'participantHome' && view !== 'home' && view !== 'display' && view !== 'projection') {
        console.log('🔄 Auto-redirect a waiting (nessun round)');
        setView('waiting');
      }
      return;
    }

    // Gestisci i redirect in base al tipo di round
    // IMPORTANTE: Non redirigere mai se l'utente è in 'home', 'join', 'participantHome' o 'projection' (permetti sempre navigazione manuale)
    if (view === 'home' || view === 'join' || view === 'participantHome' || view === 'projection') {
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
      // CORREZIONE: Forza redirect a voting ANCHE da display quando votingOpen è true
      if (currentRound.votingOpen) {
        if (view !== 'voting') {
          console.log('🔄 Auto-redirect a voting (poll aperto) - anche da display!');
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
        setActiveSheetSongId(null); // NUOVO: Pulisci spartito attivo
        setRoundMessage('Votazione chiusa, risultati pronti.');
        // Non cambiare view, mostra i risultati nella dashboard
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
    setActiveSheetSongId(null); // NUOVO: Pulisci spartito attivo
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
      // Rimuovi chord_sheet dai brani per ridurre la dimensione del payload
      const songsLightweight = selectedSongs.map(({ id, title, artist, year }) => ({ id, title, artist, year }));

      const payload = {
        type: 'wheel',
        state: 'spinning',
        users: users,
        songs: songsLightweight,
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
      // Rimuovi chord_sheet per ridurre la dimensione del payload
      const { chord_sheet, ...songWithoutChordSheet } = song;

      const payload = {
        ...currentRound,
        state: 'song_selected',
        selectedSong: songWithoutChordSheet
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
      setSelectedGameMode('duet');
      setView('admin');
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
      setSelectedGameMode('duet');
      setView('admin');
    }
  };

  const handleStartBandPicks = async () => {
    if (bandPicksList.length === 0) {
      setRoundMessage('❌ Aggiungi almeno un brano alla scaletta!');
      return;
    }

    setCurrentBandPickIndex(0);
    const songsLightweight = bandPicksList.map(({ id, title, artist, year }) => ({
      id,
      title,
      artist,
      year: year || null
    }));

    const payload = {
      type: 'band_picks',
      songs: songsLightweight,
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
      lastRoundRef.current = { id: data.id, payload };
    } else {
      const localId = Date.now();
      setCurrentRound({ ...payload, id: localId });
      lastRoundRef.current = { id: localId, payload };
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

  const handleEndRound = async () => {
    if (!currentRound) {
      console.log('⚠️ Nessun round da terminare');
      return;
    }

    console.log('🛑 Terminazione round:', currentRound.type, 'ID:', currentRound.id);

    if (currentRound.type === 'poll') {
      handleCloseVoting();
      return;
    }

    // Per tutti gli altri tipi di round (wheel, duet, band_picks)
    if (backendMode === 'supabase' && supabase) {
      console.log('🗑️ Eliminazione round da Supabase...');
      const { error } = await supabase
        .from('k_rounds')
        .delete()
        .eq('id', currentRound.id);

      if (error) {
        console.error('❌ Errore terminazione round:', error);
        setRoundMessage('Errore durante la terminazione del round');
        return;
      }
      console.log('✅ Round eliminato da Supabase');
    }

    // Reset locale
    console.log('🔄 Reset stato locale...');
    setCurrentRound(null);
    setSelectedGameMode(null); // Torna alla dashboard principale
    setRoundMessage('Round terminato con successo!');
    setTimeout(() => setRoundMessage(''), 3000);
    console.log('✅ Terminazione completata');
  };

  // ============================================================================
  // VIEW PROJECTION - Proiezione spartiti con controlli avanzati
  // ============================================================================
  if (view === 'projection') {
    const params = new URLSearchParams(window.location.search);
    const songIdParam = params.get('songId');

    // Convert songId to correct type - could be string or number in DB
    let songId = songIdParam;
    if (songIdParam && !isNaN(songIdParam)) {
      songId = parseInt(songIdParam, 10);
    }

    // Use == for type-coercive comparison (string "123" == number 123)
    const projectionSong = songId ? songLibrary.find(s => s.id == songId) : null;

    console.log('🎵 Projection View Debug:', {
      songId,
      songIdType: typeof songId,
      songLibraryLength: songLibrary.length,
      firstSongId: songLibrary[0]?.id,
      firstSongIdType: typeof songLibrary[0]?.id,
      projectionSong: projectionSong ? `${projectionSong.title} - ${projectionSong.artist}` : 'NOT FOUND',
      hasChordSheet: projectionSong?.chord_sheet ? 'YES' : 'NO'
    });

    // Loading state - la libreria sta ancora caricando
    if (songLibrary.length === 0) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-center text-white">
            <Music className="w-32 h-32 mx-auto mb-6 opacity-50 animate-pulse" />
            <p className="text-2xl">Caricamento libreria brani...</p>
            <p className="text-sm text-gray-400 mt-4">Attendi qualche istante mentre la libreria viene caricata dal database</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-8 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
            >
              🔄 Ricarica pagina
            </button>
          </div>
        </div>
      );
    }

    if (projectionSong && projectionSong.chord_sheet) {
      // La vista projection viene aperta dall'organizzatore: mantieni i controlli completi
      return <ProjectionView song={projectionSong} users={users} showControls />;
    } else {
      // Brano non trovato o senza spartito
      const songFound = songId ? songLibrary.find(s => s.id == songId) : null;

      return (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-center text-white max-w-2xl mx-auto p-8">
            <Music className="w-32 h-32 mx-auto mb-6 opacity-50" />
            <p className="text-3xl font-bold mb-4">Spartito non disponibile</p>

            {songFound ? (
              <>
                <p className="text-xl text-gray-300 mb-2">{songFound.title}</p>
                <p className="text-lg text-gray-400 mb-6">{songFound.artist}</p>
                <p className="text-gray-400 mb-8">
                  Questo brano è presente nella libreria ma non ha ancora uno spartito ChordPro associato.
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-400 mb-4">
                  {songId ? `Brano con ID ${songId} non trovato nella libreria` : 'Nessun ID brano specificato nell\'URL'}
                </p>
                <div className="bg-gray-900 rounded-xl p-4 mb-8 text-left text-sm">
                  <p className="text-gray-500 mb-2">Debug info:</p>
                  <p className="text-gray-400">• Libreria: {songLibrary.length} brani caricati</p>
                  {songId && <p className="text-gray-400">• Song ID richiesto: {songId} (tipo: {typeof songId})</p>}
                  {songLibrary.length > 0 && (
                    <p className="text-gray-400">• Primo brano ID: {songLibrary[0]?.id} (tipo: {typeof songLibrary[0]?.id})</p>
                  )}
                </div>
              </>
            )}

            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
            >
              🔄 Ricarica pagina
            </button>
          </div>
        </div>
      );
    }
  }

  // ChordSheetViewer Modal - Priorità massima, viene mostrato sopra qualsiasi view
  if (viewingSong) {
    console.log('🎼 Rendering ChordSheetViewer per:', viewingSong.title, 'context:', songViewContext);
    return (
      <ChordSheetViewer
        song={viewingSong}
        onClose={() => {
          console.log('❌ Chiusura ChordSheetViewer');
          setViewingSong(null);
          // NUOVO: Chiudi anche lo spartito condiviso
          clearActiveSheet();
          // Se lo spartito è stato aperto dalla dashboard admin, resta lì
          if (songViewContext === 'admin') {
            // Non cambiare view, rimani in admin
          }
          setSongViewContext(null);
        }}
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
    );
  }

  // Form di modifica brano
  if (editingSongId) {
    const songToEdit = songLibrary.find(s => s.id === editingSongId);
    if (!songToEdit) {
      setEditingSongId(null);
      return null;
    }

    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-700">
          <div className="p-6 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Modifica Brano</h2>
              <button
                onClick={() => setEditingSongId(null)}
                className="text-gray-400 hover:text-white transition-colors text-2xl"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-6">
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              handleUpdateSong(
                editingSongId,
                formData.get('title'),
                formData.get('artist'),
                formData.get('year'),
                formData.get('chord_sheet')
              );
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">
                    Titolo *
                  </label>
                  <input
                    type="text"
                    name="title"
                    defaultValue={songToEdit.title}
                    required
                    className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">
                    Artista *
                  </label>
                  <input
                    type="text"
                    name="artist"
                    defaultValue={songToEdit.artist}
                    required
                    className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">
                    Anno
                  </label>
                  <input
                    type="number"
                    name="year"
                    defaultValue={songToEdit.year || ''}
                    className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">
                    Spartito (ChordPro)
                  </label>
                  <textarea
                    name="chord_sheet"
                    defaultValue={songToEdit.chord_sheet || ''}
                    rows={15}
                    className="w-full px-4 py-3 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-purple-400 font-mono text-sm"
                    placeholder="{title: Titolo}
{artist: Artista}

[Am]Testo con [G]accordi..."
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Formato ChordPro: usa [Am], [G], etc. per gli accordi
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
                >
                  💾 Salva Modifiche
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSongId(null)}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-semibold transition-colors"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'home') {
    const siteUrl = import.meta.env.VITE_SITE_URL
      ? import.meta.env.VITE_SITE_URL
      : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800/50 backdrop-blur-xl border border-purple-500/30 rounded-3xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-pink-600 blur-3xl opacity-50"></div>
              <Mic className="w-20 h-20 mx-auto mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 relative" style={{filter: 'drop-shadow(0 0 20px rgba(168, 85, 247, 0.5))'}} />
            </div>
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
              🎤 Karaoke Night
            </h1>
            <p className="text-gray-300 text-lg">Sistema Interattivo per Serate Musicali</p>
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
              className="group relative w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white py-4 rounded-xl hover:from-blue-700 hover:to-cyan-700 flex items-center justify-center gap-3 text-lg font-bold shadow-lg hover:shadow-xl transition-all hover:scale-105"
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
              className="group relative w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-xl hover:from-purple-700 hover:to-pink-700 flex items-center justify-center gap-3 text-lg font-bold shadow-lg hover:shadow-xl transition-all hover:scale-105"
            >
              <Play className="w-6 h-6" />
              Pannello Organizzatore
            </button>

            <button
              onClick={() => setView('display')}
              className="group relative w-full bg-gradient-to-r from-amber-600 to-orange-600 text-white py-4 rounded-xl hover:from-amber-700 hover:to-orange-700 flex items-center justify-center gap-3 text-lg font-bold shadow-lg hover:shadow-xl transition-all hover:scale-105"
            >
              <Trophy className="w-6 h-6" />
              Schermo Principale (display)
            </button>
          </div>

          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 bg-gray-700/50 border border-gray-600 rounded-full px-4 py-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <p className="text-sm text-gray-300">
                <span className="font-bold text-white">{users.length}</span> utenti connessi
              </p>
            </div>
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
      { id: 'year', name: 'Categoria per Anno', description: 'Brani per anno' }
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

    // NUOVO: Mostra spartito se l'admin lo ha attivato
    if (activeSheetSongId && !isAdminMode) {
      const sheetSong = songLibrary.find(s => s.id === activeSheetSongId || s.id == activeSheetSongId);
      if (sheetSong && sheetSong.chord_sheet) {
        return (
          <div className="min-h-screen bg-black">
            <ProjectionView
              song={sheetSong}
              users={users}
              showControls={false}
              onBackHome={() => setView('home')}
            />
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-full shadow-xl">
              📖 Spartito condiviso dall'organizzatore
            </div>
          </div>
        );
      }
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
      { id: 'band_picks', name: 'Scelti dalla Band', icon: Music, color: 'from-red-500 to-pink-500' }
    ];
    const pollPrepared = currentRound && currentRound.type === 'poll';

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4">
        <div className="max-w-6xl mx-auto py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-4xl font-bold text-amber-400">
              🎯 Dashboard
            </h2>
            {(() => {
              let projectionSongId = null;
              let projectionTitle = '';
              let displayUrl = `${window.location.origin}${window.location.pathname}?view=display`;

              // Determina quale spartito proiettare in base al round corrente
              if (currentRound) {
                if (currentRound.type === 'poll' && currentRound.selectedSong) {
                  projectionSongId = currentRound.selectedSong.id;
                  projectionTitle = `${currentRound.selectedSong.title} - ${currentRound.selectedSong.artist}`;
                } else if (currentRound.type === 'duet' && currentRound.song) {
                  projectionSongId = currentRound.song.id;
                  projectionTitle = `${currentRound.song.title} - ${currentRound.song.artist}`;
                } else if (currentRound.type === 'wheel' && currentRound.songs && currentRound.currentIndex !== undefined) {
                  const song = currentRound.songs[currentRound.currentIndex || 0];
                  projectionSongId = song.id;
                  projectionTitle = `${song.title} - ${song.artist}`;
                } else if (currentRound.type === 'band_picks' && currentRound.songs && currentRound.currentIndex !== undefined) {
                  const song = currentRound.songs[currentRound.currentIndex || 0];
                  projectionSongId = song.id;
                  projectionTitle = `${song.title} - ${song.artist}`;
                }
              }

              // Se c'è uno spartito da proiettare, usa la projection view
              if (projectionSongId) {
                displayUrl = `${window.location.origin}${window.location.pathname}?view=projection&songId=${projectionSongId}`;
              }

              return (
                <button
                  onClick={() => window.open(displayUrl, '_blank', 'width=1920,height=1080')}
                  className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6 py-3 rounded-xl transition-all shadow-lg"
                  title={projectionSongId ? `Proietta: ${projectionTitle}` : 'Apri display per proiezione'}
                >
                  <Maximize2 className="w-5 h-5" />
                  🖥️ {projectionSongId ? 'Proietta Display' : 'Apri Display'}
                </button>
              );
            })()}
          </div>

          {/* Stats Cards (cliccabili) - Visibili solo se non c'è una modalità di gioco selezionata */}
          {!compactSection && !selectedGameMode && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
              {/* Card Partecipanti - Cliccabile */}
              <button
                onClick={() => setCompactSection('users')}
                className="bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-blue-500/30 hover:border-blue-400 rounded-2xl p-6 text-center backdrop-blur-xl transition-all hover:scale-105 cursor-pointer"
              >
                <Users className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{users.length}</p>
                <p className="text-gray-300 font-semibold">Partecipanti</p>
                <p className="text-xs text-blue-300 mt-2">👆 Clicca per gestire</p>
              </button>

              {/* Card Brani - Cliccabile */}
              <button
                onClick={() => setCompactSection('songs')}
                className="bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-500/30 hover:border-purple-400 rounded-2xl p-6 text-center backdrop-blur-xl transition-all hover:scale-105 cursor-pointer"
              >
                <Music className="w-12 h-12 text-purple-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{songLibrary.length}</p>
                <p className="text-gray-300 font-semibold">Brani</p>
                <p className="text-xs text-purple-300 mt-2">👆 Clicca per gestire</p>
              </button>

              {/* Card Scelti dalla Band - Cliccabile */}
              <button
                onClick={() => setCompactSection('band_picks')}
                className="bg-gradient-to-br from-red-500/20 to-pink-600/20 border border-red-500/30 hover:border-red-400 rounded-2xl p-6 text-center backdrop-blur-xl transition-all hover:scale-105 cursor-pointer"
              >
                <Music className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{bandPicksList.length}</p>
                <p className="text-gray-300 font-semibold">Scaletta Band</p>
                <p className="text-xs text-red-300 mt-2">👆 Clicca per gestire</p>
              </button>

              {/* Card Round Attivo - Cliccabile */}
              <button
                onClick={() => {
                  if (currentRound && currentRound.type) {
                    setSelectedGameMode(currentRound.type);
                  }
                }}
                disabled={!currentRound}
                className={`bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 rounded-2xl p-6 text-center backdrop-blur-xl transition-all ${
                  currentRound ? 'hover:border-amber-400 hover:scale-105 cursor-pointer' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                <p className="text-5xl font-bold text-white mb-2">{currentRound ? '✓' : '—'}</p>
                <p className="text-gray-300 font-semibold">{currentRound ? 'Round Attivo' : 'Nessun Round'}</p>
                {currentRound && <p className="text-xs text-amber-300 mt-2">👆 Clicca per gestire</p>}
              </button>
            </div>
          )}

          {/* Sezione Espansa - Partecipanti */}
          {compactSection === 'users' && (
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 mb-6 border border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Users className="w-7 h-7 text-blue-400" />
                  Gestione Partecipanti
                </h3>
                <button
                  onClick={() => setCompactSection(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Chiudi
                </button>
              </div>
              <div className="flex gap-2 flex-wrap mb-4">
                {users.map(user => (
                  <div key={user.id} className="flex items-center gap-2 bg-gray-700/50 px-3 py-2 rounded-full border border-gray-600 hover:border-blue-400 transition-all">
                    <img src={user.photo} alt={user.name} className="w-8 h-8 rounded-full" />
                    <span className="text-sm font-semibold text-white">{user.name}</span>
                    <button
                      onClick={() => handleRemoveUser(user.id)}
                      className="text-xs text-red-400 hover:text-red-300 ml-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-sm text-gray-400">Nessun partecipante registrato</p>
                )}
              </div>
              <button
                onClick={handleResetParticipants}
                className="mt-4 text-sm text-red-400 hover:text-red-300 font-semibold"
              >
                Reset tutti i partecipanti
              </button>
            </div>
          )}

          {/* Sezione Espansa - Brani */}
          {compactSection === 'songs' && (
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 mb-6 border border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Music className="w-7 h-7 text-purple-400" />
                  Libreria Brani
                  <span className="text-xs bg-purple-500/30 px-2 py-1 rounded">SEZIONE: songs</span>
                </h3>
                <button
                  onClick={() => setCompactSection(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Chiudi
                </button>
              </div>

              {/* Barra di ricerca e Import */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="🔍 Cerca brani..."
                  value={songSearch}
                  onChange={(e) => setSongSearch(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-700/50 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-purple-400"
                />
                <input
                  ref={choFilesInputRef}
                  type="file"
                  accept=".cho"
                  multiple
                  onChange={handleChoFilesChange}
                  className="hidden"
                />
                <button
                  onClick={() => choFilesInputRef.current?.click()}
                  className="px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-medium transition-all shadow-sm flex items-center gap-1.5 text-xs whitespace-nowrap"
                  title="Importa spartiti ChordPro (.cho)"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Importa .cho
                </button>
                <button
                  onClick={() => setShowSongImporter(true)}
                  className="px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg font-medium transition-all shadow-sm flex items-center gap-1.5 text-xs whitespace-nowrap"
                  title="Importa brano da internet"
                >
                  <Music className="w-3.5 h-3.5" />
                  Importa da Web
                </button>
              </div>

              {/* Messaggio import */}
              {importMessage && (
                <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-xl text-green-300 text-sm">
                  {importMessage}
                </div>
              )}

              {/* Errori import */}
              {libraryErrors.length > 0 && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
                  <p className="text-red-300 text-sm font-semibold mb-2">⚠️ Errori durante l'importazione:</p>
                  <ul className="text-xs text-red-200 space-y-1">
                    {libraryErrors.map((err, idx) => (
                      <li key={idx}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Lista brani con scroll */}
              <div className="max-h-96 overflow-y-auto space-y-2">
                {songLibrary
                  .filter(song =>
                    song.title.toLowerCase().includes(songSearch.toLowerCase()) ||
                    song.artist.toLowerCase().includes(songSearch.toLowerCase())
                  )
                  .map((song) => (
                    <div key={song.id} className="bg-gray-700/50 rounded-xl p-4 border border-gray-600 hover:border-purple-400 transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-bold text-white flex items-center gap-2">
                            {song.title}
                            {song.chord_sheet && <Music className="w-4 h-4 text-amber-400" />}
                          </p>
                          <p className="text-sm text-gray-300">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                        </div>
                        <div className="flex gap-2 items-center">
                          {song.chord_sheet && (
                            <>
                              <button
                                onClick={() => {
                                  setViewingSong(song);
                                  setSongViewContext('admin');
                                }}
                                className="px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors"
                              >
                                📄 Apri
                              </button>
                              <button
                                onClick={() => {
                                  const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${song.id}`;
                                  window.open(url, '_blank');
                                }}
                                className="px-3 py-1 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors"
                                title="Proietta spartito su display esterno"
                              >
                                📺 Proietta
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              if (!bandPicksList.find(s => s.id === song.id)) {
                                const newList = [...bandPicksList, song];
                                setBandPicksList(newList);
                                if (typeof localStorage !== 'undefined') {
                                  localStorage.setItem('band_picks_list', JSON.stringify(newList));
                                }
                              }
                            }}
                            disabled={!!bandPicksList.find(s => s.id === song.id)}
                            className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={bandPicksList.find(s => s.id === song.id) ? "Già in scaletta" : "Aggiungi a Scelti dalla Band"}
                          >
                            🎸
                          </button>
                          <button
                            onClick={() => setEditingSongId(song.id)}
                            className="text-sm text-blue-400 hover:text-blue-300"
                          >
                            Modifica
                          </button>
                          <button
                            onClick={() => handleDeleteSong(song.id)}
                            className="text-sm text-red-400 hover:text-red-300"
                          >
                            Elimina
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Indicatore brani in scaletta */}
              {bandPicksList.length > 0 && (
                <div className="mt-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-red-400 font-semibold flex items-center gap-2">
                      🎸 Brani in Scaletta: {bandPicksList.length}
                    </p>
                    <button
                      onClick={() => setCompactSection('band_picks')}
                      className="text-xs text-red-300 hover:text-red-200 underline"
                    >
                      Vedi scaletta →
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bandPicksList.slice(0, 5).map((song, index) => (
                      <div key={index} className="bg-red-900/30 px-2 py-1 rounded text-xs text-red-200">
                        {song.title}
                      </div>
                    ))}
                    {bandPicksList.length > 5 && (
                      <div className="bg-red-900/30 px-2 py-1 rounded text-xs text-red-200">
                        +{bandPicksList.length - 5} altri
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sezione Espansa - Scelti dalla Band */}
          {compactSection === 'band_picks' && (
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 mb-6 border border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Music className="w-7 h-7 text-red-400" />
                  🎸 Scelti dalla Band
                  <span className="text-xs bg-red-500/30 px-2 py-1 rounded">SEZIONE: band_picks</span>
                </h3>
                <button
                  onClick={() => setCompactSection(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Chiudi
                </button>
              </div>

              {/* Statistiche */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4">
                  <p className="text-red-400 text-sm uppercase tracking-wider mb-1">Brani in Scaletta</p>
                  <p className="text-3xl font-bold text-white">{bandPicksList.length}</p>
                </div>
                <div className="bg-pink-500/20 border border-pink-500/30 rounded-xl p-4">
                  <p className="text-pink-400 text-sm uppercase tracking-wider mb-1">Brano Corrente</p>
                  <p className="text-3xl font-bold text-white">{currentBandPickIndex + 1} / {bandPicksList.length || '0'}</p>
                </div>
              </div>

              {bandPicksList.length > 0 ? (
                <div className="space-y-4">
                  {/* Lista brani */}
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {bandPicksList.map((song, index) => (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-3 rounded-xl transition-all ${
                          index === currentBandPickIndex
                            ? 'bg-red-600/30 border-2 border-red-400'
                            : 'bg-gray-700/50 border border-gray-600'
                        }`}
                      >
                        <div className="flex-1">
                          <p className="font-bold text-white">
                            {index + 1}. {song.title}
                          </p>
                          <p className="text-sm text-gray-400">{song.artist}</p>
                        </div>
                        <div className="flex gap-2 items-center">
                          {song.chord_sheet && (
                            <button
                              onClick={() => {
                                setViewingSong(song);
                                setSongViewContext('admin');
                              }}
                              className="px-2 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors"
                            >
                              📄
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const newList = bandPicksList.filter((_, i) => i !== index);
                              setBandPicksList(newList);
                              if (typeof localStorage !== 'undefined') {
                                localStorage.setItem('band_picks_list', JSON.stringify(newList));
                              }
                              if (currentBandPickIndex >= newList.length && newList.length > 0) {
                                setCurrentBandPickIndex(newList.length - 1);
                              }
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Controlli navigazione */}
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setCurrentBandPickIndex(Math.max(0, currentBandPickIndex - 1))}
                      disabled={currentBandPickIndex === 0}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      ⬅️ Precedente
                    </button>
                    <button
                      onClick={() => setCurrentBandPickIndex(Math.min(bandPicksList.length - 1, currentBandPickIndex + 1))}
                      disabled={currentBandPickIndex >= bandPicksList.length - 1}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      Successivo ➡️
                    </button>
                  </div>

                  {/* Pulsanti azione */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedGameMode('band_picks')}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      📋 Gestisci Scaletta
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Vuoi svuotare la scaletta?')) {
                          setBandPicksList([]);
                          setCurrentBandPickIndex(0);
                          if (typeof localStorage !== 'undefined') {
                            localStorage.removeItem('band_picks_list');
                          }
                        }
                      }}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors"
                    >
                      🗑️ Svuota
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">Nessun brano in scaletta</p>
                  <button
                    onClick={() => setCompactSection('songs')}
                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-colors"
                  >
                    🎸 Aggiungi Brani
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sezione Espansa - Round Attivo */}
          {compactSection === 'round' && currentRound && (
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 mb-6 border border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Trophy className="w-7 h-7 text-amber-400" />
                  Round Attivo
                </h3>
                <button
                  onClick={() => setCompactSection(null)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Chiudi
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-700/50 rounded-xl p-4 border border-gray-600">
                  <p className="text-sm text-gray-400 mb-1">Tipo Round</p>
                  <p className="text-xl font-bold text-white capitalize">{currentRound.type || 'Poll'}</p>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-4 border border-gray-600">
                  <p className="text-sm text-gray-400 mb-1">Stato</p>
                  <p className="text-xl font-bold text-white">
                    {currentRound.votingOpen ? '🟢 Votazione Aperta' : '🔴 Votazione Chiusa'}
                  </p>
                </div>

                <div className="bg-gray-700/50 rounded-xl p-4 border border-gray-600">
                  <p className="text-sm text-gray-400 mb-1">Brani nel Round</p>
                  <p className="text-xl font-bold text-white">{currentRound.songs?.length || 0}</p>
                </div>

                <button
                  onClick={handleResetRound}
                  className="w-full bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
                >
                  🔄 Reset Round
                </button>
              </div>
            </div>
          )}

          {/* Modalità di Gioco - Schermata principale */}
          {!compactSection && !selectedGameMode && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
                  🎮 Modalità di Gioco
                </h3>
                <p className="text-gray-400">Seleziona una modalità per iniziare</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {gameCategories.map(cat => {
                  const IconComponent = cat.icon;
                  const isActive = currentRound?.type === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedGameMode(cat.id)}
                      className={`relative p-8 bg-gradient-to-br ${cat.color} text-white rounded-3xl hover:shadow-2xl transition-all transform hover:scale-105 border-2 border-white/20 backdrop-blur-xl ${
                        isActive ? 'ring-4 ring-yellow-400 shadow-yellow-400/50' : ''
                      }`}
                    >
                      <IconComponent className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-bold text-xl text-center mb-2">{cat.name}</p>
                      {isActive && (
                        <div className="absolute top-3 right-3 bg-yellow-400 text-gray-900 text-xs font-bold px-2 py-1 rounded-full">
                          Attivo
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pagina dedicata Sondaggio Brani */}
          {selectedGameMode === 'poll' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2 flex items-center gap-3">
                    <Music className="w-10 h-10 text-purple-400" />
                    {currentRound?.isTiebreaker ? '⚖️ Spareggio' : '📊 Sondaggio Brani'}
                  </h3>
                  <p className="text-gray-400">
                    {currentRound?.isTiebreaker
                      ? `Votazione di spareggio tra ${currentRound.songs?.length || 0} brani ex aequo`
                      : 'Prepara 10 brani casuali e gestisci la votazione'}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedGameMode(null)}
                    className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 hover:text-white px-6 py-3 rounded-xl transition-all border border-gray-700 backdrop-blur-xl"
                  >
                    🎮 Dashboard
                  </button>
                  <button
                    onClick={() => setView('home')}
                    className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 hover:text-white px-6 py-3 rounded-xl transition-all border border-gray-700 backdrop-blur-xl"
                  >
                    🏠 Home
                  </button>
                </div>
              </div>

              {/* Avvisi */}
              {songLibrary.length < 10 && (
                <div className="flex items-center gap-3 text-yellow-300 bg-yellow-900/30 border border-yellow-700/50 p-4 rounded-xl backdrop-blur-xl">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-semibold">Carica almeno 10 brani per preparare il sondaggio.</span>
                </div>
              )}

              {roundMessage && (
                <div className="flex items-center gap-3 text-blue-300 bg-blue-900/30 border border-blue-700/50 p-4 rounded-xl backdrop-blur-xl">
                  <CheckCircle className="w-5 h-5 text-blue-400" />
                  <span className="font-semibold">{roundMessage}</span>
                </div>
              )}

              {/* Statistiche Round */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-sm text-gray-400 mb-2">Stato Round</p>
                  <p className="text-2xl font-bold text-white">
                    {pollPrepared ? (currentRound?.state || 'In attesa') : 'Nessun round'}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-sm text-gray-400 mb-2">Voti Ricevuti</p>
                  <p className="text-2xl font-bold text-white">{votesReceived} / {users.length}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-sm text-gray-400 mb-2">Brani nel Round</p>
                  <p className="text-2xl font-bold text-white">{currentRound?.songs?.length || 0}</p>
                </div>
              </div>

              {/* Pulsanti azione principali */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <button
                  onClick={handlePreparePoll}
                  disabled={songLibrary.length < 10}
                  className="p-6 bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-2xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg transition-all hover:scale-105 border border-white/20 backdrop-blur-xl"
                >
                  🎲 Prepara Round
                </button>
                <button
                  onClick={handleOpenVoting}
                  disabled={!pollPrepared || currentRound?.votingOpen}
                  className="p-6 bg-gradient-to-br from-green-600 to-emerald-600 text-white rounded-2xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg transition-all hover:scale-105 border border-white/20 backdrop-blur-xl"
                >
                  ✅ Apri Votazione
                </button>
                <button
                  onClick={handleCloseVoting}
                  disabled={!currentRound || !currentRound.votingOpen}
                  className="p-6 bg-gradient-to-br from-red-600 to-pink-600 text-white rounded-2xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed font-bold text-lg transition-all hover:scale-105 border border-white/20 backdrop-blur-xl"
                >
                  🛑 Chiudi Votazione
                </button>
              </div>

              {/* Reset Round */}
              <div className="flex justify-end">
                <button
                  onClick={handleResetRound}
                  className="flex items-center gap-2 text-red-400 hover:text-red-300 font-semibold transition-colors"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Reset Round
                </button>
              </div>

              {/* Anteprima brani round corrente */}
              {currentRound && currentRound.songs && (
                <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-6 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-2xl font-bold text-white flex items-center gap-2">
                      <Eye className="w-6 h-6 text-purple-400" />
                      Brani del Round
                    </h4>
                    <span className="text-sm text-gray-400">
                      {currentRound.votingOpen ? '🟢 Votazione Aperta' : '🔴 Votazione Chiusa'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentRound.songs.map(song => {
                      const votes = currentRound.votingOpen
                        ? (currentRound.votes || []).filter(v => v.songId === song.id).length
                        : 0;
                      return (
                        <div key={song.id} className="bg-gray-700/50 rounded-xl p-4 border border-gray-600 hover:border-purple-400 transition-all">
                          <p className="font-bold text-white flex items-center gap-2">
                            {song.title}
                            {song.chord_sheet && <Music className="w-4 h-4 text-amber-400" />}
                          </p>
                          <p className="text-sm text-gray-300">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                          {currentRound.votingOpen && (
                            <div className="mt-3 flex items-center gap-2">
                              <div className="flex-1 bg-gray-600 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all"
                                  style={{ width: `${users.length > 0 ? (votes / users.length) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-purple-400">{votes}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Risultati */}
              {roundResults && (
                <div className="bg-gradient-to-br from-green-500/20 to-teal-600/20 border border-green-500/30 rounded-3xl p-6 backdrop-blur-xl">
                  <h4 className="text-2xl font-bold text-green-400 mb-4 flex items-center gap-2">
                    🏆 Risultati
                  </h4>
                  {roundResults.winner && (
                    <div className="mb-4 bg-green-900/30 rounded-2xl p-6 border border-green-500/50">
                      <p className="text-sm uppercase text-green-300 mb-2">Vincitore</p>
                      <div
                        className={roundResults.winner.chord_sheet ? "cursor-pointer hover:bg-green-800/30 p-3 rounded-lg transition-colors" : ""}
                        onClick={() => {
                          console.log('🎵 Click su vincitore, ha spartito?', !!roundResults.winner.chord_sheet);
                          if (roundResults.winner.chord_sheet) {
                            console.log('📖 Apertura spartito vincitore in proiezione:', roundResults.winner.title);
                            // NUOVO: Sincronizza spartito con tutti i dispositivi
                            setActiveSheet(roundResults.winner.id);
                            // Apri in modalità proiezione in una nuova scheda
                            const projectionUrl = `${window.location.origin}${window.location.pathname}?view=projection&songId=${roundResults.winner.id}`;
                            window.open(projectionUrl, '_blank');
                          }
                        }}
                      >
                        <p className="text-4xl font-bold text-green-400 flex items-center gap-3">
                          {roundResults.winner.title}
                          {roundResults.winner.chord_sheet && <Music className="w-8 h-8 text-amber-400" />}
                        </p>
                        <p className="text-xl text-green-200 mt-1">{roundResults.winner.artist}</p>
                        {roundResults.winner.chord_sheet && (
                          <p className="text-xs text-amber-400 mt-2">👆 Clicca per proiettare lo spartito</p>
                        )}
                      </div>
                    </div>
                  )}
                  {roundResults.stats && <ResultList stats={roundResults.stats} compact />}
                  <button
                    onClick={() => setRoundResults(null)}
                    className="mt-4 text-sm text-green-400 hover:text-green-300 font-semibold transition-colors"
                  >
                    Nascondi risultati
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ==================== PAGINA DUETTI ==================== */}
          {selectedGameMode === 'duet' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 mb-2 flex items-center gap-3">
                    <Users className="w-10 h-10 text-blue-400" />
                    💕 Duetti
                  </h3>
                  <p className="text-gray-400 text-lg">Trova coppie che hanno votato la stessa canzone e falli duettare!</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedGameMode(null)}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    🎮 Dashboard
                  </button>
                  <button
                    onClick={() => setView('home')}
                    className="px-6 py-3 bg-gray-800/50 backdrop-blur-sm border border-gray-700 text-white rounded-xl hover:bg-gray-700/50 transition-all font-semibold flex items-center gap-2"
                  >
                    🏠 Home
                  </button>
                </div>
              </div>

              {/* Messaggio di stato */}
              {roundMessage && (
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-2xl p-4 backdrop-blur-xl">
                  <p className="text-blue-300 text-center font-semibold">{roundMessage}</p>
                </div>
              )}

              {/* Pulsante Avvia Duetto */}
              <div className="bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 rounded-3xl p-8 backdrop-blur-xl text-center">
                <h4 className="text-2xl font-bold text-blue-400 mb-4">Cerca Duetto</h4>
                <p className="text-gray-300 mb-6">Il sistema cercherà automaticamente coppie che hanno votato per la stessa canzone nelle votazioni passate.</p>

                {/* Avviso round attivo */}
                {currentRound && currentRound.type !== 'duet' && (
                  <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-4">
                    <p className="text-red-300 font-semibold mb-3">⚠️ C'è un round attivo di tipo "{currentRound.type}"</p>
                    <button
                      onClick={handleEndRound}
                      className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      Termina Round Corrente
                    </button>
                  </div>
                )}

                <button
                  onClick={handleStartDuet}
                  disabled={!!currentRound}
                  className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold text-lg shadow-lg hover:shadow-xl"
                >
                  🔍 Trova Duetto
                </button>
              </div>

              {/* Visualizzazione Round Corrente */}
              {currentRound && currentRound.type === 'duet' && (
                <div className="bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 rounded-3xl p-8 backdrop-blur-xl">
                  <h4 className="text-3xl font-bold text-pink-400 mb-6 text-center">💕 Duetto Trovato! 💕</h4>

                  {/* Due utenti affiancati */}
                  <div className="flex justify-center items-center gap-8 mb-8">
                    <div className="text-center">
                      <img
                        src={currentRound.user1.photo}
                        alt={currentRound.user1.name}
                        className="w-32 h-32 rounded-full mx-auto border-4 border-pink-400 mb-3 shadow-xl"
                      />
                      <p className="text-2xl font-bold text-pink-300">{currentRound.user1.name}</p>
                    </div>

                    <div className="text-6xl text-pink-400">❤️</div>

                    <div className="text-center">
                      <img
                        src={currentRound.user2.photo}
                        alt={currentRound.user2.name}
                        className="w-32 h-32 rounded-full mx-auto border-4 border-pink-400 mb-3 shadow-xl"
                      />
                      <p className="text-2xl font-bold text-pink-300">{currentRound.user2.name}</p>
                    </div>
                  </div>

                  {/* Canzone */}
                  <div className="bg-pink-900/30 rounded-2xl p-6 border border-pink-500/50 text-center">
                    <p className="text-gray-400 mb-3">🎵 Canterete insieme 🎵</p>
                    <p className="text-3xl font-bold text-pink-300 mb-2">{currentRound.song.title}</p>
                    <p className="text-xl text-pink-200">{currentRound.song.artist}</p>
                    {currentRound.song.chord_sheet && (
                      <button
                        onClick={() => {
                          const fullSong = songLibrary.find(s => s.id === currentRound.song.id || s.id == currentRound.song.id) || currentRound.song;
                          if (fullSong.chord_sheet) {
                            setActiveSheet(fullSong.id);
                            const projectionUrl = `${window.location.origin}${window.location.pathname}?view=projection&songId=${fullSong.id}`;
                            window.open(projectionUrl, '_blank');
                          }
                        }}
                        className="mt-4 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors flex items-center gap-2 mx-auto"
                      >
                        <Music className="w-5 h-5" />
                        Proietta
                      </button>
                    )}
                  </div>

                  {/* Pulsanti */}
                  <div className="flex gap-4 justify-center mt-6">
                    <button
                      onClick={handleEndRound}
                      className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-colors"
                    >
                      Termina Round
                    </button>
                  </div>
                </div>
              )}

              {/* Reset Round */}
              {currentRound && currentRound.type === 'duet' && (
                <div className="flex justify-end">
                  <button
                    onClick={handleResetRound}
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 font-semibold transition-colors"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Reset Round
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ==================== PAGINA RUOTA DELLA FORTUNA ==================== */}
          {selectedGameMode === 'wheel' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400 mb-2 flex items-center gap-3">
                    <Disc className="w-10 h-10 text-yellow-400" />
                    🎰 Ruota della Fortuna
                  </h3>
                  <p className="text-gray-400 text-lg">Selezione casuale di un partecipante che sceglierà tra 20 brani casuali!</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedGameMode(null)}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    🎮 Dashboard
                  </button>
                  <button
                    onClick={() => setView('home')}
                    className="px-6 py-3 bg-gray-800/50 backdrop-blur-sm border border-gray-700 text-white rounded-xl hover:bg-gray-700/50 transition-all font-semibold flex items-center gap-2"
                  >
                    🏠 Home
                  </button>
                </div>
              </div>

              {/* Statistiche */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border border-yellow-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-yellow-400 text-sm uppercase tracking-wider mb-2">Partecipanti</p>
                  <p className="text-4xl font-bold text-white">{users.length}</p>
                  <p className="text-gray-400 text-sm mt-1">Minimo richiesto: 2</p>
                </div>
                <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border border-yellow-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-yellow-400 text-sm uppercase tracking-wider mb-2">Brani in Libreria</p>
                  <p className="text-4xl font-bold text-white">{songLibrary.length}</p>
                  <p className="text-gray-400 text-sm mt-1">Minimo richiesto: 20</p>
                </div>
              </div>

              {/* Messaggio di stato */}
              {roundMessage && (
                <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-2xl p-4 backdrop-blur-xl">
                  <p className="text-yellow-300 text-center font-semibold">{roundMessage}</p>
                </div>
              )}

              {/* Pulsante Avvia Ruota */}
              <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border border-yellow-500/30 rounded-3xl p-8 backdrop-blur-xl text-center">
                <h4 className="text-2xl font-bold text-yellow-400 mb-4">Gira la Ruota!</h4>
                <p className="text-gray-300 mb-6">Seleziona casualmente un partecipante che sceglierà un brano tra 20 opzioni casuali.</p>

                {/* Avviso round attivo */}
                {currentRound && currentRound.type !== 'wheel' && (
                  <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-4">
                    <p className="text-red-300 font-semibold mb-3">⚠️ C'è un round attivo di tipo "{currentRound.type}"</p>
                    <button
                      onClick={handleEndRound}
                      className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      Termina Round Corrente
                    </button>
                  </div>
                )}

                <button
                  onClick={handleStartWheel}
                  disabled={!!currentRound || users.length < 2 || songLibrary.length < 20}
                  className="px-8 py-4 bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-xl hover:from-yellow-700 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold text-lg shadow-lg hover:shadow-xl"
                >
                  🎰 Gira la Ruota
                </button>
                {(users.length < 2 || songLibrary.length < 20) && (
                  <p className="text-red-400 text-sm mt-3">
                    {users.length < 2 ? '⚠️ Servono almeno 2 partecipanti' : '⚠️ Servono almeno 20 brani in libreria'}
                  </p>
                )}
              </div>

              {/* Visualizzazione Round Corrente */}
              {currentRound && currentRound.type === 'wheel' && (
                <div className="bg-gradient-to-br from-yellow-500/20 to-orange-600/20 border border-yellow-500/30 rounded-3xl p-8 backdrop-blur-xl">
                  <h4 className="text-3xl font-bold text-yellow-400 mb-6 text-center">🎰 Round in Corso</h4>

                  {/* Stato: Spinning - Mostra la ruota */}
                  {currentRound.state === 'spinning' && currentRound.users && (
                    <div>
                      <WheelOfFortune
                        items={currentRound.users}
                        type="users"
                        autoSpin={true}
                        onComplete={handleWheelComplete}
                        preselectedWinnerIndex={currentRound.preselectedWinnerIndex}
                      />
                    </div>
                  )}

                  {/* Stato: Winner Selected */}
                  {currentRound.state === 'winner_selected' && currentRound.winner && (
                    <div className="text-center">
                      <p className="text-2xl text-green-400 mb-6">🎉 Vincitore selezionato!</p>
                      <img
                        src={currentRound.winner.photo}
                        alt={currentRound.winner.name}
                        className="w-32 h-32 rounded-full mx-auto border-4 border-yellow-400 mb-3 shadow-xl"
                      />
                      <p className="text-3xl font-bold text-yellow-300">{currentRound.winner.name}</p>
                      <p className="text-gray-400 mt-4">Sta scegliendo tra 20 brani...</p>
                    </div>
                  )}

                  {/* Stato: Song Selected */}
                  {currentRound.state === 'song_selected' && currentRound.selectedSong && (() => {
                    // Recupera il brano completo dalla libreria per avere il chord_sheet
                    const fullSong = songLibrary.find(s => s.id === currentRound.selectedSong.id || s.id == currentRound.selectedSong.id) || currentRound.selectedSong;
                    return (
                      <div>
                        <div className="text-center mb-6">
                          <p className="text-2xl text-green-400 mb-4">✅ Brano selezionato!</p>
                          <img
                            src={currentRound.winner.photo}
                            alt={currentRound.winner.name}
                            className="w-24 h-24 rounded-full mx-auto border-4 border-yellow-400 mb-2 shadow-xl"
                          />
                          <p className="text-2xl font-bold text-yellow-300">{currentRound.winner.name}</p>
                        </div>
                        <div
                          className={fullSong.chord_sheet ? "bg-yellow-900/30 rounded-2xl p-6 border border-yellow-500/50 text-center cursor-pointer hover:bg-yellow-800/30 transition-colors" : "bg-yellow-900/30 rounded-2xl p-6 border border-yellow-500/50 text-center"}
                          onClick={() => {
                            if (fullSong.chord_sheet) {
                              console.log('📖 Apertura spartito vincitore ruota in proiezione:', fullSong.title);
                              // Sincronizza spartito con tutti i dispositivi
                              setActiveSheet(fullSong.id);
                              // Apri in modalità proiezione in una nuova scheda
                              const projectionUrl = `${window.location.origin}${window.location.pathname}?view=projection&songId=${fullSong.id}`;
                              window.open(projectionUrl, '_blank');
                            }
                          }}
                        >
                          <Music className="w-16 h-16 text-yellow-400 mx-auto mb-3" />
                          <p className="text-3xl font-bold text-yellow-300 mb-2">{fullSong.title}</p>
                          <p className="text-xl text-yellow-200">{fullSong.artist}</p>
                          {fullSong.chord_sheet && (
                            <p className="text-xs text-amber-400 mt-4">👆 Clicca per proiettare lo spartito</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Reset Round */}
              {currentRound && currentRound.type === 'wheel' && (
                <div className="flex justify-end">
                  <button
                    onClick={handleResetRound}
                    className="flex items-center gap-2 text-red-400 hover:text-red-300 font-semibold transition-colors"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Reset Round
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ==================== PAGINA SCELTI DALLA BAND ==================== */}
          {selectedGameMode === 'band_picks' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-pink-400 mb-2 flex items-center gap-3">
                    <Music className="w-10 h-10 text-red-400" />
                    🎸 Scelti dalla Band
                  </h3>
                  <p className="text-gray-400 text-lg">Crea una scaletta personalizzata e mostra i brani uno alla volta!</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedGameMode(null)}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    🎮 Dashboard
                  </button>
                  <button
                    onClick={() => setView('home')}
                    className="px-6 py-3 bg-gray-800/50 backdrop-blur-sm border border-gray-700 text-white rounded-xl hover:bg-gray-700/50 transition-all font-semibold flex items-center gap-2"
                  >
                    🏠 Home
                  </button>
                </div>
              </div>

              {/* Messaggio di stato */}
              {roundMessage && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-2xl p-4 backdrop-blur-xl">
                  <p className="text-red-300 text-center font-semibold">{roundMessage}</p>
                </div>
              )}

              {/* Statistiche */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-red-500/20 to-pink-600/20 border border-red-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-red-400 text-sm uppercase tracking-wider mb-2">Brani in Scaletta</p>
                  <p className="text-4xl font-bold text-white">{bandPicksList.length}</p>
                </div>
                <div className="bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 rounded-2xl p-6 backdrop-blur-xl">
                  <p className="text-pink-400 text-sm uppercase tracking-wider mb-2">Brano Corrente</p>
                  <p className="text-4xl font-bold text-white">{currentBandPickIndex + 1} / {bandPicksList.length || '0'}</p>
                </div>
              </div>

              {/* Gestione Scaletta */}
              <div className="bg-gradient-to-br from-red-500/20 to-pink-600/20 border border-red-500/30 rounded-3xl p-8 backdrop-blur-xl">
                <h4 className="text-2xl font-bold text-red-400 mb-4">📋 Gestisci Scaletta</h4>

                {bandPicksList.length > 0 ? (
                  <div className="space-y-4">
                    <div className="bg-gray-900/50 rounded-xl p-4 max-h-96 overflow-y-auto">
                      {bandPicksList.map((song, index) => (
                        <div
                          key={index}
                          className={`flex items-center justify-between p-3 mb-2 rounded-lg transition-all ${
                            index === currentBandPickIndex
                              ? 'bg-red-600/30 border-2 border-red-400'
                              : 'bg-gray-800/50 border border-gray-700'
                          }`}
                        >
                          <div className="flex-1">
                            <p className="font-bold text-white">
                              {index + 1}. {song.title}
                            </p>
                            <p className="text-sm text-gray-400">{song.artist}</p>
                          </div>
                          <div className="flex gap-2 items-center">
                            {song.chord_sheet && (
                              <>
                                <button
                                  onClick={() => {
                                    setViewingSong(song);
                                    setSongViewContext('admin');
                                  }}
                                  className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors"
                                  title="Apri spartito nella finestra corrente"
                                >
                                  📄 Spartito
                                </button>
                                <button
                                  onClick={() => {
                                    const fullSong = songLibrary.find(s => s.id === song.id || s.id == song.id) || song;
                                    if (fullSong.chord_sheet) {
                                      setActiveSheet(fullSong.id);
                                      const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${fullSong.id}`;
                                      window.open(url, '_blank');
                                    }
                                  }}
                                  className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors"
                                  title="Proietta spartito su display esterno"
                                >
                                  📺 Proietta
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => setCurrentBandPickIndex(Math.max(0, currentBandPickIndex - 1))}
                        disabled={currentBandPickIndex === 0}
                        className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold"
                      >
                        ⬅️ Precedente
                      </button>
                      <button
                        onClick={() => setCurrentBandPickIndex(Math.min(bandPicksList.length - 1, currentBandPickIndex + 1))}
                        disabled={currentBandPickIndex >= bandPicksList.length - 1}
                        className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold"
                      >
                        Successivo ➡️
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setBandPicksList([]);
                        setCurrentBandPickIndex(0);
                        if (typeof localStorage !== 'undefined') {
                          localStorage.setItem('band_picks_list', JSON.stringify([]));
                        }
                      }}
                      className="w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all font-semibold"
                    >
                      🗑️ Svuota Scaletta
                    </button>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">
                    Nessun brano in scaletta. Aggiungili dalla libreria in modalità estesa.
                  </p>
                )}
              </div>
            </div>
          )}


          <button
            onClick={() => setView('home')}
            className="mt-4 text-white hover:text-gray-300 block mx-auto font-semibold"
          >
            ← Torna alla Home
          </button>
        </div>

        {/* SongImporter Modal */}
        {showSongImporter && (
          <SongImporter
            onClose={() => setShowSongImporter(false)}
            onImport={handleAddSong}
          />
        )}
      </div>
    );
  }

  if (view === 'display') {
    // NUOVO: Mostra spartito se l'admin lo ha attivato (anche in display)
    if (activeSheetSongId && !isAdminMode) {
      const sheetSong = songLibrary.find(s => s.id === activeSheetSongId || s.id == activeSheetSongId);
      if (sheetSong && sheetSong.chord_sheet) {
        return (
          <div className="min-h-screen bg-black">
            <ProjectionView
              song={sheetSong}
              users={users}
              showControls={false}
              onBackHome={() => setView('home')}
            />
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-full shadow-xl">
              📖 Spartito condiviso dall'organizzatore
            </div>
          </div>
        );
      }
    }

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

                      {/* Pulsanti spartito */}
                      {currentRound.selectedSong.chord_sheet && (
                        <div className="mt-8 flex gap-4 justify-center">
                          <button
                            onClick={() => {
                              setViewingSong(currentRound.selectedSong);
                              setSongViewContext('display');
                            }}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors text-lg"
                            title="Apri spartito nella finestra corrente"
                          >
                            📄 Spartito
                          </button>
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${currentRound.selectedSong.id}`;
                              window.open(url, '_blank');
                            }}
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors text-lg"
                            title="Proietta spartito su display esterno"
                          >
                            📺 Proietta
                          </button>
                        </div>
                      )}

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

                  {/* Pulsanti spartito */}
                  {currentRound.song.chord_sheet && (
                    <div className="mt-8 flex gap-4 justify-center">
                      <button
                        onClick={() => {
                          const fullSong = songLibrary.find(s => s.id === currentRound.song.id || s.id == currentRound.song.id) || currentRound.song;
                          if (fullSong.chord_sheet) {
                            setActiveSheet(fullSong.id);
                            const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${fullSong.id}`;
                            window.open(url, '_blank');
                          }
                        }}
                        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors text-lg"
                        title="Proietta spartito su display esterno"
                      >
                        📺 Proietta
                      </button>
                    </div>
                  )}

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
                    <p className="text-gray-600 text-lg mt-2">
                      Brano {(currentRound.currentIndex || 0) + 1} di {currentRound.songs.length}
                    </p>
                  </div>

                  {/* Pulsanti spartito */}
                  {currentRound.songs[currentRound.currentIndex || 0].chord_sheet && (
                    <div className="mt-8 flex gap-4 justify-center">
                      <button
                        onClick={() => {
                          const currentSong = currentRound.songs[currentRound.currentIndex || 0];
                          const fullSong = songLibrary.find(s => s.id === currentSong.id || s.id == currentSong.id) || currentSong;
                          if (fullSong.chord_sheet) {
                            setActiveSheet(fullSong.id);
                            const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${fullSong.id}`;
                            window.open(url, '_blank');
                          }
                        }}
                        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors text-lg"
                        title="Proietta spartito su display esterno"
                      >
                        📺 Proietta
                      </button>
                    </div>
                  )}

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
                    onClick={() => {
                      if (roundResults.winner.chord_sheet) {
                        const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${roundResults.winner.id}`;
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <p className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
                      {roundResults.winner.title}
                      {roundResults.winner.chord_sheet && <Music className="w-8 h-8 text-amber-500" />}
                    </p>
                    <p className="text-xl text-gray-600">{roundResults.winner.artist}</p>
                    {roundResults.winner.chord_sheet && (
                      <p className="text-sm text-amber-600 mt-2">👆 Clicca per proiettare lo spartito</p>
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
                        onClick={() => {
                          const url = `${window.location.origin}${window.location.pathname}?view=projection&songId=${roundResults.winner.id}`;
                          window.open(url, '_blank');
                        }}
                        className="flex items-center gap-2 bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 font-semibold"
                      >
                        📺 Proietta Spartito
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
      </div>
    );
  }

  setView('home');
  return null;
}
