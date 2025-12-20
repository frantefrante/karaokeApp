import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 4000;

const generateMockSongs = () => {
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
};

let songs = generateMockSongs();
let users = [];
let currentRound = null;
let rounds = [];

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

const getRoundSnapshot = () => {
  if (!currentRound) return null;
  return {
    ...currentRound,
    songs: currentRound.songs ? [...currentRound.songs] : [],
    votes: currentRound.votes ? [...currentRound.votes] : []
  };
};

const calculatePollResults = (round = currentRound) => {
  if (!round) return { winner: null, stats: [] };

  const voteCounts = {};
  const songsList = round.songs || [];

  round.votes?.forEach(vote => {
    voteCounts[vote.songId] = (voteCounts[vote.songId] || 0) + 1;
  });

  songsList.forEach(song => {
    if (!voteCounts[song.id]) {
      voteCounts[song.id] = 0;
    }
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

const preparePollRound = () => {
  if (songs.length < 10) {
    return { error: 'Servono almeno 10 brani per creare il sondaggio.' };
  }

  const selectedSongs = [...songs]
    .sort(() => Math.random() - 0.5)
    .slice(0, 10);

  const noneOption = { id: -1, title: 'Nessuno', artist: '—', year: null };

  currentRound = {
    id: Date.now(),
    type: 'poll',
    category: 'poll',
    songs: [...selectedSongs, noneOption],
    votingOpen: false,
    state: 'prepared',
    votes: []
  };

  return getRoundSnapshot();
};

io.on('connection', (socket) => {
  socket.emit('state:init', {
    songs,
    users,
    currentRound: getRoundSnapshot()
  });

  socket.on('songs:replace', (newSongs) => {
    songs = Array.isArray(newSongs) ? newSongs : [];
    currentRound = null;
    rounds = [];
    io.emit('songs:updated', songs);
    io.emit('round:reset');
  });

  socket.on('user:register', (payload, ack) => {
    const user = {
      id: Date.now(),
      name: payload?.name || 'Ospite',
      photo: payload?.photo,
      joinedAt: new Date()
    };
    users.push(user);
    io.emit('user:registered', user);
    if (ack) ack(user);
  });

  socket.on('user:remove', (userId) => {
    users = users.filter(u => u.id !== userId);
    if (currentRound?.votes) {
      currentRound.votes = currentRound.votes.filter(v => v.userId !== userId);
    }
    io.emit('user:removed', userId);
    io.emit('round:updated', getRoundSnapshot());
  });

  socket.on('round:preparePoll', () => {
    const prepared = preparePollRound();
    if (prepared?.error) {
      socket.emit('round:error', prepared.error);
      return;
    }
    io.emit('round:updated', prepared);
  });

  socket.on('round:openVoting', () => {
    if (!currentRound || currentRound.type !== 'poll') return;
    currentRound.votingOpen = true;
    currentRound.state = 'voting';
    const snapshot = getRoundSnapshot();
    io.emit('round:started', snapshot);
    io.emit('round:updated', snapshot);
  });

  socket.on('round:vote', ({ userId, songId }) => {
    if (!currentRound || !currentRound.votingOpen) return;
    currentRound.votes.push({ userId, songId, roundId: currentRound.id });
    const snapshot = getRoundSnapshot();
    io.emit('round:updated', snapshot);
    io.emit('vote:registered', { userId, songId });
  });

  socket.on('round:close', () => {
    if (!currentRound || currentRound.type !== 'poll') return;
    const snapshot = getRoundSnapshot();
    const results = calculatePollResults(snapshot);
    rounds.push({ ...snapshot, results });
    io.emit('round:ended', results);
    currentRound = null;
    io.emit('round:updated', null);
  });

  socket.on('round:reset', () => {
    currentRound = null;
    rounds = [];
    io.emit('round:reset');
  });
});

httpServer.listen(PORT, () => {
  console.log(`Socket server listening on http://localhost:${PORT}`);
});
