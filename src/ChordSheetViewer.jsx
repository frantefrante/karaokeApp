import React, { useState, useMemo } from 'react';
import ChordSheetJS from 'chordsheetjs';
import { Music, Plus, Minus, X, Youtube, ExternalLink } from 'lucide-react';

// Icona Spotify personalizzata (lucide-react non ha Spotify)
const SpotifyIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

export default function ChordSheetViewer({ song, onClose, onUpdateSong }) {
  const [transpose, setTranspose] = useState(0);
  const [fontSize, setFontSize] = useState(16);

  // Parse e formatta lo spartito
  const formattedSheet = useMemo(() => {
    if (!song.chord_sheet) return null;

    try {
      const parser = new ChordSheetJS.ChordProParser();
      const chordSheet = parser.parse(song.chord_sheet);

      // Trasponi se necessario
      let transposedSheet = chordSheet;
      if (transpose !== 0) {
        const transposer = new ChordSheetJS.ChordSheetSerializer();
        transposedSheet = chordSheet.transpose(transpose);
      }

      // Formatta in HTML
      const formatter = new ChordSheetJS.HtmlTableFormatter();
      return formatter.format(transposedSheet);
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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

          </div>
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

      {/* Stili per ChordSheet */}
      <style>{`
        .chord-sheet-content {
          font-family: 'Courier New', monospace;
          line-height: 1.8;
          color: #1f2937;
        }

        .chord-sheet-content table {
          border-collapse: collapse;
          width: 100%;
        }

        .chord-sheet-content .chord {
          color: #dc2626;
          font-weight: bold;
          font-size: 1.1em;
          padding-right: 0.5em;
        }

        .chord-sheet-content .lyrics {
          color: #1f2937;
        }

        .chord-sheet-content .comment {
          color: #6b7280;
          font-style: italic;
        }

        .chord-sheet-content .row {
          margin-bottom: 0.5em;
        }

        .chord-sheet-content .column {
          vertical-align: top;
          padding-right: 1em;
        }
      `}</style>
    </div>
  );
}
