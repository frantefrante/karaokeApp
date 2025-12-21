import React, { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Camera, Music, Users, Play, Trophy, Disc, Calendar, Mic, Upload, AlertTriangle, CheckCircle, RefreshCcw, Eye } from 'lucide-react';

const STORAGE_KEY = 'karaoke_songs';
const CURRENT_USER_KEY = 'karaoke_current_user';

const computeResults = (round) => {
  if (!round) return { winner: null, stats: [] };
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
  return {
    winner: songsList.find(s => s.id === winner?.songId) || null,
    stats: sorted.map(s => ({
      song: songsList.find(song => song.id === s.songId),
      votes: s.count
    }))
  };
};
// Escape space in SSID for better QR compatibility
const WIFI_QR_VALUE = 'WIFI:T:WPA;S:FASTWEB-EUK8T4\\ 5Hz;P:BCAXTYDCD9;;';

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
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('La fotocamera richiede https o localhost. Se non puoi abilitarla, continua con l\'avatar di default.');
      usePlaceholder();
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      setStream(mediaStream);
      setError('');
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
        };
      }
    } catch (err) {
      console.error('Errore accesso camera:', err);
      setError('Impossibile accedere alla camera. Controlla i permessi e riprova.');
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
            className="w-full max-w-md mx-auto rounded-lg mb-4"
          />
          <button
            onClick={capturePhoto}
            className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700"
          >
            📸 Scatta Foto
          </button>
        </div>
      )}
    </div>
  );
}

function WheelOfFortune({ items, type = 'users', onComplete }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState(null);

  const spinWheel = () => {
    if (spinning) return;
    
    setSpinning(true);
    const spins = 5 + Math.random() * 3;
    const finalRotation = 360 * spins + Math.random() * 360;
    setRotation(finalRotation);

    setTimeout(() => {
      const winnerIndex = Math.floor((finalRotation % 360) / (360 / items.length));
      const selectedWinner = items[winnerIndex];
      setWinner(selectedWinner);
      setSpinning(false);
      if (onComplete) onComplete(selectedWinner);
    }, 4000);
  };

  return (
    <div className="relative flex flex-col items-center gap-6">
      <div className="relative w-80 h-80">
        <div
          className="absolute inset-0 rounded-full border-8 border-yellow-400 bg-gradient-to-br from-purple-600 to-pink-600 shadow-2xl transition-transform duration-[4000ms] ease-out"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {items.map((item, i) => {
            const angle = (360 / items.length) * i;
            return (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 origin-left"
                style={{
                  transform: `rotate(${angle}deg) translateX(80px)`,
                  width: '80px',
                  marginTop: '-40px'
                }}
              >
                {type === 'users' ? (
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-white mx-auto mb-1 overflow-hidden border-4 border-white">
                      <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <p className="text-xs font-bold text-white drop-shadow-lg">{item.name}</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <Music className="w-12 h-12 text-white mx-auto mb-1" />
                    <p className="text-xs font-bold text-white drop-shadow-lg">{item.title}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-10">
          <div className="w-0 h-0 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-t-[40px] border-t-red-600"></div>
        </div>
      </div>

      {!winner && (
        <button
          onClick={spinWheel}
          disabled={spinning}
          className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-xl font-bold px-12 py-4 rounded-full hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 shadow-lg"
        >
          {spinning ? 'GIRANDO...' : '🎰 GIRA LA RUOTA!'}
        </button>
      )}

      {winner && (
        <div className="text-center animate-bounce">
          <h2 className="text-4xl font-bold text-yellow-400 mb-4">🎉 VINCITORE! 🎉</h2>
          {type === 'users' ? (
            <div>
              <img src={winner.photo} alt={winner.name} className="w-32 h-32 rounded-full mx-auto border-8 border-yellow-400 mb-2" />
              <p className="text-2xl font-bold">{winner.name}</p>
            </div>
          ) : (
            <div>
              <Music className="w-24 h-24 text-yellow-400 mx-auto mb-2" />
              <p className="text-2xl font-bold">{winner.title}</p>
              <p className="text-lg text-gray-600">{winner.artist}</p>
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
  const [libraryPreview, setLibraryPreview] = useState([]);
  const [libraryErrors, setLibraryErrors] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [roundMessage, setRoundMessage] = useState('');
  const [votesReceived, setVotesReceived] = useState(0);
  const fileInputRef = useRef(null);
  const votesChannelRef = useRef(null);
  const registeredOnceRef = useRef(false);
  const [backendMode, setBackendMode] = useState(isSupabaseConfigured ? 'supabase' : 'mock');
  const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
  const isSupabaseReady = isSupabaseConfigured;

  const registerUserSupabase = async (name, photo, silent = false) => {
    if (!supabase) return null;
    if (registeredOnceRef.current && currentUser?.id && !silent) {
      setView('waiting');
      return currentUser;
    }
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
    const payload = { ...currentRound, type: currentRound.type || 'poll', votingOpen: false, votes: roundWithVotes.votes, results };
    const { error } = await supabase
      .from('k_rounds')
      .update({ state: 'ended', payload })
      .eq('id', currentRound.id);
    if (error) console.error('Errore closeVoting', error);
    setRoundResults(results);
    setCurrentRound(null);
    setVotesReceived(0);
  };

  const voteSupabase = async (songId) => {
    if (!supabase || !currentUser || !currentRound?.id) return;
    const { error } = await supabase
      .from('k_votes')
      .insert({ round_id: currentRound.id, user_id: currentUser.id, song_id: String(songId) });
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
          setLibraryPreview(parsed.slice(0, 10));
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
        const user = await registerUserSupabase(parsed.name, parsed.photo, true);
        if (user) {
          registeredOnceRef.current = true;
          setCurrentUser(user);
        }
      } catch (err) {
        console.error('Errore nel registrare utente salvato', err);
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
    const votingActive = currentRound?.votingOpen;
    const isAdminView = view === 'admin' || view === 'display';
    if (votingActive && currentUser && !isAdminView && view !== 'voting') {
      setView('voting');
    }
    if ((!currentRound || !currentRound.votingOpen) && view === 'voting') {
      setView('waiting');
    }
  }, [currentRound, currentUser, view]);

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

  const handleSongFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const { songs, errors } = parseSongsFromCSV(text);

      setLibraryErrors(errors);
      if (songs.length > 0) {
        setSongLibrary(songs);
        setLibraryPreview(songs.slice(0, 10));
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
        }
        setImportMessage(`Caricati ${songs.length} brani dalla libreria CSV.`);
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
      setRoundResults(results);
      setCurrentRound(null);
      setVotesReceived(0);
      setRoundMessage('Votazione chiusa, risultati pronti.');
      setView('display');
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

  const handleStartRound = (category) => {
    if (category === 'poll') {
      handlePreparePoll();
      return;
    }
    setRoundMessage('Modalità extra non disponibili con il server socket in questa versione.');
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

  if (view === 'home') {
    const siteUrl = 'https://karaokeapp-francesco.netlify.app';

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <Mic className="w-20 h-20 mx-auto mb-4 text-purple-600" />
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Karaoke Night</h1>
            <p className="text-gray-600">Sistema Interattivo per Serate Musicali</p>
          </div>

          <div className="space-y-3 mb-6">
            <QrCode
              value={siteUrl}
              label="Accedi al sito"
              sublabel="Inquadra per aprire la webapp"
            />
            <QrCode
              value={WIFI_QR_VALUE}
              label="Wi‑Fi"
              sublabel="Inquadra per connetterti (WPA2)"
            />
          </div>

          <div className="space-y-4">
            <button
              onClick={() => (currentUser ? setView('waiting') : setView('join'))}
              className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-3 text-lg font-semibold"
            >
              <Users className="w-6 h-6" />
              {currentUser ? `Continua come ${currentUser.name}` : 'Entra come Partecipante'}
            </button>

            <button
              onClick={() => setView('admin')}
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
              Schermo Principale
            </button>
          </div>

          <div className="mt-8 text-center text-sm text-gray-500">
            <p>Utenti connessi: {users.length}</p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'join') {
    return <UserJoinView onJoin={handleUserJoin} onBack={() => setView('home')} />;
  }

  if (view === 'waiting') {
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
          <button
            onClick={() => setView('admin')}
            className="mt-2 text-gray-600 hover:text-gray-800 block mx-auto"
          >
            Vai al Pannello Organizzatore
          </button>
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
            <button
              onClick={() => setView('admin')}
              className="hover:text-gray-200"
            >
              Pannello Organizzatore
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'admin') {
    const categories = [
      { id: 'duet', name: 'Duetti', icon: Users },
      { id: 'wheel', name: 'Ruota della Fortuna', icon: Disc },
      { id: 'free_choice', name: 'Scelta Libera', icon: Music },
      { id: 'year', name: 'Categoria per Anno', icon: Calendar },
      { id: 'pass_mic', name: 'Passa il Microfono', icon: Mic }
    ];
    const pollPrepared = currentRound && currentRound.type === 'poll';

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 p-4">
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-3xl font-bold mb-6">Pannello Organizzatore</h2>

            <div className="mb-8 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-600">Utenti connessi: <span className="font-bold">{users.length}</span></p>
              <div className="flex items-center gap-4 text-sm text-gray-700 mt-1 flex-wrap">
                <span className="font-semibold">Voti ricevuti: {votesReceived}</span>
                <span>Libreria brani: {songLibrary.length}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {users.map(user => (
                  <div key={user.id} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border">
                    <img src={user.photo} alt={user.name} className="w-6 h-6 rounded-full" />
                    <span className="text-sm">{user.name}</span>
                    <button
                      onClick={() => handleRemoveUser(user.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-8 p-6 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm uppercase text-gray-500 font-semibold">Libreria brani</p>
                  <p className="text-2xl font-bold text-gray-800">{songLibrary.length} brani totali</p>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleSongFileChange}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
                  >
                    <Upload className="w-5 h-5" />
                    Carica CSV
                  </button>
                </div>
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

              <p className="text-sm font-semibold text-gray-700 mb-2 mt-4">Anteprima (prime 10 righe)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {libraryPreview.map(song => (
                  <div key={song.id} className="p-3 bg-white rounded-lg border border-gray-200">
                    <p className="font-bold">{song.title}</p>
                    <p className="text-sm text-gray-600">{song.artist}{song.year ? ` • ${song.year}` : ''}</p>
                  </div>
                ))}
                {libraryPreview.length === 0 && (
                  <div className="text-sm text-gray-500">Nessun brano disponibile.</div>
                )}
              </div>
            </div>

            <div className="mb-8 p-6 bg-purple-50 rounded-xl border border-purple-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-purple-900">Sondaggio Brani</h3>
                  <p className="text-sm text-gray-700">Prepara 10 brani casuali e gestisci apertura/chiusura.</p>
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={handlePreparePoll}
                  disabled={songLibrary.length < 10}
                  className="p-4 bg-white text-purple-900 rounded-lg border border-purple-200 hover:border-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prepara round (10 brani casuali)
                </button>
                <button
                  onClick={handleOpenVoting}
                  disabled={!pollPrepared || currentRound?.votingOpen}
                  className="p-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apri votazione
                </button>
                <button
                  onClick={handleCloseVoting}
                  disabled={!currentRound || !currentRound.votingOpen}
                  className="p-4 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Chiudi votazione
                </button>
              </div>

              <div className="flex items-center justify-between mt-4 text-sm text-gray-700">
                <span>Voti ricevuti: {votesReceived}</span>
                <button
                  onClick={handleResetRound}
                  className="flex items-center gap-2 text-purple-800 hover:text-purple-900"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Reset round
                </button>
              </div>
            </div>

            {currentRound && (
              <div className="mb-8 bg-white border border-gray-200 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Eye className="w-5 h-5 text-gray-600" />
                    Anteprima display
                  </h3>
                  <button
                    onClick={() => setView('display')}
                    className="text-sm text-purple-700 hover:text-purple-900"
                  >
                    Apri display a schermo
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
                    <p className="text-sm text-gray-600 mb-4">Votazione in corso (anteprima live).</p>
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

            {roundResults && (
              <div className="mb-8 bg-white border border-green-200 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-green-800 mb-4">Risultati ultimi round</h3>
                {roundResults.winner && (
                  <div className="mb-4">
                    <p className="text-sm uppercase text-gray-500">Vincitore</p>
                    <p className="text-2xl font-bold text-green-700">{roundResults.winner.title}</p>
                    <p className="text-sm text-gray-600">{roundResults.winner.artist}</p>
                  </div>
                )}
                {roundResults.stats && <ResultList stats={roundResults.stats} compact />}
                <button
                  onClick={() => setRoundResults(null)}
                  className="mt-4 text-sm text-gray-600 hover:text-gray-800"
                >
                  Nascondi risultati
                </button>
              </div>
            )}

            <h3 className="text-xl font-bold mb-4">Altre modalità di gioco</h3>
            <div className="grid grid-cols-2 gap-4">
              {categories.map(cat => {
                const IconComponent = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleStartRound(cat.id)}
                    className="p-6 bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all"
                  >
                    <IconComponent className="w-12 h-12 mx-auto mb-2" />
                    <p className="font-bold">{cat.name}</p>
                  </button>
                );
              })}
            </div>

            {currentRound && currentRound.type !== 'poll' && (
              <button
                onClick={handleEndRound}
                className="mt-6 w-full bg-red-600 text-white py-3 rounded-lg hover:bg-red-700"
              >
                Termina Round Corrente
              </button>
            )}
          </div>

          <button
            onClick={() => setView('home')}
            className="mt-4 text-white hover:text-gray-300 block mx-auto"
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
                {currentRound.type === 'poll' && '🗳️ Sondaggio Brani'}
                {currentRound.type === 'duet' && '🎭 Duetto'}
                {currentRound.type === 'wheel' && '🎰 Ruota della Fortuna'}
                {currentRound.type === 'free_choice' && '🎯 Scelta Libera'}
                {currentRound.type === 'year' && `📅 Brani dell'anno ${currentRound.year}`}
                {currentRound.type === 'pass_mic' && '🎤 Passa il Microfono'}
              </h2>

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

              {currentRound.type === 'poll' && !currentRound.votingOpen && currentRound.songs && (
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

              {currentRound.animation === 'wheel' && currentRound.type === 'duet' && (
                <WheelOfFortune
                  items={currentRound.users}
                  type="users"
                  onComplete={() => {}}
                />
              )}

              {currentRound.animation === 'wheel' && currentRound.type === 'wheel' && (
                <div className="text-center">
                  <WheelOfFortune
                    items={[currentRound.song]}
                    type="songs"
                    onComplete={() => {}}
                  />
                </div>
              )}

              {currentRound.type === 'free_choice' && currentRound.user && (
                <div className="text-center">
                  <WheelOfFortune
                    items={[currentRound.user]}
                    type="users"
                    onComplete={() => {}}
                  />
                  <p className="mt-8 text-xl text-gray-700">
                    {currentRound.user.name} può scegliere liberamente il brano da cantare!
                  </p>
                </div>
              )}

              {currentRound.type === 'pass_mic' && (
                <div className="text-center">
                  <div className="mb-8">
                    <Music className="w-24 h-24 mx-auto mb-4 text-purple-600" />
                    <p className="text-2xl font-bold mb-2">{currentRound.song.title}</p>
                    <p className="text-lg text-gray-600">{currentRound.song.artist}</p>
                  </div>
                  <WheelOfFortune
                    items={currentRound.participants}
                    type="users"
                    onComplete={() => {}}
                  />
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
                  <p className="text-3xl font-bold mb-2">{roundResults.winner.title}</p>
                  <p className="text-xl text-gray-600">{roundResults.winner.artist}</p>
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

  return null;
}
