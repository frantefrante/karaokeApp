import React, { useState } from 'react';
import { Search, Download, X, Eye, Plus, AlertCircle, CheckCircle, Music } from 'lucide-react';
import ChordSheetJS from 'chordsheetjs';

export default function SongImporter({ onClose, onImport }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [importText, setImportText] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [parsedPreview, setParsedPreview] = useState(null);
  const [songMetadata, setSongMetadata] = useState({
    title: '',
    artist: '',
    year: ''
  });
  const [step, setStep] = useState('search'); // 'search', 'paste', 'preview', 'metadata'
  const [importStatus, setImportStatus] = useState(null); // null, 'success', 'error'

  // Funzione per aprire la ricerca su Ultimate Guitar in una nuova tab
  const handleSearchUltimateGuitar = () => {
    if (!searchQuery.trim()) return;
    const query = encodeURIComponent(searchQuery);
    window.open(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${query}`, '_blank');
    setStep('paste');
  };

  // Funzione per aprire Chordie (sito con accordi ChordPro)
  const handleSearchChordie = () => {
    if (!searchQuery.trim()) return;
    const query = encodeURIComponent(searchQuery);
    window.open(`https://www.chordie.com/chord.pere/www.ultimate-guitar.com/?q=${query}`, '_blank');
    setStep('paste');
  };

  // Funzione per convertire testo in ChordPro
  const convertToChordPro = (text) => {
    try {
      // Prova prima a parsare come Ultimate Guitar format
      const ugParser = new ChordSheetJS.UltimateGuitarParser();
      let song = ugParser.parse(text);

      // Converti in ChordPro
      const formatter = new ChordSheetJS.ChordProFormatter();
      return formatter.format(song);
    } catch (ugError) {
      console.log('Non è formato UG, provo con ChordsOverWords:', ugError);

      try {
        // Se fallisce, prova con ChordsOverWords (formato più generico)
        const cowParser = new ChordSheetJS.ChordsOverWordsParser();
        let song = cowParser.parse(text);

        const formatter = new ChordSheetJS.ChordProFormatter();
        return formatter.format(song);
      } catch (cowError) {
        console.log('Non è formato ChordsOverWords, uso il testo così com\'è:', cowError);

        // Se anche questo fallisce, restituisci il testo originale
        // (potrebbe già essere ChordPro)
        return text;
      }
    }
  };

  // Funzione per gestire l'anteprima
  const handlePreview = () => {
    if (!importText.trim()) {
      alert('Inserisci del testo da importare');
      return;
    }

    try {
      const chordProText = convertToChordPro(importText);

      // Prova a parsare il risultato per vedere se è valido
      const parser = new ChordSheetJS.ChordProParser();
      const song = parser.parse(chordProText);

      // Estrai metadati se disponibili
      const title = song.title || '';
      const artist = song.artist || song.subtitle || '';

      setSongMetadata({
        title: title,
        artist: artist,
        year: ''
      });

      // Formatta per l'anteprima
      const formatter = new ChordSheetJS.HtmlDivFormatter();
      const htmlPreview = formatter.format(song);

      setParsedPreview({ html: htmlPreview, chordPro: chordProText });
      setStep('preview');
    } catch (error) {
      console.error('Errore nel parsing:', error);
      alert('Errore nel parsing del testo. Assicurati che il formato sia corretto.');
    }
  };

  // Funzione per procedere ai metadati
  const handleProceedToMetadata = () => {
    setStep('metadata');
  };

  // Funzione per importare il brano
  const handleImport = async () => {
    if (!songMetadata.title.trim() || !songMetadata.artist.trim()) {
      alert('Titolo e artista sono obbligatori');
      return;
    }

    try {
      await onImport(
        songMetadata.title,
        songMetadata.artist,
        songMetadata.year,
        parsedPreview.chordPro
      );

      setImportStatus('success');

      // Chiudi dopo 2 secondi
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Errore durante l\'importazione:', error);
      setImportStatus('error');
    }
  };

  // Reset del form
  const handleReset = () => {
    setStep('search');
    setSearchQuery('');
    setImportText('');
    setParsedPreview(null);
    setSongMetadata({ title: '', artist: '', year: '' });
    setImportStatus(null);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-gray-300">
        {/* Header */}
        <div className="p-6 border-b border-gray-300 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-1">
              Importa Brano da Internet
            </h2>
            <p className="text-sm text-gray-600">
              Cerca, copia e importa spartiti con accordi nella tua libreria
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            <X className="w-8 h-8" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Search */}
          {step === 'search' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Cerca un brano
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearchUltimateGuitar()}
                    placeholder="Es: Imagine Dragons - Believer"
                    className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 text-gray-900"
                  />
                  <button
                    onClick={handleSearchUltimateGuitar}
                    disabled={!searchQuery.trim()}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold flex items-center gap-2"
                  >
                    <Search className="w-5 h-5" />
                    Cerca
                  </button>
                </div>
              </div>

              {/* Istruzioni */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Come funziona
                </h3>
                <ol className="text-sm text-blue-800 space-y-2 ml-6 list-decimal">
                  <li>Cerca il brano che desideri importare</li>
                  <li>Si aprirà una nuova scheda con i risultati di Ultimate Guitar</li>
                  <li>Seleziona il brano e copia tutto il testo dello spartito (accordi + testo)</li>
                  <li>Torna qui e incolla il testo nel passaggio successivo</li>
                </ol>
              </div>

              {/* Link alternativi */}
              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-600 mb-3">Oppure cerca su altri siti:</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleSearchChordie}
                    disabled={!searchQuery.trim()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm"
                  >
                    Chordie.com
                  </button>
                  <button
                    onClick={() => setStep('paste')}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
                  >
                    Ho già il testo, voglio incollarlo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Paste */}
          {step === 'paste' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Incolla lo spartito</h3>
                <button
                  onClick={handleReset}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                >
                  ← Torna alla ricerca
                </button>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Suggerimento:</strong> Il sistema supporta diversi formati di spartiti.
                  Puoi incollare testo da Ultimate Guitar, Chordie, o qualsiasi formato con accordi sopra le parole.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Testo dello spartito (accordi + lyrics)
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Incolla qui il testo dello spartito con gli accordi..."
                  className="w-full h-96 px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 font-mono text-sm resize-none"
                  spellCheck={false}
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleReset}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors font-semibold"
                >
                  Annulla
                </button>
                <button
                  onClick={handlePreview}
                  disabled={!importText.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold flex items-center gap-2"
                >
                  <Eye className="w-5 h-5" />
                  Anteprima
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && parsedPreview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Anteprima spartito</h3>
                <button
                  onClick={() => setStep('paste')}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                >
                  ← Modifica testo
                </button>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm text-green-800">
                  <strong>✓ Spartito convertito con successo!</strong> Verifica che gli accordi e il testo siano corretti.
                </p>
              </div>

              {/* Preview */}
              <div className="border-2 border-gray-300 rounded-xl p-6 bg-gray-50 max-h-96 overflow-y-auto">
                <div
                  className="chord-sheet-preview"
                  dangerouslySetInnerHTML={{ __html: parsedPreview.html }}
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setStep('paste')}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors font-semibold"
                >
                  Modifica
                </button>
                <button
                  onClick={handleProceedToMetadata}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold flex items-center gap-2"
                >
                  Continua →
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Metadata */}
          {step === 'metadata' && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gray-900">Informazioni sul brano</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Titolo *
                  </label>
                  <input
                    type="text"
                    value={songMetadata.title}
                    onChange={(e) => setSongMetadata({ ...songMetadata, title: e.target.value })}
                    placeholder="Es: Believer"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Artista *
                  </label>
                  <input
                    type="text"
                    value={songMetadata.artist}
                    onChange={(e) => setSongMetadata({ ...songMetadata, artist: e.target.value })}
                    placeholder="Es: Imagine Dragons"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Anno (opzionale)
                  </label>
                  <input
                    type="number"
                    value={songMetadata.year}
                    onChange={(e) => setSongMetadata({ ...songMetadata, year: e.target.value })}
                    placeholder="Es: 2017"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {importStatus === 'success' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <p className="text-green-800 font-semibold">
                    Brano importato con successo!
                  </p>
                </div>
              )}

              {importStatus === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                  <p className="text-red-800 font-semibold">
                    Errore durante l'importazione. Riprova.
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setStep('preview')}
                  disabled={importStatus === 'success'}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                >
                  Indietro
                </button>
                <button
                  onClick={handleImport}
                  disabled={!songMetadata.title.trim() || !songMetadata.artist.trim() || importStatus === 'success'}
                  className="px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Importa nella Libreria
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stili per l'anteprima */}
        <style>{`
          .chord-sheet-preview {
            font-family: 'Courier New', 'Courier', monospace;
            line-height: 2;
            color: #1f2937;
          }

          .chord-sheet-preview .chord {
            color: #7c3aed;
            font-weight: 700;
            font-size: 0.95em;
            position: absolute;
            transform: translateY(-1.5em);
            white-space: nowrap;
          }

          .chord-sheet-preview .lyrics {
            color: #111827;
            display: inline;
          }

          .chord-sheet-preview .row {
            display: block;
            margin-bottom: 0.5em;
            min-height: 2.5em;
            position: relative;
            padding-top: 1.2em;
          }

          .chord-sheet-preview .paragraph {
            margin-bottom: 1.8em;
            padding: 1.2em;
            background: linear-gradient(to right, #f9fafb 0%, #ffffff 100%);
            border-left: 4px solid #e5e7eb;
            border-radius: 0.5rem;
          }

          .chord-sheet-preview .label {
            font-weight: 800;
            color: #dc2626;
            display: block;
            margin: 1.5em 0 0.8em 0;
            text-transform: uppercase;
            font-size: 0.85em;
            letter-spacing: 0.1em;
          }

          .chord-sheet-preview .comment {
            color: #059669;
            font-style: italic;
            display: block;
            margin: 1em 0;
            padding: 0.6em 1em;
            background: #ecfdf5;
            border-left: 3px solid #10b981;
            border-radius: 0.375rem;
          }
        `}</style>
      </div>
    </div>
  );
}
