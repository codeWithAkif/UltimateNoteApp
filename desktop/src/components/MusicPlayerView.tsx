import React, { useRef, useState, useEffect } from 'react';
import { 
  Play, Pause, SkipForward, SkipBack, Volume2, 
  Plus, Trash2, ListMusic, Shuffle, RotateCw, Music,
  Search, Download, Globe, Check, Loader, Cloud
} from 'lucide-react';
import { platform } from '../services/platform';

export interface Track {
  name: string;
  path: string; // Blob URL, media path or stream URL
  duration?: string;
  source?: 'local' | 'online' | 'youtube';
  onlineUrl?: string;
}

interface MusicPlayerViewProps {
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPlayTrack: (track: Track) => void;
  onNext: () => void;
  onPrev: () => void;
  onAddTracks: (files: FileList) => void;
  onRemoveTrack: (trackPath: string) => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  isRepeat: boolean;
  onToggleRepeat: () => void;
  onDownloadTrack: (title: string, streamUrl: string) => Promise<void>;
  missingTracks?: Record<string, boolean>;
  onDownloadMissingTrack?: (track: Track) => Promise<void>;
  onDownloadAllMissing?: () => Promise<void>;
  onAddYoutubeTrack?: (title: string, url: string) => Promise<void>;
}

interface OnlineResult {
  id: string;
  title: string;
  artist: string;
  stream_url: string;
  thumb: string;
  duration: string;
  downloads?: number;
}

export default function MusicPlayerView({
  tracks,
  currentTrack,
  isPlaying,
  onPlayPause,
  onPlayTrack,
  onNext,
  onPrev,
  onAddTracks,
  onRemoveTrack,
  currentTime,
  duration,
  onSeek,
  volume,
  onVolumeChange,
  isShuffle,
  onToggleShuffle,
  isRepeat,
  onToggleRepeat,
  onDownloadTrack,
  missingTracks = {},
  onDownloadMissingTrack,
  onDownloadAllMissing,
  onAddYoutubeTrack
}: MusicPlayerViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [activeSubTab, setActiveSubTab] = useState<'library' | 'discover'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [ytLoading, setYtLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<OnlineResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [downloadingPaths, setDownloadingPaths] = useState<Record<string, boolean>>({});

  const missingTracksList = tracks.filter(t => t.source === 'local' && missingTracks[t.path]);
  const hasMissing = missingTracksList.length > 0;

  const resultIdsString = searchResults.map(r => r.id).join(',');

  // Background metadata resolver to lazy-load real duration and artist for search results
  useEffect(() => {
    if (searchResults.length === 0) return;

    let active = true;
    
    const fetchMetadata = async (item: OnlineResult) => {
      try {
        const res = await fetch(`https://archive.org/metadata/${item.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        
        const files = data.files || [];
        const audioFile = files.find((f: any) => {
          const name = f.name.toLowerCase();
          return name.endsWith('.mp3') || 
                 name.endsWith('.m4a') || 
                 name.endsWith('.ogg') || 
                 name.endsWith('.flac') || 
                 name.endsWith('.wav');
        });
        
        if (audioFile) {
          let duration = item.duration;
          if (audioFile.length) {
            duration = String(audioFile.length);
          }
          
          let artist = item.artist;
          if (artist === 'Bilinmeyen Sanatçı') {
            artist = audioFile.creator || audioFile.artist || data.metadata?.creator || data.metadata?.artist || 'Bilinmeyen Sanatçı';
          }
          
          setSearchResults(prev => {
            const next = [...prev];
            const targetIdx = next.findIndex(r => r.id === item.id);
            if (targetIdx !== -1) {
              next[targetIdx] = {
                ...next[targetIdx],
                duration,
                artist
              };
            }
            return next;
          });
        }
      } catch (err) {
        console.error("Error fetching metadata for", item.id, err);
      }
    };

    const loadAll = async () => {
      for (let i = 0; i < searchResults.length; i++) {
        if (!active) break;
        const item = searchResults[i];
        if (item.duration === '0' || item.artist === 'Bilinmeyen Sanatçı') {
          await fetchMetadata(item);
          await new Promise(r => setTimeout(r, 120)); // Polite delay
        }
      }
    };

    loadAll();

    return () => {
      active = false;
    };
  }, [resultIdsString]);

  useEffect(() => {
    if (!iframeRef.current || currentTrack?.source !== 'youtube') return;
    const command = isPlaying ? 'playVideo' : 'pauseVideo';
    iframeRef.current.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: command, args: '' }),
      '*'
    );
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    const handleYoutubeMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'infoDelivery' && data.info) {
          if (data.info.playerState === 0 && isPlaying) {
            onNext();
          }
        }
      } catch (e) {}
    };
    window.addEventListener('message', handleYoutubeMessage);
    return () => window.removeEventListener('message', handleYoutubeMessage);
  }, [isPlaying, onNext]);

  const handleAddYoutube = async () => {
    if (!youtubeUrlInput) return;
    setYtLoading(true);
    try {
      let listId = '';
      try {
        const urlObj = new URL(youtubeUrlInput);
        listId = urlObj.searchParams.get('list') || '';
      } catch (e) {}

      if (listId && onAddYoutubeTrack) {
        const videos = await platform.resolveYoutubePlaylist(listId);
        if (videos && videos.length > 0) {
          for (const video of videos) {
            await onAddYoutubeTrack(video.title, `https://www.youtube.com/watch?v=${video.videoId}`);
          }
        } else {
          const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(youtubeUrlInput)}`);
          const data = await res.json();
          await onAddYoutubeTrack(data.title || 'YouTube Playlist', youtubeUrlInput);
        }
      } else if (onAddYoutubeTrack) {
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(youtubeUrlInput)}`);
        const data = await res.json();
        await onAddYoutubeTrack(data.title || 'YouTube Medya', youtubeUrlInput);
      }
      setYoutubeUrlInput('');
    } catch (err) {
      console.error("Failed to add YouTube link:", err);
      if (onAddYoutubeTrack) {
        await onAddYoutubeTrack('YouTube Medya', youtubeUrlInput);
      }
      setYoutubeUrlInput('');
    } finally {
      setYtLoading(false);
    }
  };

  const getYoutubeEmbedUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      const listId = urlObj.searchParams.get('list');
      if (listId) {
        return `https://www.youtube-nocookie.com/embed/videoseries?list=${listId}&autoplay=${isPlaying ? 1 : 0}&enablejsapi=1`;
      }
      
      let videoId = '';
      if (urlObj.hostname === 'youtu.be') {
        videoId = urlObj.pathname.slice(1);
      } else {
        videoId = urlObj.searchParams.get('v') || '';
      }
      
      if (videoId) {
        return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${isPlaying ? 1 : 0}&enablejsapi=1`;
      }
    } catch (e) {}
    return '';
  };

  const formatTime = (time: number | string) => {
    const numTime = typeof time === 'string' ? parseFloat(time) : time;
    if (isNaN(numTime)) return '0:00';
    const mins = Math.floor(numTime / 60);
    const secs = Math.floor(numTime % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddTracks(e.target.files);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const data = await platform.searchOnlineMusic(searchQuery.trim());
      
      if (Array.isArray(data)) {
        const mapped = data.map((item: any) => ({
          id: String(item.id),
          title: item.title,
          artist: item.user?.username || 'Bilinmeyen Sanatçı',
          stream_url: item.stream_url,
          thumb: item.thumb || '',
          duration: String(item.duration)
        }));
        setSearchResults(mapped);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleDownload = async (item: OnlineResult) => {
    setDownloadingIds(prev => ({ ...prev, [item.id]: true }));
    try {
      await onDownloadTrack(item.title, item.stream_url);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloadingIds(prev => ({ ...prev, [item.id]: false }));
    }
  };

  return (
    <div className="music-player-container animate-fade">
      {/* Header */}
      <div className="music-player-header">
        <div className="header-title">
          <ListMusic className="text-accent" size={24} />
          <h2>Müzik Kutusu</h2>
        </div>
        
        {/* Tab Selector */}
        <div className="music-tabs">
          <button 
            className={`music-tab-btn ${activeSubTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('library')}
          >
            Kütüphanem
          </button>
          <button 
            className={`music-tab-btn ${activeSubTab === 'discover' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('discover')}
          >
            Keşfet
          </button>
        </div>

        <button 
          className="btn-add-music"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={16} />
          <span>Yerel Müzik Ekle</span>
        </button>
        <input 
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept="audio/*"
          style={{ display: 'none' }}
        />
      </div>

      {/* Main Grid: Player Controls & Track List / Search */}
      <div className="music-player-grid">
        {/* Left Side: Playing Now Card */}
        <div className="now-playing-card">
          <div className="album-art-container" style={{ width: '100%', height: '180px', borderRadius: '12px', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {currentTrack && currentTrack.source === 'youtube' ? (
              <iframe
                ref={iframeRef}
                src={getYoutubeEmbedUrl(currentTrack.path)}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ width: '100%', height: '100%', borderRadius: '12px' }}
              />
            ) : (
              <div className={`album-art-disk ${isPlaying ? 'rotating' : ''}`}>
                <div className="disk-center">
                  <Music size={32} className="text-accent" />
                </div>
              </div>
            )}
          </div>

          <div className="track-info">
            <h3>{currentTrack ? currentTrack.name : 'Çalınan Şarkı Yok'}</h3>
            <p>{currentTrack ? (currentTrack.source === 'youtube' ? 'YouTube Akışı' : currentTrack.source === 'online' ? 'Çevrimiçi Akış' : 'Yerel Ses Dosyası') : 'Bir müzik seçin'}</p>
          </div>

          {/* Progress Bar */}
          <div className="playback-progress-container">
            <span className="time-lbl">{formatTime(currentTime)}</span>
            <input 
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="progress-slider"
            />
            <span className="time-lbl">{formatTime(duration)}</span>
          </div>

          {/* Controls */}
          <div className="player-controls">
            <button 
              className={`ctrl-btn secondary ${isShuffle ? 'active' : ''}`}
              onClick={onToggleShuffle}
              title="Karıştır"
            >
              <Shuffle size={18} />
            </button>

            <button 
              className="ctrl-btn"
              onClick={onPrev}
              disabled={tracks.length <= 1}
            >
              <SkipBack size={20} />
            </button>

            <button 
              className="ctrl-btn play-pause-btn"
              onClick={onPlayPause}
              disabled={tracks.length === 0}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>

            <button 
              className="ctrl-btn"
              onClick={onNext}
              disabled={tracks.length <= 1}
            >
              <SkipForward size={20} />
            </button>

            <button 
              className={`ctrl-btn secondary ${isRepeat ? 'active' : ''}`}
              onClick={onToggleRepeat}
              title="Tekrarla"
            >
              <RotateCw size={18} />
            </button>
          </div>

          {/* Volume Control */}
          <div className="volume-control">
            <Volume2 size={16} className="text-muted" />
            <input 
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="volume-slider"
            />
          </div>
        </div>

        {/* Right Side: Track List or Discover Panel */}
        <div className="track-list-card">
          {activeSubTab === 'library' ? (
            <>
              <div className="card-header" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3>Müzik Listesi ({tracks.length} Şarkı)</h3>
              </div>
              <div className="youtube-input-row" style={{
                display: 'flex',
                gap: '8px',
                padding: '0 16px 12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
              }}>
                <input
                  type="text"
                  placeholder="YouTube Video veya Playlist linki..."
                  value={youtubeUrlInput}
                  onChange={(e) => setYoutubeUrlInput(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    color: '#fff',
                    fontSize: '12px'
                  }}
                />
                <button
                  onClick={handleAddYoutube}
                  disabled={ytLoading}
                  style={{
                    background: 'var(--accent-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {ytLoading ? 'Ekleniyor...' : 'YouTube Ekle'}
                </button>
              </div>
              <div className="track-list-scroll">
                {hasMissing && onDownloadAllMissing && (
                  <div className="synced-sync-banner" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    margin: '0 12px 12px 12px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    fontSize: '12px',
                    color: '#e1e1e6'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cloud size={14} className="text-accent" style={{ color: 'var(--accent-color)' }} />
                      Bulutta indirilmeyi bekleyen {missingTracksList.length} şarkı var.
                    </span>
                    <button
                      className="btn-download-all"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: '#6366f1',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 'bold'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadAllMissing();
                      }}
                    >
                      Hepsini İndir
                    </button>
                  </div>
                )}
                {tracks.length === 0 ? (
                  <div className="empty-tracks-view">
                    <Music size={48} className="text-muted" />
                    <p>Kütüphaneniz henüz boş.</p>
                    <button 
                      className="btn-add-music-secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Yerel Müzik Yükle
                    </button>
                  </div>
                ) : (
                  <div className="tracks-list">
                    {tracks.map((track, idx) => {
                      const isCurrent = currentTrack?.path === track.path;
                      const isMissing = track.source === 'local' && missingTracks[track.path];
                      const isDownloading = downloadingPaths[track.path];

                      const handleTrackClick = async () => {
                        if (isMissing) {
                          if (isDownloading) return;
                          setDownloadingPaths(prev => ({ ...prev, [track.path]: true }));
                          try {
                            if (onDownloadMissingTrack) {
                              await onDownloadMissingTrack(track);
                              onPlayTrack(track);
                            }
                          } finally {
                            setDownloadingPaths(prev => ({ ...prev, [track.path]: false }));
                          }
                        } else {
                          onPlayTrack(track);
                        }
                      };

                      return (
                        <div 
                          key={track.path + idx}
                          className={`track-item ${isCurrent ? 'active' : ''} ${isMissing ? 'missing-track' : ''}`}
                          style={isMissing ? { opacity: 0.6 } : {}}
                          onClick={handleTrackClick}
                        >
                          <div className="track-icon-wrapper">
                            {isDownloading ? (
                              <Loader className="spinner" size={14} style={{ animation: 'spin 1s linear infinite' }} />
                            ) : isCurrent && isPlaying ? (
                              <div className="audio-playing-waves">
                                <span className="wave-bar"></span>
                                <span className="wave-bar"></span>
                                <span className="wave-bar"></span>
                              </div>
                            ) : isMissing ? (
                              <Cloud size={14} style={{ color: '#888' }} />
                            ) : track.source === 'youtube' ? (
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="#ef4444" style={{ display: 'inline-block' }}><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.518 3.5 12 3.5 12 3.5s-7.518 0-9.388.555A3.003 3.003 0 0 0 .5 6.163C0 8.037 0 12 0 12s0 3.963.5 5.837a3.003 3.003 0 0 0 2.11 2.108c1.87.556 9.388.556 9.388.556s7.518 0 9.388-.556a3.003 3.003 0 0 0 2.11-2.108c.5-1.874.5-5.837.5-5.837s0-3.963-.5-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                            ) : (
                              track.source === 'online' ? <Globe size={14} className="text-accent" /> : <Music size={14} />
                            )}
                          </div>
                          <div className="track-details">
                            <span className="track-name">
                              {track.name}
                              {isMissing && <span style={{ fontSize: '10px', color: '#888', marginLeft: '6px' }}>(Bulutta)</span>}
                              {track.source === 'youtube' && <span style={{ fontSize: '10px', color: '#ef4444', marginLeft: '6px' }}>(YouTube)</span>}
                            </span>
                          </div>
                          {isMissing && !isDownloading && (
                            <button
                              className="btn-delete-track"
                              style={{ marginRight: '6px', color: '#6366f1' }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setDownloadingPaths(prev => ({ ...prev, [track.path]: true }));
                                try {
                                  if (onDownloadMissingTrack) {
                                    await onDownloadMissingTrack(track);
                                  }
                                } finally {
                                  setDownloadingPaths(prev => ({ ...prev, [track.path]: false }));
                                }
                              }}
                              title="Buluttan Cihaza İndir"
                            >
                              <Download size={14} />
                            </button>
                          )}
                          <button 
                            className="btn-delete-track"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveTrack(track.path);
                            }}
                            title="Listeden Kaldır"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Discover/Search View */}
              <div className="card-header-search">
                <form onSubmit={handleSearch} className="search-form">
                  <input
                    type="text"
                    placeholder="Şarkıcı, şarkı veya tür ara..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                  <button type="submit" className="btn-search">
                    <Search size={16} />
                  </button>
                </form>
              </div>

              <div className="track-list-scroll">
                {searchLoading ? (
                  <div className="search-loading-container">
                    <Loader className="spinner text-accent" size={36} />
                    <p>Çevrimiçi arşiv aranıyor...</p>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="empty-tracks-view">
                    <Globe size={48} className="text-muted" />
                    <p>Arama kutusuna yazarak çevrimiçi telifsiz müzikleri bulun.</p>
                  </div>
                ) : (
                  <div className="search-results-list">
                    {searchResults.map((item) => {
                      const isDownloading = downloadingIds[item.id];
                      const alreadyAdded = tracks.some(t => t.name === item.title);
                      
                      return (
                        <div key={item.id} className="search-result-item">
                          <div className="result-img-wrapper">
                            {item.thumb ? (
                              <img src={item.thumb} alt={item.title} className="result-img" />
                            ) : (
                              <div className="result-img-fallback">
                                <Music size={14} />
                              </div>
                            )}
                          </div>
                          <div className="result-info">
                            <span className="result-title" title={item.title}>{item.title}</span>
                            <span className="result-artist">
                              {item.artist}
                              {item.downloads !== undefined && item.downloads > 0 && ` • ${item.downloads.toLocaleString('tr-TR')} indirme`}
                            </span>
                          </div>
                          <span className="result-duration">{formatTime(item.duration)}</span>
                          
                          <button
                            className={`btn-add-result ${alreadyAdded ? 'added' : ''}`}
                            onClick={() => !alreadyAdded && handleDownload(item)}
                            disabled={isDownloading || alreadyAdded}
                          >
                            {isDownloading ? (
                              <Loader className="spinner" size={14} />
                            ) : alreadyAdded ? (
                              <Check size={14} />
                            ) : (
                              <Download size={14} />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
