import React, { useState, useMemo, useEffect, useRef } from 'react';
import ChordSheetJS from 'chordsheetjs';
import { Music, Plus, Minus, X, Youtube, Maximize2, Minimize2, Play, Pause, Download, RotateCcw } from 'lucide-react';

// Icona Spotify personalizzata (lucide-react non ha Spotify)
const SpotifyIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

export default function ChordSheetViewer({ song, onClose, onUpdateSong }) {
  const [transpose, setTranspose] = useState(0);
  const [fontSize, setFontSize] = useState(16);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const contentRef = useRef(null);
  const scrollIntervalRef = useRef(null);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && contentRef.current) {
      scrollIntervalRef.current = setInterval(() => {
        const container = contentRef.current.querySelector('.overflow-y-auto');
        if (container) {
          container.scrollBy({
            top: scrollSpeed,
            behavior: 'auto'
          });
        }
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

  // Parse e formatta lo spartito
  const formattedSheet = useMemo(() => {
    if (!song.chord_sheet) return null;

    try {
      const parser = new ChordSheetJS.ChordProParser();
      let chordSheet = parser.parse(song.chord_sheet);

      // Trasponi se necessario
      if (transpose !== 0) {
        chordSheet = chordSheet.transpose(transpose);
      }

      // USA HtmlDivFormatter per un rendering migliore
      const formatter = new ChordSheetJS.HtmlDivFormatter();
      return formatter.format(chordSheet);
    } catch (error) {
      console.error('Errore parsing ChordPro:', error);
      return null;
    }
  }, [song.chord_sheet, transpose]);

  const handleTransposeUp = () => {
    setTranspose(prev => (prev + 1) % 12);
  };

  const handleTransposeDown = () => {
    setTranspose(prev => (prev - 1 + 12) % 12);
  };

  const handleFontSizeUp = () => {
    setFontSize(prev => Math.min(prev + 2, 24));
  };

  const handleFontSizeDown = () => {
    setFontSize(prev => Math.max(prev - 2, 12));
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      contentRef.current?.requestFullscreen().catch(err => {
        console.error('Errore fullscreen:', err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Print/PDF
  const handlePrint = () => {
    window.print();
  };

  // Reset settings
  const handleReset = () => {
    setTranspose(0);
    setFontSize(16);
    setAutoScroll(false);
    setScrollSpeed(1);
  };

  // Funzione per cercare su Spotify
  const openSpotify = () => {
    const query = encodeURIComponent(`${song.title} ${song.artist}`);
    window.open(`https://open.spotify.com/search/${query}`, '_blank');
  };

  // Funzione per cercare su YouTube
  const openYouTube = () => {
    const query = encodeURIComponent(`${song.title} ${song.artist}`);
    window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
  };

  return (
    <div
      ref={contentRef}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-gray-300">
        {/* Header */}
        <div className="p-6 border-b border-gray-300">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-3xl font-bold text-gray-900 mb-1">{song.title}</h2>
              <p className="text-xl text-gray-700">{song.artist}</p>
              {song.year && <p className="text-sm text-gray-500">Anno: {song.year}</p>}
            </div>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Trasposizione */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-2 border border-gray-300">
              <button
                onClick={handleTransposeDown}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                title="Trasponi giù"
              >
                <Minus className="w-5 h-5 text-blue-600" />
              </button>
              <span className="text-gray-900 font-bold px-3 min-w-[80px] text-center">
                {transpose > 0 ? `+${transpose}` : transpose === 0 ? 'Originale' : transpose}
              </span>
              <button
                onClick={handleTransposeUp}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                title="Trasponi su"
              >
                <Plus className="w-5 h-5 text-blue-600" />
              </button>
            </div>

            {/* Dimensione font */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-2 border border-gray-300">
              <button
                onClick={handleFontSizeDown}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                title="Riduci testo"
              >
                <Minus className="w-5 h-5 text-gray-600" />
              </button>
              <span className="text-gray-900 font-bold px-3 min-w-[60px] text-center">
                {fontSize}px
              </span>
              <button
                onClick={handleFontSizeUp}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                title="Ingrandisci testo"
              >
                <Plus className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Auto-scroll */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all font-semibold ${
                autoScroll
                  ? 'bg-green-600 text-white shadow-lg'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title="Auto-scroll"
            >
              {autoScroll ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span className="text-sm hidden sm:inline">Scroll</span>
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors"
              title="Schermo intero"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>

            {/* Print */}
            <button
              onClick={handlePrint}
              className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors"
              title="Stampa spartito"
            >
              <Download className="w-5 h-5" />
            </button>

            {/* Reset */}
            <button
              onClick={handleReset}
              className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors"
              title="Reset impostazioni"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Playback links */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={openSpotify}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl transition-colors font-semibold"
                title="Apri su Spotify"
              >
                <SpotifyIcon className="w-5 h-5" />
                Spotify
              </button>
              <button
                onClick={openYouTube}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl transition-colors font-semibold"
                title="Apri su YouTube"
              >
                <Youtube className="w-5 h-5" />
                YouTube
              </button>
            </div>
          </div>

          {/* Scroll Speed Control (visible when autoscroll is active) */}
          {autoScroll && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Velocità scroll: {scrollSpeed.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={scrollSpeed}
                onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Lento</span>
                <span>Veloce</span>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {formattedSheet ? (
            <div
              className="chord-sheet-content"
              style={{ fontSize: `${fontSize}px` }}
              dangerouslySetInnerHTML={{ __html: formattedSheet }}
            />
          ) : song.chord_sheet ? (
            <div className="text-center text-gray-600 py-12">
              <Music className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>Errore nel parsing dello spartito</p>
              <pre className="mt-4 text-left text-xs bg-gray-100 p-4 rounded-lg overflow-auto max-h-60 border border-gray-300">
                {song.chord_sheet}
              </pre>
            </div>
          ) : (
            <div className="text-center text-gray-600 py-12">
              <Music className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-2">Nessuno spartito disponibile</p>
              <p className="text-sm">Importa un file ChordPro per visualizzare gli accordi</p>
            </div>
          )}
        </div>
      </div>

      {/* Stili per ChordSheet con HtmlDivFormatter */}
      <style>{`
        .chord-sheet-content {
          font-family: 'Courier New', 'Courier', monospace;
          line-height: 2;
          color: #1f2937;
          max-width: 100%;
          overflow-x: auto;
        }

        /* Metadati (titolo, artista) */
        .chord-sheet-content .title {
          font-size: 1.5em;
          font-weight: bold;
          color: #111827;
          margin-bottom: 0.5em;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .chord-sheet-content .subtitle,
        .chord-sheet-content .artist {
          font-size: 1.1em;
          color: #6b7280;
          margin-bottom: 0.3em;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        /* Accordi - colore viola prominente, posizionati SOPRA il testo */
        .chord-sheet-content .chord {
          color: #7c3aed;
          font-weight: 700;
          display: inline-block;
          font-size: 0.95em;
          min-width: 3ch;
          padding-right: 0.3ch;
          position: relative;
          top: -1.2em;
          text-shadow: 0 1px 2px rgba(124, 58, 237, 0.1);
        }

        /* Testo/Lyrics */
        .chord-sheet-content .lyrics {
          color: #111827;
          display: inline;
          line-height: 1.8;
        }

        /* Righe */
        .chord-sheet-content .row {
          display: block;
          margin-bottom: 0.5em;
          min-height: 1.5em;
        }

        /* Paragrafi/Sezioni */
        .chord-sheet-content .paragraph {
          margin-bottom: 1.8em;
          padding: 1.2em;
          background: linear-gradient(to right, #f9fafb 0%, #ffffff 100%);
          border-left: 4px solid #e5e7eb;
          border-radius: 0.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          page-break-inside: avoid;
          break-inside: avoid;
        }

        /* Etichette sezioni (Verse, Chorus, Bridge) */
        .chord-sheet-content .label {
          font-weight: 800;
          color: #dc2626;
          display: block;
          margin: 1.5em 0 0.8em 0;
          text-transform: uppercase;
          font-size: 0.85em;
          letter-spacing: 0.1em;
          padding-bottom: 0.3em;
          border-bottom: 2px solid #fca5a5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        /* Commenti */
        .chord-sheet-content .comment {
          color: #059669;
          font-style: italic;
          display: block;
          margin: 1em 0;
          padding: 0.6em 1em;
          background: #ecfdf5;
          border-left: 3px solid #10b981;
          border-radius: 0.375rem;
          font-size: 0.95em;
        }

        /* Colonne (se presenti) */
        .chord-sheet-content .column {
          display: inline-block;
          vertical-align: top;
          margin-right: 2em;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .chord-sheet-content {
            font-size: 14px;
            line-height: 1.6;
          }

          .chord-sheet-content .paragraph {
            padding: 0.8em;
            margin-bottom: 1.2em;
          }

          .chord-sheet-content .chord {
            top: -1em;
          }
        }

        /* Stampa */
        @media print {
          .chord-sheet-content {
            background: white !important;
            font-size: 11pt;
          }

          .chord-sheet-content .chord {
            color: #000 !important;
            text-shadow: none !important;
          }

          .chord-sheet-content .lyrics {
            color: #000 !important;
          }

          .chord-sheet-content .label {
            color: #000 !important;
            border-bottom-color: #999 !important;
          }

          .chord-sheet-content .paragraph {
            background: white !important;
            box-shadow: none !important;
            border-left-color: #ccc !important;
          }
        }
      `}</style>
    </div>
  );
}
