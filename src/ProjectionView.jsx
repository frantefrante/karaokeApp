import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import ChordSheetJS from 'chordsheetjs';
import { Play, Pause, Sun, Moon, Youtube, Mic, X } from 'lucide-react';

// Icona Spotify personalizzata
const SpotifyIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

export default function ProjectionView({ song, users = [] }) {
  const [transpose, setTranspose] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);

  // Carica la preferenza tema da localStorage, default = light mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('projectionViewDarkMode');
    return saved ? JSON.parse(saved) : false; // false = light mode default
  });

  const contentRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const textContainerRef = useRef(null);
  const [scaleFactor, setScaleFactor] = useState(1);

  // Salva la preferenza tema in localStorage quando cambia
  useEffect(() => {
    localStorage.setItem('projectionViewDarkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Auto-fit text to screen
  useLayoutEffect(() => {
    if (!textContainerRef.current) return;

    const fitToScreen = () => {
      const container = textContainerRef.current;
      const viewportWidth = window.innerWidth - 64; // padding
      const scrollWidth = container.scrollWidth;

      if (scrollWidth > viewportWidth) {
        const newScale = viewportWidth / scrollWidth;
        setScaleFactor(newScale);
      } else {
        setScaleFactor(1);
      }
    };

    fitToScreen();
    window.addEventListener('resize', fitToScreen);
    return () => window.removeEventListener('resize', fitToScreen);
  }, [song.chord_sheet, transpose, darkMode]);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && contentRef.current) {
      scrollIntervalRef.current = setInterval(() => {
        window.scrollBy({
          top: scrollSpeed,
          behavior: 'auto'
        });
      }, 50);
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    }

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, [autoScroll, scrollSpeed]);

  // Parse e formatta lo spartito con trasposizione - usa TextFormatter per preservare spazi
  const formattedSheet = useMemo(() => {
    if (!song.chord_sheet) return null;

    try {
      const parser = new ChordSheetJS.ChordProParser();
      let chordSheet = parser.parse(song.chord_sheet);

      // Applica trasposizione se necessaria
      if (transpose !== 0) {
        chordSheet = chordSheet.transpose(transpose);
      }

      // Usa TextFormatter invece di HtmlDivFormatter per preservare spazi e allineamento
      const formatter = new ChordSheetJS.TextFormatter();
      return formatter.format(chordSheet);
    } catch (error) {
      console.error('Errore parsing spartito:', error);
      return null;
    }
  }, [song.chord_sheet, transpose]);

  const openSpotify = () => {
    const query = encodeURIComponent(`${song.title} ${song.artist}`);
    window.open(`https://open.spotify.com/search/${query}`, '_blank');
  };

  const openYouTube = () => {
    const query = encodeURIComponent(`${song.title} ${song.artist}`);
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
  };

  const selectRandomUser = () => {
    if (users.length === 0) return;
    const randomUser = users[Math.floor(Math.random() * users.length)];
    setSelectedUser(randomUser);
  };

  // Auto-hide dell'utente selezionato dopo 5 secondi
  useEffect(() => {
    if (selectedUser) {
      const timer = setTimeout(() => {
        setSelectedUser(null);
      }, 5000); // 5 secondi

      return () => clearTimeout(timer);
    }
  }, [selectedUser]);

  return (
    <div
      ref={contentRef}
      className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-white text-black'}`}
    >
      {/* Toolbar fisso in alto */}
      <div className={`sticky top-0 z-50 ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'} border-b p-4`}>
        <div className="max-w-6xl mx-auto">
          {/* Prima riga: Info brano e controlli tema */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">{song.title}</h1>
              <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{song.artist}</p>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-3 rounded-lg transition-colors ${
                darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-yellow-400'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
              }`}
              title={darkMode ? 'Modalità chiara' : 'Modalità scura'}
            >
              {darkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
          </div>

          {/* Seconda riga: Controlli */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Trasposizione */}
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Tonalità:</span>
              <button
                onClick={() => setTranspose(Math.max(-11, transpose - 1))}
                className={`px-3 py-1 rounded-lg font-bold ${
                  darkMode
                    ? 'bg-gray-800 hover:bg-gray-700 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-black'
                }`}
              >
                -
              </button>
              <span className={`min-w-[3rem] text-center font-bold ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <button
                onClick={() => setTranspose(Math.min(11, transpose + 1))}
                className={`px-3 py-1 rounded-lg font-bold ${
                  darkMode
                    ? 'bg-gray-800 hover:bg-gray-700 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-black'
                }`}
              >
                +
              </button>
              {transpose !== 0 && (
                <button
                  onClick={() => setTranspose(0)}
                  className={`px-3 py-1 text-sm rounded-lg ${
                    darkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-400'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
                  }`}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Auto-scroll */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                  autoScroll
                    ? 'bg-green-600 text-white shadow-lg'
                    : darkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                {autoScroll ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>Scroll</span>
              </button>
              {autoScroll && (
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={scrollSpeed}
                  onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                  className="w-24"
                  title={`Velocità: ${scrollSpeed}x`}
                />
              )}
            </div>

            {/* Link esterni e Passa Microfono */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={selectRandomUser}
                disabled={users.length === 0}
                className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={users.length === 0 ? "Nessun partecipante" : "Passa il Microfono"}
              >
                <Mic className="w-5 h-5" />
                <span className="hidden sm:inline">Passa Mic</span>
              </button>
              <button
                onClick={openSpotify}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                title="Apri su Spotify"
              >
                <SpotifyIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Spotify</span>
              </button>
              <button
                onClick={openYouTube}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                title="Apri su YouTube"
              >
                <Youtube className="w-5 h-5" />
                <span className="hidden sm:inline">YouTube</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contenuto spartito */}
      <div className="max-w-full mx-auto p-8 overflow-x-auto">
        {formattedSheet ? (
          <pre
            ref={textContainerRef}
            className={`chord-sheet-text ${darkMode ? 'text-white' : 'text-gray-900'}`}
            style={{
              transform: `scale(${scaleFactor})`,
              transformOrigin: 'top left',
              fontFamily: "'Courier New', 'Courier', monospace",
              fontSize: '20px',
              lineHeight: '1.6',
              whiteSpace: 'pre',
              margin: 0,
              padding: 0,
            }}
          >
            {formattedSheet}
          </pre>
        ) : (
          <div className="text-center py-20">
            <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
              Spartito non disponibile per questo brano
            </p>
          </div>
        )}
      </div>

      {/* Overlay utente selezionato - posizionato a destra sotto toolbar */}
      {selectedUser && (
        <div className="fixed top-36 right-8 z-50 pointer-events-auto group">
          <div className="bg-pink-600/95 text-white rounded-2xl px-8 py-6 shadow-2xl border-4 border-white relative">
            {/* Pulsante chiudi - visibile solo al hover */}
            <button
              onClick={() => setSelectedUser(null)}
              className="absolute top-2 right-2 bg-white/20 hover:bg-white/30 rounded-full p-1 transition-all opacity-0 group-hover:opacity-100"
              title="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-4">
              <Mic className="w-12 h-12" />
              <div>
                <p className="text-lg font-semibold mb-2">🎤 È il turno di:</p>
                {selectedUser.photo && (
                  <img
                    src={selectedUser.photo}
                    alt={selectedUser.name}
                    className="w-20 h-20 rounded-full mx-auto border-3 border-white mb-3 shadow-xl"
                  />
                )}
                <p className="text-3xl font-bold">{selectedUser.name}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stili minimi per testo preformattato */}
      <style>{`
        .chord-sheet-text {
          display: block;
          width: fit-content;
        }
      `}</style>
    </div>
  );
}
