import React, { useState, useEffect, useRef } from 'react';
import { Camera, Music, Users, Play, Trophy, Disc, Calendar, Mic } from 'lucide-react';

// ============================================================================
// SIMULAZIONE BACKEND (in produzione sostituire con Socket.io reale)
// ============================================================================

class MockBackend {
  constructor() {
    this.users = [];
    this.songs = this.generateMockSongs();
    this.rounds = [];
    this.votes = [];
    this.currentRound = null;
    this.listeners = [];
  }

  generateMockSongs() {
    const titles = [
      "Bohemian Rhapsody", "Sweet Child O' Mine", "Hotel California", 
      "Livin' On A Prayer", "Don't Stop Believin'", "Every Breath You Take",
      "Billie Jean", "Like a Prayer", "Wonderwall", "Mr. Brightside",
      "Take On Me", "Africa", "Sweet Caroline", "Dancing Queen",
      "Smells Like Teen Spirit", "Lose Yourself", "Rolling in the Deep",
      "Shape of You", "Uptown Funk", "Shake It Off", "Despacito",
      "Old Town Road", "Blinding Lights", "Someone Like You", "Halo"
    ];
    
    const artists = [
      "Queen", "Guns N' Roses", "Eagles", "Bon Jovi", "Journey",
      "The Police", "Michael Jackson", "Madonna", "Oasis", "The Killers",
      "a-ha", "Toto", "Neil Diamond", "ABBA", "Nirvana",
      "Eminem", "Adele", "Ed Sheeran", "Mark Ronson", "Taylor Swift",
      "Luis Fonsi", "Lil Nas X", "The Weeknd", "Adele", "Beyoncé"
    ];

    return titles.map((title, i) => ({
      id: i + 1,
      title,
      artist: artists[i],
      year: 1970 + Math.floor(Math.random() * 50)
    }));
  }

  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  emit(event, data) {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(data));
  }

  registerUser(name, photo) {
    const user = {
      id: Date.now(),
      name,
      photo,
      joinedAt: new Date()
    };
    this.users.push(user);
    this.emit('user:registered', user);
    return user;
  }

  startRound(category, params = {}) {
    let roundData;
    
    switch(category) {
      case 'poll':
        roundData = this.preparePoll();
        break;
      case 'duet':
        roundData = this.prepareDuet();
        break;
      case 'wheel':
        roundData = this.prepareWheel();
        break;
      case 'free_choice':
        roundData = this.prepareFreeChoice();
        break;
      case 'year':
        roundData = this.prepareYear(params.year);
        break;
      case 'pass_mic':
        roundData = this.preparePassMic();
        break;
      default:
        return;
    }

    this.currentRound = {
      id: Date.now(),
      category,
      ...roundData,
      votes: []
    };

    this.emit('round:started', this.currentRound);
  }

  preparePoll() {
    const selectedSongs = [...this.songs]
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);
    
    return {
      type: 'poll',
      songs: selectedSongs,
      votingOpen: true
    };
  }

  prepareDuet() {
    if (this.users.length < 2) {
      return { type: 'duet', error: 'Servono almeno 2 utenti' };
    }

    const commonVotes = this.findCommonVotes();
    
    let user1, user2, song;
    
    if (commonVotes.length > 0) {
      const match = commonVotes[0];
      user1 = this.users.find(u => u.id === match.user1Id);
      user2 = this.users.find(u => u.id === match.user2Id);
      song = this.songs.find(s => s.id === match.songId);
    } else {
      const shuffled = [...this.users].sort(() => Math.random() - 0.5);
      user1 = shuffled[0];
      user2 = shuffled[1];
      song = this.songs[Math.floor(Math.random() * this.songs.length)];
    }

    return {
      type: 'duet',
      users: [user1, user2],
      song,
      animation: 'wheel'
    };
  }

  prepareWheel() {
    const song = this.songs[Math.floor(Math.random() * this.songs.length)];
    return {
      type: 'wheel',
      song,
      animation: 'wheel'
    };
  }

  prepareFreeChoice() {
    if (this.users.length === 0) {
      return { type: 'free_choice', error: 'Nessun utente registrato' };
    }
    
    const user = this.users[Math.floor(Math.random() * this.users.length)];
    return {
      type: 'free_choice',
      user,
      animation: 'wheel'
    };
  }

  prepareYear(year = 1980) {
    const songsFromYear = this.songs.filter(s => s.year === year);
    const selectedSongs = songsFromYear.length > 0 
      ? songsFromYear.slice(0, 10)
      : this.songs.slice(0, 10);

    return {
      type: 'year',
      year,
      songs: selectedSongs,
      votingOpen: true
    };
  }

  preparePassMic() {
    if (this.users.length < 2) {
      return { type: 'pass_mic', error: 'Servono almeno 2 utenti' };
    }

    const song = this.songs[Math.floor(Math.random() * this.songs.length)];
    const shuffled = [...this.users].sort(() => Math.random() - 0.5);
    const participants = shuffled.slice(0, Math.min(3, this.users.length));

    return {
      type: 'pass_mic',
      song,
      participants,
      currentUserIndex: 0,
      animation: 'wheel'
    };
  }

  findCommonVotes() {
    const commonVotes = [];
    
    for (let i = 0; i < this.votes.length; i++) {
      for (let j = i + 1; j < this.votes.length; j++) {
        if (this.votes[i].songId === this.votes[j].songId) {
          commonVotes.push({
            user1Id: this.votes[i].userId,
            user2Id: this.votes[j].userId,
            songId: this.votes[i].songId
          });
        }
      }
    }
    
    return commonVotes;
  }

  vote(userId, songId) {
    if (!this.currentRound || !this.currentRound.votingOpen) return;

    const vote = { userId, songId, roundId: this.currentRound.id };
    this.votes.push(vote);
    this.currentRound.votes.push(vote);
    
    this.emit('vote:registered', vote);
  }

  endRound() {
    if (!this.currentRound) return;

    let results;
    
    if (this.currentRound.votingOpen) {
      results = this.calculatePollResults();
    } else {
      results = { winner: this.currentRound };
    }

    this.rounds.push({ ...this.currentRound, results });
    this.emit('round:ended', results);
    this.currentRound = null;
  }

  calculatePollResults() {
    const voteCounts = {};
    
    this.currentRound.votes.forEach(vote => {
      voteCounts[vote.songId] = (voteCounts[vote.songId] || 0) + 1;
    });

    const sorted = Object.entries(voteCounts)
      .map(([songId, count]) => ({ songId: parseInt(songId), count }))
      .sort((a, b) => b.count - a.count);

    const threshold = 3;
    const qualified = sorted.filter(s => s.count >= threshold);
    const winner = qualified.length > 0 ? qualified[0] : sorted[0];

    return {
      winner: this.songs.find(s => s.id === winner?.songId),
      stats: sorted.map(s => ({
        song: this.songs.find(song => song.id === s.songId),
        votes: s.count
      }))
    };
  }
}

const backend = new MockBackend();

// ============================================================================
// COMPONENTI UI
// ============================================================================

function PhotoCapture({ onCapture }) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [captured, setCaptured] = useState(false);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Errore accesso camera:', err);
      alert('Impossibile accedere alla camera. Per questa demo, useremo un\'immagine placeholder.');
      onCapture('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%236366f1" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="80" text-anchor="middle" dy=".3em" fill="white"%3E👤%3C/text%3E%3C/svg%3E');
      setCaptured(true);
    }
  };

  const capturePhoto = () => {
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
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
        <button
          onClick={startCamera}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto"
        >
          <Camera className="w-5 h-5" />
          Avvia Camera
        </button>
      ) : (
        <div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
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

  const handleVote = (song) => {
    setSelectedSong(song);
    onVote(song.id);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center">🎵 Vota il tuo brano preferito!</h2>
      <div className="grid grid-cols-1 gap-3">
        {songs.map(song => (
          <button
            key={song.id}
            onClick={() => handleVote(song)}
            disabled={selectedSong !== null}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              selectedSong?.id === song.id
                ? 'bg-green-500 text-white border-green-600 scale-105'
                : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
            } disabled:opacity-50`}
          >
            <div className="font-bold text-lg">{song.title}</div>
            <div className="text-sm opacity-75">{song.artist} • {song.year}</div>
          </button>
        ))}
      </div>
      {selectedSong && (
        <div className="mt-6 text-center text-green-600 font-bold">
          ✓ Voto registrato per "{selectedSong.title}"!
        </div>
      )}
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

  useEffect(() => {
    backend.on('user:registered', (user) => {
      setUsers(prev => [...prev, user]);
    });

    backend.on('round:started', (round) => {
      setCurrentRound(round);
      setRoundResults(null);
    });

    backend.on('round:ended', (results) => {
      setRoundResults(results);
      setCurrentRound(null);
    });
  }, []);

  useEffect(() => {
    if (currentRound && currentUser && view === 'waiting') {
      setView('voting');
    }
  }, [currentRound, currentUser, view]);

  const handleUserJoin = (name, photo) => {
    const user = backend.registerUser(name, photo);
    setCurrentUser(user);
    setView('waiting');
  };

  const handleStartRound = (category) => {
    backend.startRound(category);
    setView('display');
  };

  const handleVote = (songId) => {
    if (currentUser && currentRound) {
      backend.vote(currentUser.id, songId);
    }
  };

  const handleEndRound = () => {
    backend.endRound();
  };

  if (view === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <Mic className="w-20 h-20 mx-auto mb-4 text-purple-600" />
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Karaoke Night</h1>
            <p className="text-gray-600">Sistema Interattivo per Serate Musicali</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setView('join')}
              className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-3 text-lg font-semibold"
            >
              <Users className="w-6 h-6" />
              Entra come Partecipante
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

          <button
            onClick={() => setView('home')}
            className="mt-8 text-gray-600 hover:text-gray-800"
          >
            ← Torna alla Home
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
          <button
            onClick={() => setView('waiting')}
            className="mt-4 text-white hover:text-gray-200 block mx-auto"
          >
            ← Indietro
          </button>
        </div>
      </div>
    );
  }

  if (view === 'admin') {
    const categories = [
      { id: 'poll', name: 'Sondaggio Brani', icon: Trophy },
      { id: 'duet', name: 'Duetti', icon: Users },
      { id: 'wheel', name: 'Ruota della Fortuna', icon: Disc },
      { id: 'free_choice', name: 'Scelta Libera', icon: Music },
      { id: 'year', name: 'Categoria per Anno', icon: Calendar },
      { id: 'pass_mic', name: 'Passa il Microfono', icon: Mic }
    ];

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 p-4">
        <div className="max-w-4xl mx-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-3xl font-bold mb-6">Pannello Organizzatore</h2>

            <div className="mb-8 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-600">Utenti connessi: <span className="font-bold">{users.length}</span></p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {users.map(user => (
                  <div key={user.id} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full">
                    <img src={user.photo} alt={user.name} className="w-6 h-6 rounded-full" />
                    <span className="text-sm">{user.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-xl font-bold mb-4">Avvia Categoria di Gioco:</h3>
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

            {currentRound && (
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
                <div className="mt-8">
                  <h3 className="text-xl font-bold mb-4">Classifica Completa:</h3>
                  <div className="space-y-2">
                    {roundResults.stats.map((stat, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="text-left">
                          <p className="font-bold">{stat.song.title}</p>
                          <p className="text-sm text-gray-600">{stat.song.artist}</p>
                        </div>
                        <div className="text-2xl font-bold text-blue-600">{stat.votes} 🗳️</div>
                      </div>
                    ))}
                  </div>
                </div>
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