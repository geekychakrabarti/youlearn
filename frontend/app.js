/* ── State ── */
const state = {
  playlists: [],
  activePlaylistId: null,
  collapsedPlaylists: new Set(),
  videos: [],
  activeVideoId: null,
  activeVideo: null,
  clips: [],
  notes: [],
  activeTab: 'clips',
  searchQuery: '',
  activeDuration: '',
  activeTags: new Set(),
  libraryOrder: 'added_at',
  libraryOrderDir: 'desc',
  ytPlayer: null,
  ytReady: false,
  duration: 0,
  progressTimer: null,
  positionSaveTimer: null,     // saves resume position every 10s
  pendingClip: null,
  activePanel: 'library',       // 'library' | 'discover'
  discoverDuration: '',
  discoverChannel: null,
  discoverAllResults: [],
  discoverNextPageToken: null,
  discoverIsChannelScoped: false,
  discoverMode: 'all',
  discoverOrder: 'relevance',
  discoverOrderDir: 'desc',
  trustedTeachers: [],
  transcriptCache: {},            // session cache: youtube_id → transcript entries
  previewVideo: null,            // discover result being previewed (watch-only)
  previewDensity: [],
  previewChapters: [],
  previewSummaries: {},
  previewTranscript: [],         // raw transcript entries for within-video search
  tsearchMatches: [],            // current transcript search hit indices
  tsearchIdx: 0,                 // which match we're on
};

/* ── API helpers ── */
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
  },
};

/* ── Toast ── */
let toastTimer;
function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ── Status bar (pending clip indicator) ── */
function setStatus(msg, color = 'var(--text2)') {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color;
}

/* ── Modal ── */
function modal({ title, fields }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = `<p style="font-weight:600;margin-bottom:12px">${title}</p>` +
      fields.map(f => `
        <div style="margin-bottom:10px">
          <label>${f.label}</label>
          ${f.type === 'textarea'
            ? `<textarea id="mf-${f.key}" placeholder="${f.placeholder || ''}">${f.value || ''}</textarea>`
            : `<input id="mf-${f.key}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" value="${f.value || ''}" />`}
        </div>`).join('');
    overlay.style.display = 'flex';
    setTimeout(() => {
      const first = document.querySelector(`#mf-${fields[0].key}`);
      if (first) first.focus();
    }, 50);
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
    const onOk = () => {
      const vals = {};
      fields.forEach(f => { vals[f.key] = document.getElementById(`mf-${f.key}`).value.trim(); });
      overlay.style.display = 'none';
      cleanup();
      resolve(vals);
    };
    const onCancel = () => {
      overlay.style.display = 'none';
      cleanup();
      resolve(null);
    };
    const onKey = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') onOk(); };
    const cleanup = () => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

/* ── Format time ── */
function fmtTime(s) {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtDuration(s) {
  if (!s) return '';
  if (s < 60) return `${s}s`;        // reels / shorts — show seconds
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}

/* ── YouTube IFrame API ── */
window.onYouTubeIframeAPIReady = () => { state.ytReady = true; };

function loadYouTubeVideo(youtubeId, startAt = 0, autoplay = false) {
  // Remove local video and restore YT player
  if (_localVideoEl || document.getElementById('local-video')) {
    if (_localVideoEl) { try { _localVideoEl.pause(); _localVideoEl.src = ''; _localVideoEl.remove(); } catch(e) {} _localVideoEl = null; }
    document.getElementById('local-indicator')?.remove();
    state.ytPlayer = null; // was a shim — force real YT player re-init
    document.getElementById('yt-player-container').innerHTML = '';
  }
  // Re-show the YouTube iframe if it was hidden
  const iframe = document.querySelector('#yt-player-container iframe');
  if (iframe) iframe.style.display = '';

  if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function' &&
      document.querySelector('#yt-player-container iframe')) {
    // Real YT player with live iframe
    try { state.ytPlayer.pauseVideo(); } catch (e) {}
    state.ytPlayer.loadVideoById({ videoId: youtubeId, startSeconds: startAt });
    if (!autoplay) {
      setTimeout(() => { try { state.ytPlayer.pauseVideo(); } catch (e) {} }, 800);
    }
    return;
  }
  state.ytPlayer = null; // ensure clean init
  if (!state.ytReady) { setTimeout(() => loadYouTubeVideo(youtubeId, startAt, autoplay), 200); return; }
  // Ensure #yt-player div exists
  if (!document.getElementById('yt-player')) {
    const div = document.createElement('div');
    div.id = 'yt-player';
    document.getElementById('yt-player-container').appendChild(div);
  }
  state.ytPlayer = new YT.Player('yt-player', {
    videoId: youtubeId,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: autoplay ? 1 : 0 },
    events: {
      onReady: (e) => {
        state.duration = e.target.getDuration();
        document.getElementById('time-total').textContent = fmtTime(state.duration);
        startProgressTimer();
        if (startAt) e.target.seekTo(startAt, true);
        if (autoplay) e.target.playVideo();
      },
      onStateChange: (e) => {
        const playing = e.data === YT.PlayerState.PLAYING;
        document.getElementById('btn-playpause').textContent = playing ? '⏸' : '▶';
        if (playing) startProgressTimer(); else stopProgressTimer();
        // Update Discover preview button if in preview mode
        if (state.previewVideo) {
          const btn = document.querySelector('.discover-preview-btn.previewing-active');
          if (btn) btn.textContent = playing ? '⏸ Previewing' : '▶ Previewing';
        }
      },
    },
  });
}

function startProgressTimer() {
  stopProgressTimer();
  state.progressTimer = setInterval(() => { updateProgress(); checkSkipZone(); syncTranscriptScroll(); }, 500);
  // Save resume position every 10s (Library mode only)
  clearInterval(state.positionSaveTimer);
  state.positionSaveTimer = setInterval(() => {
    if (state.activeVideoId && state.ytPlayer?.getCurrentTime) {
      const t = state.ytPlayer.getCurrentTime();
      if (t > 5) {
        api.patch(`/api/videos/${state.activeVideoId}/position?position=${t}`, {}).catch(() => {});
        // Update in-memory state so resume hint re-renders
        state.videos = state.videos.map(v =>
          v.id === state.activeVideoId ? { ...v, last_position_seconds: t } : v
        );
        renderLibrary();
      }
    }
  }, 10000);
}
function stopProgressTimer() {
  clearInterval(state.progressTimer);
  clearInterval(state.positionSaveTimer);
}

function updateProgress() {
  if (!state.ytPlayer?.getCurrentTime) return;
  const t = state.ytPlayer.getCurrentTime();
  const dur = state.ytPlayer.getDuration() || state.duration || 1;
  document.getElementById('time-current').textContent = fmtTime(t);
  // Playhead — thin vertical line instead of filled bar
  const pct = (t / dur) * 100;
  document.getElementById('timeline-playhead').style.left = `${pct}%`;
  // Buffer — YouTube doesn't expose buffer directly; approximate via getVideoLoadedFraction
  const buffered = state.ytPlayer.getVideoLoadedFraction?.() || 0;
  document.getElementById('timeline-buffer').style.width = `${buffered * 100}%`;
}

/* ── Skip zone auto-jump ── */
function checkSkipZone() {
  if (!state.ytPlayer?.getCurrentTime) return;
  const t = state.ytPlayer.getCurrentTime();
  // Find a skip range we're currently inside
  const skipClip = state.clips.find(c =>
    c.type === 'skip' && c.end_seconds != null &&
    t >= c.timestamp_seconds + 0.5 && t < c.end_seconds
  );
  if (skipClip) {
    seekTo(skipClip.end_seconds);
    toast(`⏭ Skipped to ${fmtTime(skipClip.end_seconds)}`);
  }
}

function seekTo(t) {
  if (!state.ytPlayer?.seekTo) return;
  // Seek 0.3s before target so YouTube buffers ahead — reduces perceived lag
  const preseeked = Math.max(0, t - 0.3);
  state.ytPlayer.seekTo(preseeked, true);
  // After a short delay, seek to exact position
  setTimeout(() => {
    if (state.ytPlayer?.seekTo) {
      state.ytPlayer.seekTo(t, true);
      updateProgress();
    }
  }, 150);
  updateProgress();
}

/* ── Resolve skip end: next non-skip marker, or +60s ── */
function resolveSkipEnd(startSeconds) {
  const SKIP_JUMP = 60;
  const next = state.clips.find(c =>
    c.type !== 'skip' && c.timestamp_seconds > startSeconds
  );
  return next ? next.timestamp_seconds : startSeconds + SKIP_JUMP;
}

/* ── Two-tap clip logic ── */
function cancelPending() {
  state.pendingClip = null;
  setStatus('');
}

async function handleClipKey(type) {
  if (!state.ytPlayer || !state.activeVideoId) return;
  if (state.previewVideo) { toast('Marking disabled in preview mode'); return; }

  // Q = your question (text prompt, no range)
  if (type === 'question') {
    cancelPending();
    const t = state.ytPlayer.getCurrentTime();
    const vals = await modal({
      title: 'Your Question',
      fields: [{ key: 'body', label: 'What are you wondering?', type: 'textarea' }],
    });
    if (!vals?.body) return;
    await api.post('/api/notes', { video_id: state.activeVideoId, timestamp_seconds: t, body: vals.body, is_question: true });
    await api.post('/api/clips', { video_id: state.activeVideoId, timestamp_seconds: t, label: vals.body.slice(0,60), type: 'question' });
    await loadClipsAndNotes();
    toast(`❓ Question saved at ${fmtTime(t)}`);
    return;
  }

  // E = extract a question from the video (point marker, no prompt)
  if (type === 'extract') {
    cancelPending();
    const t = state.ytPlayer.getCurrentTime();
    await api.post('/api/clips', { video_id: state.activeVideoId, timestamp_seconds: t, label: 'video question', type: 'extract' });
    await loadClipsAndNotes();
    toast(`🎯 Video question marked at ${fmtTime(t)}`);
    return;
  }

  // S = skip: first tap sets start, second sets end
  if (type === 'skip') {
    if (!state.pendingClip) {
      const t = state.ytPlayer.getCurrentTime();
      state.pendingClip = { type: 'skip', startSeconds: t };
      setStatus(`⏭ Skip start: ${fmtTime(t)} — press S again to mark end`, 'var(--skip)');
      toast(`⏭ Skip start: ${fmtTime(t)} — press S to set end`);
    } else if (state.pendingClip.type === 'skip') {
      const end = state.ytPlayer.getCurrentTime();
      const start = state.pendingClip.startSeconds;
      cancelPending();
      if (end <= start) { toast('End must be after start — skip cancelled'); return; }
      await api.post('/api/clips', { video_id: state.activeVideoId, timestamp_seconds: start, end_seconds: end, label: 'skip', type: 'skip' });
      await loadClipsAndNotes();
      seekTo(end);
      toast(`⏭ Skip zone: ${fmtTime(start)} → ${fmtTime(end)}`);
    } else {
      // Different pending type — cancel it and start skip
      cancelPending();
      const t = state.ytPlayer.getCurrentTime();
      state.pendingClip = { type: 'skip', startSeconds: t };
      setStatus(`⏭ Skip start: ${fmtTime(t)} — press S again to mark end`, 'var(--skip)');
      toast(`⏭ Skip start: ${fmtTime(t)} — press S to set end`);
    }
    return;
  }

  // M = two-tap highlight range
  if (type === 'highlight') {
    if (!state.pendingClip) {
      // First tap — set start
      const t = state.ytPlayer.getCurrentTime();
      state.pendingClip = { type: 'highlight', startSeconds: t };
      setStatus(`⭐ Clip started at ${fmtTime(t)} — press M again to mark end`, 'var(--highlight)');
      toast(`⭐ Clip start: ${fmtTime(t)} — press M to set end`);
    } else {
      // Second tap — set end
      const end = state.ytPlayer.getCurrentTime();
      const start = state.pendingClip.startSeconds;
      cancelPending();
      if (end <= start) { toast('End must be after start — clip cancelled'); return; }
      const vals = await modal({
        title: 'Name this clip',
        fields: [{ key: 'label', label: 'Label (optional)', placeholder: 'e.g. Key concept explained' }],
      });
      if (vals === null) return;
      await api.post('/api/clips', {
        video_id: state.activeVideoId, timestamp_seconds: start,
        end_seconds: end, label: vals.label || 'highlight', type: 'highlight',
      });
      await loadClipsAndNotes();
      toast(`⭐ Clip saved: ${fmtTime(start)} → ${fmtTime(end)}`);
    }
    return;
  }

  // N = note (point, with text)
  if (type === 'note') {
    cancelPending();
    const t = state.ytPlayer.getCurrentTime();
    const vals = await modal({
      title: 'Add Note',
      fields: [{ key: 'body', label: 'Note', type: 'textarea' }],
    });
    if (!vals?.body) return;
    await api.post('/api/notes', { video_id: state.activeVideoId, timestamp_seconds: t, body: vals.body, is_question: false });
    await api.post('/api/clips', { video_id: state.activeVideoId, timestamp_seconds: t, label: vals.body.slice(0,60), type: 'note' });
    await loadClipsAndNotes();
    toast(`📝 Note saved at ${fmtTime(t)}`);
  }
}

/* ── J/K navigation — skip over skip zones ── */
// Clip navigation — index-based, no getCurrentTime() drift
let _lastClipNavTime = 0;
let _clipNavIdx = -1; // current position in navClips array; -1 = not yet set

function _getNavClips() {
  // J/K navigates all markers in time order: chapters, highlight clips, notes, questions
  const items = [];

  // Highlight clips (not skips)
  state.clips.filter(c => c.type === 'highlight').forEach(c => {
    items.push({ timestamp_seconds: c.timestamp_seconds, end_seconds: c.end_seconds });
  });

  // Notes and questions with timestamps
  (state.notes || []).forEach(n => {
    if (n.timestamp_seconds != null)
      items.push({ timestamp_seconds: n.timestamp_seconds });
  });

  // Chapters
  (state.previewChapters || []).forEach(c => {
    items.push({ timestamp_seconds: c.start_time });
  });

  // Sort by time, deduplicate within 0.5s
  items.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  return items.filter((item, i) =>
    i === 0 || item.timestamp_seconds - items[i-1].timestamp_seconds > 0.5
  );
}

function _blurYouTube() {
  const iframe = document.querySelector('#yt-player iframe');
  if (iframe) iframe.blur();
  document.getElementById('btn-playpause')?.focus();
}

function _instantPlayhead() {
  const ph = document.getElementById('timeline-playhead');
  if (!ph) return;
  ph.style.transition = 'none';
  setTimeout(() => { ph.style.transition = 'left 0.5s linear'; }, 300);
}

function _initNavIdx() {
  // Only called once when idx is -1.
  // For K (forward): start at -1 so first K goes to index 0.
  // For J (back): find nearest highlight at or before current time.
  // Caller handles the direction, so just set to the current position.
  const navClips = _getNavClips();
  if (!navClips.length) return;
  const t = state.ytPlayer?.getCurrentTime?.() ?? 0;
  // Find last highlight whose start <= current time
  let idx = -1;
  for (let i = 0; i < navClips.length; i++) {
    if (navClips[i].timestamp_seconds <= t + 1.0) idx = i;
    else break;
  }
  _clipNavIdx = idx; // -1 if before all clips
}

function prevClip() {
  const now = Date.now();
  if (now - _lastClipNavTime < 30) return;
  _lastClipNavTime = now;

  if (!state.clips.length || !state.ytPlayer) return;
  cancelPending();
  _blurYouTube();
  _instantPlayhead();

  const navClips = _getNavClips();
  if (!navClips.length) return;

  // Initialise index if not set
  if (_clipNavIdx < -1 || _clipNavIdx >= navClips.length) _initNavIdx();

  // If idx is -1 we're before all clips — J has nowhere to go
  if (_clipNavIdx === -1) return;

  const currentClip = navClips[_clipNavIdx];
  const t = state.ytPlayer.getCurrentTime();
  const RESTART_THRESHOLD = 2.0;

  // If >2s into the current clip, restart it
  if (currentClip && t - currentClip.timestamp_seconds > RESTART_THRESHOLD) {
    seekTo(currentClip.timestamp_seconds);
    return;
  }

  // Otherwise go to previous clip
  if (_clipNavIdx > 0) {
    _clipNavIdx--;
    seekTo(navClips[_clipNavIdx].timestamp_seconds);
  }
}

function nextClip() {
  const now = Date.now();
  if (now - _lastClipNavTime < 30) return;
  _lastClipNavTime = now;

  if (!state.clips.length || !state.ytPlayer) return;
  cancelPending();
  _blurYouTube();
  _instantPlayhead();

  const navClips = _getNavClips();
  if (!navClips.length) return;

  if (_clipNavIdx < -1 || _clipNavIdx >= navClips.length) _initNavIdx();

  if (_clipNavIdx < navClips.length - 1) {
    _clipNavIdx++;
    seekTo(navClips[_clipNavIdx].timestamp_seconds);
  }
}

function resetClipNavIdx() {
  _clipNavIdx = -1;
}

// Reset clip nav target on manual timeline click so J/K re-anchors to current position
document.addEventListener('mouseup', () => {
  if (_scrubbing) {
    resetClipNavIdx(); // re-anchor J/K to new scrub position
    document.getElementById('timeline-playhead').style.transition = 'left 0.5s linear';
  }
  _scrubbing = false;
});

/* ── Load data ── */
async function loadPlaylists() {
  state.playlists = await api.get('/api/playlists');
  renderLibrary();
}

async function loadVideos() {
  const params = new URLSearchParams();
  if (state.activePlaylistId) params.set('playlist_id', state.activePlaylistId);
  if (state.searchQuery) params.set('search', state.searchQuery);
  if (state.activeDuration) params.set('duration', state.activeDuration);
  if (state.libraryOrder && state.libraryOrder !== 'added_at') params.set('order', state.libraryOrder);
  if (state.libraryOrderDir) params.set('order_dir', state.libraryOrderDir);
  if (state.activeDuration === 'custom') {
    const min = document.getElementById('custom-dur-min').value;
    const max = document.getElementById('custom-dur-max').value;
    if (min) params.set('dur_min', min);
    if (max) params.set('dur_max', max);
  }
  // Note: activeTags filtering is client-side (semantic tags not in DB index)
  let videos = await api.get(`/api/videos?${params}`);
  // Apply semantic tag filter client-side — AND logic (video must match all active tags)
  if (state.activeTags.size > 0) {
    videos = videos.filter(v => {
      let tags = [];
      try {
        const raw = v.semantic_tags_json;
        if (Array.isArray(raw)) tags = raw;
        else if (typeof raw === 'string' && raw !== '[]') tags = JSON.parse(raw);
      } catch (e) {}
      const tagLowers = tags.map(t => t.toLowerCase());
      return [...state.activeTags].every(at => tagLowers.some(t => t.includes(at.toLowerCase())));
    });
  }
  state.videos = videos;
  renderLibrary();
  loadTopTags();
}

async function loadTopTags() {
  // Build semantic tag cloud from all videos in library
  const tagCounts = {};
  state.videos.forEach(v => {
    let tags = [];
    try {
      const raw = v.semantic_tags_json;
      if (Array.isArray(raw)) tags = raw;
      else if (typeof raw === 'string' && raw !== '[]') tags = JSON.parse(raw);
    } catch (e) {}
    tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  });
  const container = document.getElementById('tag-chips');
  container.innerHTML = '';

  // Show active tag chips with individual ✕ per tag
  if (state.activeTags.size > 0) {
    state.activeTags.forEach(tag => {
      const clearChip = document.createElement('span');
      clearChip.className = 'tag-chip active tag-chip-clear';
      clearChip.innerHTML = `${tag} <span class="tag-chip-x">✕</span>`;
      clearChip.title = 'Remove tag filter';
      clearChip.onclick = () => { state.activeTags.delete(tag); loadVideos(); };
      container.appendChild(clearChip);
    });
    if (state.activeTags.size > 1) {
      const clearAll = document.createElement('span');
      clearAll.className = 'tag-chip tag-chip-clear-all';
      clearAll.textContent = 'Clear all';
      clearAll.onclick = () => { state.activeTags.clear(); loadVideos(); };
      container.appendChild(clearAll);
    }
  }

  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  sorted.forEach(([tag, count]) => {
    if (state.activeTags.has(tag)) return; // already shown as active chip above
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    chip.title = `${count} video${count !== 1 ? 's' : ''}`;
    chip.onclick = () => { state.activeTags.add(tag); loadVideos(); };
    container.appendChild(chip);
  });
  // Fetch semantic tags for any videos that don't have them yet
  const untagged = state.videos.filter(v => !v.semantic_tags_json || v.semantic_tags_json === '[]');
  if (untagged.length) {
    let anyGenerated = false;
    await Promise.all(untagged.map(async v => {
      try {
        const result = await api.get(`/api/videos/semantic-tags?youtube_id=${v.youtube_id}`);
        if (result.available && result.tags?.length) {
          // Update in-memory video with new tags
          const idx = state.videos.findIndex(sv => sv.youtube_id === v.youtube_id);
          if (idx >= 0) {
            state.videos[idx].semantic_tags_json = result.tags;
            state.videos[idx].learning_type = result.learning_type;
            anyGenerated = true;
          }
        }
      } catch (e) {}
    }));
    if (anyGenerated) {
      // Re-render library cards and rebuild tag cloud with new tags
      renderLibrary();
      // Recurse once to rebuild cloud with updated tags
      await loadTopTags();
      return;
    }
  }
}

async function loadClipsAndNotes() {
  if (!state.activeVideoId) return;
  [state.clips, state.notes] = await Promise.all([
    api.get(`/api/clips?video_id=${state.activeVideoId}`),
    api.get(`/api/notes?video_id=${state.activeVideoId}`),
  ]);
  resetClipNavIdx(); // clips changed — re-anchor J/K
  renderNotesPanel();
  renderTimelineMarkers();
}

/* ── Render library ── */
function renderLibrary() {
  const container = document.getElementById('playlist-list');
  container.innerHTML = '';
  if (!state.playlists.length) {
    container.innerHTML = '<p style="padding:16px;color:var(--text2);font-size:12px">No playlists yet. Click + to create one.</p>';
    return;
  }
  state.playlists.forEach(pl => {
    const isCollapsed = state.collapsedPlaylists?.has(pl.id);
    const playlistVideos = state.videos.filter(v => v.playlist_id === pl.id);
    const isSearchActive = !!state.searchQuery;
    const displayCount = isSearchActive ? playlistVideos.length : (pl.video_count || 0);
    const countLabel = isSearchActive
      ? `${displayCount} match${displayCount !== 1 ? 'es' : ''}`
      : `${displayCount} video${displayCount !== 1 ? 's' : ''}`;
    const section = document.createElement('div');
    section.className = 'playlist-section';
    const header = document.createElement('div');
    header.className = 'playlist-header' + (state.activePlaylistId === pl.id ? ' active' : '');
    header.innerHTML = `
      <button class="pl-collapse-btn" title="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</button>
      <div class="playlist-header-info">
        <div class="playlist-name">${pl.name}</div>
        <div class="playlist-meta">${countLabel}${pl.topic ? ' · ' + pl.topic : ''}</div>
      </div>
      <div class="playlist-actions">
        <button class="pl-add-btn" title="Add video">+ Add</button>
        <button class="pl-rename-btn" title="Rename playlist">✎</button>
        <button class="pl-del-btn" title="Delete playlist">🗑</button>
      </div>`;

    // Collapse toggle
    header.querySelector('.pl-collapse-btn').onclick = (e) => {
      e.stopPropagation();
      if (state.collapsedPlaylists.has(pl.id)) state.collapsedPlaylists.delete(pl.id);
      else state.collapsedPlaylists.add(pl.id);
      renderLibrary();
    };

    // Rename via button — shows inline input
    header.querySelector('.pl-rename-btn').onclick = (e) => {
      e.stopPropagation();
      const nameEl = header.querySelector('.playlist-name');
      const original = pl.name;

      // Replace name div with a real input element
      const input = document.createElement('input');
      input.type = 'text';
      input.value = original;
      input.className = 'playlist-rename-input';
      input.onclick = (ev) => ev.stopPropagation();
      input.onkeydown = (ev) => ev.stopPropagation(); // prevent global keybindings
      nameEl.replaceWith(input);
      input.select();

      const finish = async (save) => {
        const newName = input.value.trim();
        const nameDiv = document.createElement('div');
        nameDiv.className = 'playlist-name';
        nameDiv.textContent = save && newName ? newName : original;
        input.replaceWith(nameDiv);
        if (save && newName && newName !== original) {
          await api.patch(`/api/playlists/${pl.id}`, { name: newName });
          await loadPlaylists();
        }
      };

      input.onblur = () => finish(false);
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); input.onblur = null; finish(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); input.onblur = null; finish(false); }
      };
      input.focus();
    };

    header.querySelector('.pl-add-btn').onclick = (e) => { e.stopPropagation(); addVideoToPlaylist(pl.id); };
    header.querySelector('.pl-del-btn').onclick = (e) => { e.stopPropagation(); deletePlaylist(pl.id); };
    header.onclick = async (e) => {
      // Don't toggle if user is editing the name
      if (header.querySelector('.playlist-name[contenteditable="true"]')) return;
      const wasActive = state.activePlaylistId === pl.id;
      state.activePlaylistId = wasActive ? null : pl.id;
      // Expand on open, keep collapsed state on close
      if (!wasActive) state.collapsedPlaylists.delete(pl.id);
      await loadVideos();
      if (!wasActive && pl.last_active_video_id) {
        const lastVideo = state.videos.find(v => v.id === pl.last_active_video_id);
        if (lastVideo) openVideo(lastVideo);
      }
    };
    section.appendChild(header);

    // Show video list when: search active (always show matches) OR playlist active/all visible AND not collapsed
    const showVideos = isSearchActive
      ? playlistVideos.length > 0   // search: show only playlists with matches, skip empty ones
      : (!isCollapsed && (state.activePlaylistId === pl.id || !state.activePlaylistId));

    if (showVideos) {
      const vlist = document.createElement('div');
      vlist.className = 'video-list';
      playlistVideos.forEach(v => {
        const item = document.createElement('div');
        item.className = 'video-item' + (state.activeVideoId === v.id ? ' active' : '');
        const meta = [fmtDuration(v.duration_seconds), v.channel].filter(Boolean).join(' · ');
        const isLastActive = pl.last_active_video_id === v.id;
        const resumeHint = isLastActive && v.last_position_seconds > 5
          ? `<span class="resume-hint">▶ ${fmtTime(v.last_position_seconds)}</span>`
          : '';
        const dlStatus = v.download_status || 'none';
        const dlBadge = dlStatus === 'complete'
          ? `<span class="dl-badge dl-complete" title="Downloaded locally">●</span>`
          : dlStatus.startsWith('downloading')
            ? `<span class="dl-badge dl-progress" title="Downloading…">${dlStatus.includes(':') ? dlStatus.split(':')[1] + '%' : '…'}</span>`
            : dlStatus === 'queued'
              ? `<span class="dl-badge dl-queued" title="Queued for download">⬇</span>`
              : '';
        // Semantic tags + learning type
        let semanticTags = [];
        try {
          const raw = v.semantic_tags_json;
          if (Array.isArray(raw)) semanticTags = raw;
          else if (typeof raw === 'string' && raw !== '[]') semanticTags = JSON.parse(raw);
        } catch (e) {}
        const learningType = v.learning_type;
        const typeLabel = {
          project_tutorial: 'project', concept_explainer: 'explainer',
          tips_tricks: 'tips', comparison: 'comparison', showcase: 'showcase'
        }[learningType] || '';
        // Surface active/matching tags first
        let displayTags = semanticTags;
        if (state.activeTags.size > 0) {
          // Put active tags first
          const active = semanticTags.filter(t => state.activeTags.has(t));
          const rest = semanticTags.filter(t => !state.activeTags.has(t));
          displayTags = [...active, ...rest];
        } else if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const matchIdx = semanticTags.findIndex(t => t.toLowerCase().includes(q));
          if (matchIdx > 0) {
            displayTags = [semanticTags[matchIdx], ...semanticTags.filter((_, i) => i !== matchIdx)];
          }
        }
        const tagHtml = displayTags.slice(0, 3).map(t => {
          const isActive = state.activeTags.has(t);
          const isMatch = !isActive && state.searchQuery && t.toLowerCase().includes(state.searchQuery.toLowerCase());
          return `<span class="semantic-tag${isActive ? ' tag-active' : isMatch ? ' tag-match' : ''}" data-tag="${t}">${t}</span>`;
        }).join('');
        const typeBadge = typeLabel ? `<span class="learning-type-badge lt-${learningType}">${typeLabel}</span>` : '';

        item.innerHTML = `
          <img class="video-thumb" src="${v.thumbnail}" alt="" loading="lazy" />
          <div class="video-info">
            <div class="video-item-title">${v.title || 'Loading…'}</div>
            <div class="video-item-meta">${meta}${resumeHint} ${dlBadge}</div>
            ${tagHtml || typeBadge ? `<div class="video-item-tags">${tagHtml}${typeBadge}</div>` : ''}
          </div>
          <button class="video-item-del" title="Remove">✕</button>`;
        item.querySelector('.video-item-del').onclick = (e) => { e.stopPropagation(); deleteVideo(v.id); };
        // Semantic tag clicks — toggle tag in multi-select filter
        item.querySelectorAll('.semantic-tag').forEach(chip => {
          chip.onclick = (e) => {
            e.stopPropagation();
            const tag = chip.dataset.tag;
            if (state.activeTags.has(tag)) state.activeTags.delete(tag);
            else state.activeTags.add(tag);
            loadVideos();
          };
        });
        item.onclick = () => openVideo(v);
        vlist.appendChild(item);
      });
      const addBtn = document.createElement('div');
      addBtn.className = 'add-video-btn';
      addBtn.innerHTML = '＋ Add video';
      addBtn.onclick = () => addVideoToPlaylist(pl.id);
      vlist.appendChild(addBtn);
      section.appendChild(vlist);
    }
    // When search active and no matches, skip rendering this playlist entirely
    if (isSearchActive && displayCount === 0) return;

    container.appendChild(section);
  });
}

/* ── Open video ── */
async function openVideo(video) {
  cancelPending();
  // Clear any leftover preview state when switching from Discover to Library
  if (state.previewVideo) {
    try { state.ytPlayer?.pauseVideo(); } catch (e) {}
    state.previewVideo = null;
    document.getElementById('preview-actions').style.display = 'none';
    document.getElementById('normal-title-row').style.display = 'flex';
    document.querySelectorAll('.tab-btn:not([data-tab="chapters"])').forEach(b => b.style.display = '');
    document.querySelectorAll('.mark-btn').forEach(b => { b.disabled = false; });
    applyDiscoverFilters(); // reset Discover cards — clears "▶ Previewing" button
  }
  state.activeVideoId = video.id;
  state.activeVideo = video;
  // Reset detect questions button state for new video
  const detectBtn = document.getElementById('btn-detect-questions');
  if (detectBtn) { detectBtn.dataset.state = ''; detectBtn.textContent = '✦ Detect questions in transcript'; detectBtn.disabled = false; }
  updateDetectQuestionsBar();
  if (!state.activePlaylistId && video.playlist_id) {
    state.activePlaylistId = video.playlist_id;
  }
  state.previewChapters = [];
  state.previewTranscript = [];
  state.tsearchMatches = [];
  state.tsearchIdx = 0;

  // Always start on All tab when opening a Library video
  switchTab('all');

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('player-wrap').style.display = 'flex';
  document.getElementById('video-title-text').textContent = video.title || 'Loading…';
  document.getElementById('notes-video-title').textContent = video.title || 'Video';
  document.getElementById('export-btns').style.display = 'flex';
  renderLibraryActionBar(video);
  // Tags hidden — will be replaced with Ollama semantic concept tags in Sprint 5
  document.getElementById('video-tags-inline').innerHTML = '';

  // Show Chapters tab
  document.getElementById('tab-btn-chapters').style.display = '';
  document.getElementById('transcript-search-section').style.display = 'block';
  document.getElementById('tsearch-input').value = '';
  document.getElementById('tsearch-clear').style.display = 'none';
  document.getElementById('tsearch-status').textContent = '';

  // Remember this as the last active video for its playlist
  if (video.playlist_id) {
    api.patch(`/api/playlists/${video.playlist_id}/last-video?video_id=${video.id}`, {}).catch(() => {});
    // Update in-memory playlists so resume indicator re-renders immediately
    state.playlists = state.playlists.map(p =>
      p.id === video.playlist_id ? { ...p, last_active_video_id: video.id } : p
    );
  }

  // Resume from saved position (skip if within first 5s — treat as start)
  const resumeAt = video.last_position_seconds > 5 ? video.last_position_seconds : 0;

  // Check for local file — use native player if available, YouTube as fallback
  const localUrl = await getLocalVideoUrl(video.id);
  if (localUrl) {
    // Verify file actually exists before loading — fallback to YouTube if missing
    try {
      const check = await fetch(localUrl, { headers: { Range: 'bytes=0-0' } });
      if (check.ok || check.status === 206) {
        loadLocalVideo(localUrl, resumeAt, video.id);
      } else {
        loadYouTubeVideo(video.youtube_id, resumeAt);
        startDownloadPolling();
      }
    } catch (e) {
      loadYouTubeVideo(video.youtube_id, resumeAt);
      startDownloadPolling();
    }
  } else {
    loadYouTubeVideo(video.youtube_id, resumeAt);
    // Start polling in case a download is in progress
    startDownloadPolling();
  }
  startProgressTimer();
  loadClipsAndNotes();
  renderLibrary();

  // Fetch chapters + transcript — use session cache if available
  const ytId = video.youtube_id;
  const cached = state.transcriptCache[ytId];
  const [chapters, transcriptData] = await Promise.all([
    api.get(`/api/videos/chapters?youtube_id=${ytId}`).catch(() => []),
    cached
      ? Promise.resolve(cached)
      : api.get(`/api/videos/transcript_raw?youtube_id=${ytId}`).catch(() => []),
  ]);
  if (transcriptData.length && !cached) {
    state.transcriptCache[ytId] = transcriptData;
  }
  state.previewChapters = chapters;
  state.previewTranscript = transcriptData;
  renderChaptersList();
  renderFullTranscript();
  renderTimelineMarkers();
  renderAllList(); // re-render now that chapters are available

  // Fetch Ollama summaries if available
  if (chapters.length) {
    const placeholders = {};
    chapters.forEach((_, i) => { placeholders[i] = null; });
    renderChaptersList(placeholders);
    api.get(`/api/videos/summaries?youtube_id=${video.youtube_id}`)
      .then(result => {
        if (result.available && result.summaries) {
          const summaryMap = {};
          result.summaries.forEach(s => { summaryMap[s.chapter_index] = s; });
          state.previewSummaries = summaryMap;
          renderChaptersList(summaryMap);
        } else {
          renderChaptersList();
        }
      })
      .catch(() => renderChaptersList());
  }
}

/* ── Timeline markers — ranges + points ── */
function renderTimelineMarkers() {
  const clipsLayer      = document.getElementById('timeline-layer-clips');
  const annotLayer      = document.getElementById('timeline-layer-annotations');
  const searchLayer     = document.getElementById('timeline-layer-search');
  if (!clipsLayer) return;
  clipsLayer.innerHTML = '';
  annotLayer.innerHTML = '';
  searchLayer.innerHTML = '';

  const dur = state.ytPlayer?.getDuration?.() || state.activeVideo?.duration_seconds || state.previewVideo?.duration_seconds || 1;

  // ── Layer 1: Clips (main track) ──
  // Highlight ranges — yellow bands
  // Skip ranges — hatched grey bands
  state.clips.forEach(c => {
    if (c.type === 'note' || c.type === 'question' || c.type === 'extract') return; // handled in layer 2
    const pct = (c.timestamp_seconds / dur) * 100;

    if (c.end_seconds != null) {
      const band = document.createElement('div');
      band.className = `tl-band tl-band-${c.type}`;
      band.style.left = `${pct}%`;
      band.style.width = `${Math.max(((c.end_seconds - c.timestamp_seconds) / dur) * 100, 0.5)}%`;
      band.title = `${fmtTime(c.timestamp_seconds)} → ${fmtTime(c.end_seconds)}${c.label ? ' — ' + c.label : ''}`;
      if (c.ollama_refined) band.title += ' ✨';
      band.onclick = () => seekTo(c.timestamp_seconds);
      clipsLayer.appendChild(band);
    }
    // Point-only highlights (incomplete) shown as small tick
  });

  // Chapter markers (preview) — in clips layer, bottom
  if (state.previewChapters.length) {
    state.previewChapters.forEach((ch, i) => {
      if (i === 0) return;
      const mark = document.createElement('div');
      mark.className = 'tl-chapter-mark';
      mark.style.left = `${(ch.start_time / dur) * 100}%`;
      mark.title = `📖 ${ch.title} — ${fmtTime(ch.start_time)}`;
      mark.onclick = (e) => { e.stopPropagation(); seekTo(ch.start_time); };
      clipsLayer.appendChild(mark);
    });
  }

  // ── Layer 2: Annotations (notes & questions) ──
  state.notes.forEach(n => {
    if (n.timestamp_seconds == null) return;
    const mark = document.createElement('div');
    const isOllama = n.source === 'ollama';
    mark.className = n.is_question ? (isOllama ? 'tl-question-detected' : 'tl-question') : 'tl-note';
    mark.style.left = `${(n.timestamp_seconds / dur) * 100}%`;
    mark.title = n.body ? `${fmtTime(n.timestamp_seconds)} — ${n.body}` : fmtTime(n.timestamp_seconds);
    mark.onclick = () => {
      seekTo(n.timestamp_seconds);
      const tab = n.is_question ? 'questions' : 'notes';
      switchTab(tab);
      setTimeout(() => {
        const item = [...document.querySelectorAll(`#${tab}-list .note-item`)]
          .find(el => Math.abs(parseFloat(el.dataset.ts) - n.timestamp_seconds) < 0.5);
        item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        item?.classList.add('now-playing');
        setTimeout(() => item?.classList.remove('now-playing'), 1500);
      }, 100);
    };
    annotLayer.appendChild(mark);
  });

  // ── Layer 3: Transcript search hits (temporary) ──
  if (state.tsearchMatches.length && state.previewTranscript.length) {
    state.tsearchMatches.forEach((entryIdx, matchIdx) => {
      const entry = state.previewTranscript[entryIdx];
      const dot = document.createElement('div');
      dot.className = 'tl-search-dot' + (matchIdx === state.tsearchIdx ? ' active' : '');
      dot.style.left = `${(entry.start / dur) * 100}%`;
      dot.title = entry.text;
      dot.onclick = (e) => {
        e.stopPropagation();
        state.tsearchIdx = matchIdx;
        seekTo(entry.start);
        renderTimelineMarkers();
        const activeSpan = document.querySelector(`#tsearch-results [data-idx="${entryIdx}"]`);
        activeSpan?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      };
      searchLayer.appendChild(dot);
    });
  }
}

/* ── Notes panel ── */
function renderNotesPanel() {
  renderClipsList();
  renderNotesList('notes');
  renderNotesList('questions');
  renderAllList();
}

function renderClipsList() {
  const container = document.getElementById('clips-list');
  container.innerHTML = '';
  // Clips tab shows only highlights and skips
  const displayClips = state.clips.filter(c => c.type === 'highlight' || c.type === 'skip');
  if (!displayClips.length) {
    container.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">No clips yet.<br>M = highlight · S = skip</p>';
    return;
  }
  const icons = { highlight: '■', skip: '■' };
  displayClips.forEach(c => {
    const item = document.createElement('div');
    item.className = 'clip-item';
    if (c.label) item.title = c.label; // tooltip with full label text
    const range = c.end_seconds != null
      ? `<span class="clip-ts">${fmtTime(c.timestamp_seconds)} → ${fmtTime(c.end_seconds)}</span>`
      : `<span class="clip-ts">${fmtTime(c.timestamp_seconds)}</span>`;
    const refinedBadge = c.ollama_refined ? `<span class="clip-refined-badge" title="AI-refined edges">✨</span>` : '';
    const refineBtn = (c.end_seconds != null && c.type === 'highlight' && state.activeVideo?.youtube_id && !c.ollama_refined)
      ? `<button class="item-refine" title="Refine edges with AI">✨</button>`
      : '';
    item.innerHTML = `
      <span class="clip-icon clip-icon-${c.type}">${icons[c.type] || '•'}</span>
      ${range}
      <span class="clip-label">${c.label || c.type}</span>
      ${refinedBadge}
      ${refineBtn}
      <button class="item-del" title="Delete">✕</button>`;
    item.querySelector('.item-del').onclick = (e) => { e.stopPropagation(); deleteClip(c.id); };
    if (refineBtn) {
      item.querySelector('.item-refine').onclick = (e) => {
        e.stopPropagation();
        refineClip(c.id, state.activeVideo.youtube_id, c.timestamp_seconds, c.end_seconds);
      };
    }
    item.dataset.ts = c.timestamp_seconds ?? '';
    item.onclick = () => {
      seekTo(c.timestamp_seconds);
      document.querySelectorAll('#clips-list .clip-item').forEach(el => el.classList.remove('now-playing'));
      item.classList.add('now-playing');
      setTimeout(() => item.classList.remove('now-playing'), 1500);
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    container.appendChild(item);
  });
}

function renderAllList() {
  const container = document.getElementById('all-list');
  if (!container) return;
  const v = state.activeVideo;
  if (!v) { container.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">No video selected.</p>'; return; }

  const yt = `https://www.youtube.com/watch?v=${v.youtube_id}`;
  const items = [];

  // Chapters
  (state.previewChapters || []).forEach(c => {
    items.push({ t: c.start_time, kind: 'chapter', label: c.title });
  });
  // Clips
  (state.clips || []).filter(c => c.type === 'highlight' || c.type === 'skip').forEach(c => {
    items.push({ t: c.timestamp_seconds, kind: c.type === 'skip' ? 'skip' : 'clip',
      label: c.label || c.type, id: c.id, end: c.end_seconds });
  });
  // Notes + Questions
  (state.notes || []).forEach(n => {
    if (n.timestamp_seconds == null) return;
    items.push({ t: n.timestamp_seconds, kind: n.is_question ? 'question' : 'note', label: n.body, id: n.id });
  });

  items.sort((a, b) => a.t - b.t);

  if (!items.length) {
    container.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">Nothing here yet.</p>';
    return;
  }

  const kindIcon = { chapter: '▲', clip: '■', skip: '■', note: '●', question: '▲' };
  container.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `all-item all-kind-${item.kind}`;
    el.dataset.ts = item.t;
    el.innerHTML = `<span class="all-icon">${kindIcon[item.kind] || '•'}</span>`
      + `<span class="all-ts">${fmtTime(item.t)}</span>`
      + `<span class="all-label">${item.label}</span>`;
    el.onclick = () => {
      seekTo(item.t);
      document.querySelectorAll('#all-list .all-item').forEach(e => e.classList.remove('now-playing'));
      el.classList.add('now-playing');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    container.appendChild(el);
  });
}

function renderNotesList(which) {
  const isQ = which === 'questions';
  const container = document.getElementById(isQ ? 'questions-list' : 'notes-list');
  container.innerHTML = '';
  const filtered = state.notes.filter(n => isQ ? n.is_question : !n.is_question);

  // Merge and sort by timestamp (ollama questions mixed in with user questions)
  const allItems = [...filtered].sort(
    (a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0)
  );

  if (!allItems.length) {
    const hint = isQ ? 'No questions yet. Press Q to add one.' : 'No notes yet. Press N to add a note.';
    container.innerHTML = `<p style="padding:12px;color:var(--text2);font-size:12px">${hint}</p>`;
    return;
  }

  allItems.forEach(n => {
    const isOllama = n.source === 'ollama';
    const item = document.createElement('div');
    item.className = 'note-item' + (n.is_question ? ' is-question' : '') + (isOllama ? ' ollama-question' : '');
    if (n.body) item.title = n.body;
    const ts = n.timestamp_seconds != null ? `<span class="note-ts">${fmtTime(n.timestamp_seconds)}</span>` : '';
    const iconClass = n.is_question ? 'note-icon note-icon-question' : 'note-icon note-icon-note';
    const icon = n.is_question ? '▲' : '●';
    const badge = isOllama ? '<span class="ai-badge">AI</span>' : '';
    const delBtn = isOllama ? '' : '<button class="item-del" title="Delete">✕</button>';
    item.innerHTML = `<span class="${iconClass}">${icon}</span>${ts}${badge}<span class="note-body">${n.body}</span>${delBtn}`;
    if (!isOllama) item.querySelector('.item-del').onclick = (e) => { e.stopPropagation(); deleteNote(n.id); };
    if (n.timestamp_seconds != null) item.onclick = () => seekTo(n.timestamp_seconds);
    item.dataset.ts = n.timestamp_seconds ?? '';
    container.appendChild(item);
  });
}

/* ── CRUD actions ── */
async function createPlaylist() {
  const vals = await modal({
    title: 'New Playlist',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'e.g. Blender Learning' },
      { key: 'topic', label: 'Topic (optional)', placeholder: 'e.g. 3D Modelling' },
      { key: 'description', label: 'Description (optional)', type: 'textarea' },
    ],
  });
  if (!vals?.name) return;
  await api.post('/api/playlists', vals);
  await loadPlaylists(); await loadVideos();
  toast('Playlist created');
}

async function deletePlaylist(id) {
  if (!confirm('Delete this playlist and all its videos?')) return;
  await api.del(`/api/playlists/${id}`);
  if (state.activePlaylistId === id) state.activePlaylistId = null;
  await loadPlaylists(); await loadVideos();
  toast('Playlist deleted');
}

async function addVideoToPlaylist(playlistId) {
  const vals = await modal({
    title: 'Add YouTube Video',
    fields: [{ key: 'url', label: 'YouTube URL', placeholder: 'https://www.youtube.com/watch?v=...' }],
  });
  if (!vals?.url) return;
  try {
    const video = await api.post('/api/videos', { url: vals.url, playlist_id: playlistId });
    toast('Video added — fetching metadata in background…');
    await loadVideos();
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      const updated = await api.get(`/api/videos/${video.id}`);
      if (updated.title !== 'Loading...' || tries > 20) {
        clearInterval(poll);
        state.videos = state.videos.map(v => v.id === updated.id ? updated : v);
        renderLibrary();
      }
    }, 2000);
  } catch (e) { toast('Error: ' + (e.message || 'Could not add video')); }
}

async function deleteVideo(id) {
  if (!confirm('Remove this video from the playlist?')) return;
  await api.del(`/api/videos/${id}`);
  if (state.activeVideoId === id) {
    cancelPending();
    state.activeVideoId = null; state.activeVideo = null;
    state.previewChapters = []; state.previewTranscript = [];
    state.tsearchMatches = []; state.tsearchIdx = 0;
    document.getElementById('player-wrap').style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('tab-btn-chapters').style.display = 'none';
    document.getElementById('transcript-search-section').style.display = 'none';
    document.getElementById('questions-detect-bar').style.display = 'none';
    switchTab('all');
  }
  await loadVideos(); toast('Video removed');
}

async function deleteClip(id) {
  await api.del(`/api/clips/${id}`);
  state.clips = state.clips.filter(c => c.id !== id);
  renderClipsList(); renderTimelineMarkers(); renderAllList();
}

async function deleteNote(id) {
  await api.del(`/api/notes/${id}`);
  state.notes = state.notes.filter(n => n.id !== id);
  renderNotesList('notes'); renderNotesList('questions'); renderAllList();
}

async function exportPlaylist(format) {
  if (!state.activePlaylistId) { toast('Select a playlist first'); return; }
  const url = format === 'json'
    ? `/api/export/playlist/${state.activePlaylistId}/json`
    : `/api/export/playlist/${state.activePlaylistId}/markdown`;
  window.location.href = url;
}

/* ── Keybindings ── */
document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (document.getElementById('modal-overlay').style.display !== 'none') return;
  if (e.key === '?' || e.key === '/') { e.preventDefault(); toggleHelp(); return; }
  if (document.getElementById('help-overlay').style.display !== 'none') { toggleHelp(); return; }
  switch (e.key) {
    case ' ':          e.preventDefault(); togglePlayPause(); break;
    case 'ArrowLeft':  e.preventDefault(); nudgeSeek(-5); break;
    case 'ArrowRight': e.preventDefault(); nudgeSeek(5); break;
    case 't': case 'T': if (state.activeVideoId) toggleTheatreMode(); break;    case 'm': case 'M': handleClipKey('highlight'); break;
    case 'n': case 'N': handleClipKey('note'); break;
    case 'q': case 'Q': handleClipKey('question'); break;
    case 'c': case 'C': smartClipAtPlayhead(); break;
    case 's': case 'S': handleClipKey('skip'); break;
    case 'j': case 'J': prevClip(); break;
    case 'k': case 'K': nextClip(); break;
    case '[':           e.preventDefault(); tsearchNav(-1); break;
    case ']':           e.preventDefault(); tsearchNav(+1); break;
    case 'c': case 'C': smartClipAtPlayhead(); break;
    case 'Escape':
      if (document.body.classList.contains('theatre-mode')) toggleTheatreMode();
      else cancelPending();
      break;
  }
});

function togglePlayPause() {
  if (!state.ytPlayer) return;
  const s = state.ytPlayer.getPlayerState();
  if (s === YT.PlayerState.PLAYING) state.ytPlayer.pauseVideo();
  else state.ytPlayer.playVideo();
}
function nudgeSeek(delta) {
  if (!state.ytPlayer) return;
  seekTo(Math.max(0, state.ytPlayer.getCurrentTime() + delta));
}

/* ── Timeline click ── */
// Timeline click to seek
document.getElementById('timeline-track').addEventListener('click', (e) => {
  if (!state.ytPlayer) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const dur = state.ytPlayer.getDuration() || state.duration || 1;
  seekTo(Math.max(0, Math.min(pct, 1)) * dur);
});

// Timeline drag to scrub
let _scrubbing = false;
document.getElementById('timeline-track').addEventListener('mousedown', (e) => {
  if (!state.ytPlayer) return;
  _scrubbing = true;
  // Disable transition during scrub for instant feedback
  document.getElementById('timeline-playhead').style.transition = 'none';
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const dur = state.ytPlayer.getDuration() || state.duration || 1;
  seekTo(Math.max(0, Math.min(pct, 1)) * dur);
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!_scrubbing || !state.ytPlayer) return;
  const track = document.getElementById('timeline-track');
  const rect = track.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const dur = state.ytPlayer.getDuration() || state.duration || 1;
  seekTo(Math.max(0, Math.min(pct, 1)) * dur);
});
document.addEventListener('mouseup', () => {
  if (_scrubbing) {
    // Re-enable transition after scrub ends
    document.getElementById('timeline-playhead').style.transition = 'left 0.5s linear';
  }
  _scrubbing = false;
});

/* ── Tabs ── */
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.toggle('active', tc.id === `tab-${tab}`));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ── Duration filter ── */
document.querySelectorAll('.dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeDuration = btn.dataset.dur;
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('active', b === btn));
    const customRow = document.getElementById('custom-duration-row');
    customRow.style.display = state.activeDuration === 'custom' ? 'flex' : 'none';
    if (state.activeDuration !== 'custom') loadVideos();
  });
});

document.getElementById('custom-dur-apply').addEventListener('click', () => loadVideos());
document.getElementById('custom-dur-min').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadVideos(); });
document.getElementById('custom-dur-max').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadVideos(); });

document.querySelectorAll('.lib-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const order = btn.dataset.order;
    if (state.libraryOrder === order) {
      // Toggle direction on repeat click
      state.libraryOrderDir = state.libraryOrderDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.libraryOrder = order;
      state.libraryOrderDir = order === 'title' ? 'asc' : 'desc';
      document.querySelectorAll('.lib-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    }
    // Update label with direction indicator
    if (order === 'added_at') {
      btn.textContent = state.libraryOrderDir === 'desc' ? 'Newest' : 'Oldest';
    } else if (order === 'title') {
      btn.textContent = state.libraryOrderDir === 'asc' ? 'Title A→Z' : 'Title Z→A';
    } else if (order === 'duration') {
      btn.textContent = state.libraryOrderDir === 'asc' ? 'Duration ↑' : 'Duration ↓';
    }
    loadVideos();
  });
});

/* ── Search ── */
let searchTimer;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  document.getElementById('library-clear-btn').style.display = e.target.value ? '' : 'none';
  searchTimer = setTimeout(() => {
    const raw = e.target.value.trim();
    // Strip operators before using as title/tag search query
    const titleQuery = raw.replace(/\bin:transcripts\b/gi, '').replace(/\bin:current\b/gi, '').trim();
    state.searchQuery = titleQuery;
    loadVideos();
  }, 300);
});
document.getElementById('library-clear-btn').onclick = () => {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('library-clear-btn').style.display = 'none';
  document.getElementById('transcript-results').style.display = 'none';
  state.searchQuery = '';
  loadVideos();
};
document.getElementById('search-input').addEventListener('focus', () => {
  document.getElementById('library-search-hint').style.display = 'block';
});
document.getElementById('search-input').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('library-search-hint').style.display = 'none'; }, 150);
});
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('library-search-hint').style.display = 'none';
    const val = document.getElementById('search-input').value;
    // Only run transcript search when operators are explicitly present
    if (/\bin:transcripts\b|\bin:current\b/i.test(val)) runTranscriptSearch();
    // Otherwise Enter just confirms the title filter already applied by the input handler
  }
  if (e.key === 'Escape') { document.getElementById('library-search-hint').style.display = 'none'; }
});
document.querySelectorAll('.lib-hint-row').forEach(row => {
  row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const op = row.dataset.op;
    const input = document.getElementById('search-input');
    const current = input.value.trim();
    if (!current.includes(op)) input.value = current ? `${current} ${op}` : op;
    input.focus();
  });
});

/* ── Button wiring ── */
document.getElementById('btn-new-playlist').onclick = createPlaylist;
document.getElementById('btn-help').onclick = () => {
  document.getElementById('help-modal').style.display = 'flex';
};
document.getElementById('btn-help-close').onclick = () => {
  document.getElementById('help-modal').style.display = 'none';
};
document.getElementById('btn-help-tour').onclick = () => {
  document.getElementById('help-modal').style.display = 'none';
  window._tour = null;
  window.startTour();
};
document.getElementById('help-backdrop').onclick = () => {
  document.getElementById('help-modal').style.display = 'none';
};
document.getElementById('btn-playpause').onclick = togglePlayPause;
document.getElementById('btn-seek-back').onclick = () => nudgeSeek(-5);
document.getElementById('btn-seek-fwd').onclick = () => nudgeSeek(5);

function toggleTheatreMode() {
  const isTheatre = document.body.classList.toggle('theatre-mode');
  document.getElementById('btn-theatre').textContent = isTheatre ? '⤡' : '⤢';
  document.getElementById('btn-theatre').title = isTheatre ? 'Exit theatre mode (T)' : 'Theatre mode (T)';
}
document.getElementById('btn-theatre').onclick = toggleTheatreMode;
document.getElementById('btn-prev-clip').onclick = prevClip;
document.getElementById('btn-next-clip').onclick = nextClip;
document.getElementById('btn-mark-highlight').onclick = () => handleClipKey('highlight');
document.getElementById('btn-mark-note').onclick = () => handleClipKey('note');
document.getElementById('btn-mark-question').onclick = () => handleClipKey('question');
document.getElementById('btn-mark-skip').onclick = () => handleClipKey('skip');
document.getElementById('btn-export-study').onclick = () => exportPlaylist('md');

function renderLibraryActionBar(video) {
  const bar = document.getElementById('library-related-btns');
  if (!bar) return;
  bar.innerHTML = '';

  const simBtn = document.createElement('button');
  simBtn.className = 'related-btn';
  simBtn.textContent = '↩ Similar projects';
  simBtn.onclick = () => runSimilarProjects(video, simBtn);
  bar.appendChild(simBtn);
}
document.getElementById('btn-export-json').onclick = () => exportPlaylist('json');

document.getElementById('btn-whats-next').onclick = async () => {
  const panel = document.getElementById('whats-next-panel');
  const loading = document.getElementById('whats-next-loading');
  const results = document.getElementById('whats-next-results');
  const btn = document.getElementById('btn-whats-next');

  // Toggle off if already open
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  loading.style.display = 'block';
  results.innerHTML = '';
  btn.textContent = '✦ Thinking…';
  btn.disabled = true;

  try {
    const data = await api.post('/api/learn/whats-next', {
      playlist_id: state.activePlaylistId || null
    });

    loading.style.display = 'none';

    if (!data.available || !data.suggestions?.length) {
      results.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">Ollama couldn\'t generate suggestions. Make sure Ollama is running and you have questions or videos in your library.</p>';
      return;
    }

    results.innerHTML = '';
    data.suggestions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'whats-next-item';
      item.innerHTML = `
        <div class="wn-topic">${s.topic}</div>
        <div class="wn-reason">${s.reason}</div>
        <button class="wn-search-btn" title="Search in Discover">↩ Search: "${s.search}"</button>`;
      item.querySelector('.wn-search-btn').onclick = () => {
        // Fire the search in Discover
        const discBtn = document.querySelector('.panel-tab[data-panel="discover"]');
        if (discBtn) discBtn.click();
        document.getElementById('discover-input').value = s.search;
        state.discoverAllResults = [];
        runDiscoverSearch();
        panel.style.display = 'none';
      };
      results.appendChild(item);
    });
  } catch (e) {
    loading.style.display = 'none';
    results.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">Ollama is not running. To enable AI suggestions:<br><br>1. Install <a href="https://ollama.com" target="_blank" style="color:var(--accent2)">ollama.com</a><br>2. Run: <code style="background:var(--bg3);padding:2px 5px;border-radius:3px">ollama pull gemma3:4b</code></p>';
  } finally {
    btn.textContent = '✦ What\'s next?';
    btn.disabled = false;
  }
};

document.getElementById('btn-whats-next-close').onclick = () => {
  document.getElementById('whats-next-panel').style.display = 'none';
};

async function runSimilarProjects(v, btn) {
  btn.textContent = 'Finding…';
  btn.disabled = true;
  try {
    let tags = [];
    let semTags = v.semantic_tags_json;
    if (typeof semTags === 'string') {
      try { semTags = JSON.parse(semTags); } catch (e) { semTags = []; }
    }
    if (Array.isArray(semTags) && semTags.length) {
      tags = semTags.slice(0, 2); // top 2 most specific
    } else {
      const res = await api.get(`/api/videos/yt-tags?youtube_id=${v.youtube_id}`);
      tags = (res.tags || []).slice(0, 2);
    }
    const dur = v.duration_seconds || 0;
    const durOp = dur < 240 ? 'duration:short' : dur < 1200 ? 'duration:medium' : 'duration:long';
    const topicQuery = tags.length ? tags.join(' ') : v.title;
    const query = `${topicQuery} ${durOp}`;

    // Pause and unload only the local video — keep YouTube iframe intact for preview
    try { state.ytPlayer?.pauseVideo(); } catch (e) {}
    if (_localVideoEl) {
      try { _localVideoEl.pause(); _localVideoEl.src = ''; _localVideoEl.remove(); } catch (e) {}
      _localVideoEl = null;
      document.getElementById('local-indicator')?.remove();
    }

    // Clear any active preview state
    if (state.previewVideo) {
      state.previewVideo = null;
      state.previewChapters = [];
      state.previewTranscript = [];
    }
    // Hide the title/action bars but keep player-wrap visible so YouTube iframe stays alive
    document.getElementById('preview-actions').style.display = 'none';
    document.getElementById('normal-title-row').style.display = 'none';
    // Clear notes panel
    document.getElementById('notes-video-title').textContent = 'Notes';
    document.getElementById('export-btns').style.display = 'none';
    document.getElementById('library-related-btns').innerHTML = '';
    document.getElementById('all-list').innerHTML = '';
    document.getElementById('clips-list').innerHTML = '';
    document.getElementById('notes-list').innerHTML = '';
    document.getElementById('questions-list').innerHTML = '';
    document.getElementById('chapters-list').innerHTML = '';
    switchTab('all');

    // Switch to Discover and populate feed
    // Preserve previous Discover search for Back bar if there was one
    const prevQuery = document.getElementById('discover-input')?.value.trim();
    const prevResults = [...(state.discoverAllResults || [])];
    const discBtn = document.querySelector('.panel-tab[data-panel="discover"]');
    if (discBtn) discBtn.click();
    document.getElementById('discover-input').value = query;
    state.discoverAllResults = [];
    state.discoverChannelId = null;
    state._isRelatedSearch = true;
    if (prevQuery) {
      state._relatedPrevQuery = prevQuery;
      state._relatedPrevResults = prevResults;
      document.getElementById('related-back-bar').style.display = 'flex';
      document.getElementById('related-back-label').textContent = `Similar to: ${v.title.slice(0, 40)}`;
    } else {
      state._relatedPrevQuery = null;
      state._relatedPrevResults = null;
      document.getElementById('related-back-bar').style.display = 'none';
    }
    runDiscoverSearch();
  } catch (e) {
    toast('Could not find similar projects');
  } finally {
    btn.textContent = '↩ Similar projects';
    btn.disabled = false;
  }
}

/* ── Chapters list (preview mode) ── */
function renderChaptersList(summaries = {}) {
  const container = document.getElementById('chapters-list');
  container.innerHTML = '';
  if (!state.previewChapters.length) {
    container.innerHTML = '<p style="padding:12px;color:var(--text2);font-size:12px">No chapters available for this video.</p>';
    return;
  }

  const dur = state.previewVideo?.duration_seconds || 0;

  state.previewChapters.forEach((ch, i) => {
    const next = state.previewChapters[i + 1];
    const chDur = next ? next.start_time - ch.start_time : (dur - ch.start_time);
    const s = summaries[i];

    const item = document.createElement('div');
    item.className = 'chapter-item';

    // Summary as tooltip — floats freely, never clipped by panel boundary
    if (s?.summary) item.title = s.summary;
    else if (s === null) item.title = 'Summarising…';

    item.innerHTML = `
      <div class="chapter-body">
        <span class="chapter-icon">▲</span>
        <span class="chapter-ts">${fmtTime(ch.start_time)}</span>
        <span class="chapter-title">${ch.title}</span>
        <span class="chapter-dur">${fmtDuration(chDur)}</span>
      </div>`;
    item.onclick = () => seekTo(ch.start_time);
    container.appendChild(item);
  });
}

/* ── Preview mode ── */
async function openPreview(video) {
  cancelPending();
  // Pause the current library video before switching to preview
  try { state.ytPlayer?.pauseVideo(); } catch (e) {}
  if (_localVideoEl) { try { _localVideoEl.pause(); } catch (e) {} }
  // Save current library video so we can restore it when preview closes
  state._libraryVideoBeforePreview = state.activeVideo || null;
  state._libraryVideoIdBeforePreview = state.activeVideoId || null;

  state.activeVideoId = null;
  state.activeVideo = null;
  state.clips = [];
  state.notes = [];
  state.previewVideo = video;
  state.previewDensity = [];
  state.previewChapters = [];
  state.previewSummaries = {};
  state.previewTranscript = [];
  state.tsearchMatches = [];
  state.tsearchIdx = 0;

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('player-wrap').style.display = 'flex';
  document.getElementById('normal-title-row').style.display = 'none';
  document.getElementById('preview-actions').style.display = 'flex';
  document.getElementById('export-btns').style.display = 'none';
  document.getElementById('preview-label').textContent = `▶ Preview: ${video.title}`;
  document.getElementById('video-title-text').textContent = video.title;
  renderRelatedButtons(video);

  // In preview: show only Chapters tab, hide Clips/Notes/Questions
  document.querySelectorAll('.tab-btn:not([data-tab="chapters"])').forEach(b => b.style.display = 'none');
  document.getElementById('tab-btn-chapters').style.display = '';
  switchTab('chapters');

  // Disable mark buttons
  document.querySelectorAll('.mark-btn').forEach(b => { b.disabled = true; });

  // Reset transcript search UI
  document.getElementById('transcript-search-section').style.display = 'block';
  document.getElementById('tsearch-input').value = '';
  document.getElementById('tsearch-status').textContent = '';

  renderNotesPanel();
  renderTimelineMarkers();
  loadYouTubeVideo(video.youtube_id, 0, true);

  // Fetch chapters and transcript — use session cache for transcript to avoid re-fetching
  const ytId = video.youtube_id;
  const cachedTranscript = state.transcriptCache[ytId];

  const [chapters, transcriptData] = await Promise.all([
    api.get(`/api/videos/chapters?youtube_id=${ytId}`).catch(() => []),
    cachedTranscript
      ? Promise.resolve(cachedTranscript)
      : api.get(`/api/videos/transcript_raw?youtube_id=${ytId}`).catch(() => []),
  ]);

  // Cache successful transcript fetches for the session
  if (transcriptData.length && !cachedTranscript) {
    state.transcriptCache[ytId] = transcriptData;
  }

  state.previewChapters = chapters;
  state.previewTranscript = transcriptData;
  state.tsearchMatches = [];
  state.tsearchIdx = 0;

  // Show transcript search section with full transcript
  document.getElementById('transcript-search-section').style.display = 'block';
  document.getElementById('tsearch-input').value = '';
  document.getElementById('tsearch-status').textContent = '';
  renderFullTranscript(); // show all entries immediately

  renderChaptersList();
  renderTimelineMarkers();

  // Then fetch Ollama summaries — may take 30-60s, renders when ready
  if (chapters.length) {
    // Show "Summarising…" placeholders
    const placeholders = {};
    chapters.forEach((_, i) => { placeholders[i] = null; });
    renderChaptersList(placeholders);

    api.get(`/api/videos/summaries?youtube_id=${video.youtube_id}`)
      .then(result => {
        if (result.available && result.summaries) {
          const summaryMap = {};
          result.summaries.forEach(s => { summaryMap[s.chapter_index] = s; });
          renderChaptersList(summaryMap);
          state.previewSummaries = summaryMap;
          renderTimelineMarkers();
        } else if (result.reason === 'model_not_ready') {
          // Show chapters without summaries, add a status note
          renderChaptersList();
          const note = document.createElement('p');
          note.style.cssText = 'padding:8px 12px;color:var(--text2);font-size:11px;font-style:italic';
          note.textContent = result.message || 'Ollama model loading…';
          document.getElementById('chapters-list').prepend(note);
        } else {
          renderChaptersList();
        }
      })
      .catch(() => renderChaptersList());
  }

  applyDiscoverFilters();
}

function renderRelatedButtons(video) {
  const container = document.getElementById('preview-related-btns');
  if (!container) return;
  container.innerHTML = '';

  const runRelatedSearch = (query, label, channelId = null) => {
    // Save current search so user can go back
    state._relatedPrevQuery = document.getElementById('discover-input').value.trim();
    state._relatedPrevResults = [...state.discoverAllResults];
    // Switch to Discover panel if not already there
    const discBtn = document.querySelector('.panel-tab[data-panel="discover"]');
    if (discBtn && state.activePanel !== 'discover') discBtn.click();
    // Set channel_id for precise API filtering when available
    state.discoverChannelId = channelId || null;
    state.discoverChannel = null; // let channel_id do the work
    // Populate and run — preview stays open, video keeps playing
    document.getElementById('discover-input').value = query;
    state.discoverAllResults = [];
    state._isRelatedSearch = true;
    runDiscoverSearch();
    // Show back bar
    document.getElementById('related-back-bar').style.display = 'flex';
    document.getElementById('related-back-label').textContent = label;
  };

  // Button 1: More from channel
  if (video.channel) {
    const btn = document.createElement('button');
    btn.className = 'related-btn';
    btn.textContent = `↩ ${video.channel}`;
    btn.title = `More from ${video.channel}`;
    btn.onclick = () => runRelatedSearch(video.channel, `More from ${video.channel}`, video.channel_id || null);
    container.appendChild(btn);
  }

  // Button 2: Related videos (YouTube tags via yt-dlp, fallback to title)
  const relBtn = document.createElement('button');
  relBtn.className = 'related-btn';
  relBtn.textContent = '↩ Related videos';
  relBtn.onclick = async () => {
    relBtn.textContent = 'Loading…';
    relBtn.disabled = true;
    try {
      const res = await api.get(`/api/videos/yt-tags?youtube_id=${video.youtube_id}`);
      const tags = res.tags || [];
      // Build a focused query: top 2 tags + channel for context (more specific = better results)
      // Use channel as anchor so YouTube stays on-topic (e.g. "Houdini tree generation branching")
      let queryParts = [];
      if (video.channel && video.channel.length < 20) queryParts.push(video.channel);
      if (tags.length) queryParts.push(...tags.slice(0, 2));
      else queryParts.push(video.title.split(/[\|\-–]/)[0].trim().slice(0, 40));
      const query = queryParts.join(' ');
      runRelatedSearch(query, `Related to: ${video.title.slice(0, 40)}`);
    } catch (e) {
      runRelatedSearch(video.title, `Related to: ${video.title.slice(0, 40)}`);
    } finally {
      relBtn.textContent = '↩ Related videos';
      relBtn.disabled = false;
    }
  };
  container.appendChild(relBtn);
}

// Back button — restore previous search
document.getElementById('btn-related-back').onclick = () => {
  document.getElementById('related-back-bar').style.display = 'none';
  const prev = state._relatedPrevQuery || '';
  const prevResults = state._relatedPrevResults || [];
  document.getElementById('discover-input').value = prev;

  if (prevResults.length) {
    // Restore saved results directly — no re-fetch needed
    state.discoverAllResults = prevResults;
    applyDiscoverFilters();
    document.getElementById('discover-status').textContent =
      `${prevResults.length} result${prevResults.length !== 1 ? 's' : ''}`;
  } else if (prev) {
    state.discoverAllResults = [];
    runDiscoverSearch();
  } else {
    document.getElementById('discover-results').innerHTML = '';
    document.getElementById('discover-status').textContent = '';
  }
  state._relatedPrevQuery = null;
  state._relatedPrevResults = null;
  state.discoverChannelId = null;
};

function closePreview() {
  try { state.ytPlayer?.pauseVideo(); } catch (e) {}
  state.previewVideo = null;
  state.previewDensity = [];
  state.previewChapters = [];
  state.previewSummaries = {};
  state.previewTranscript = [];
  state.tsearchMatches = [];
  state.tsearchIdx = 0;
  document.getElementById('transcript-search-section').style.display = 'none';
  document.getElementById('normal-title-row').style.display = 'flex';
  document.getElementById('preview-actions').style.display = 'none';
  document.getElementById('tab-btn-chapters').style.display = 'none';
  document.querySelectorAll('.tab-btn:not([data-tab="chapters"]):not([data-tab="similar"])').forEach(b => b.style.display = '');
  document.querySelectorAll('.mark-btn').forEach(b => { b.disabled = false; });
  switchTab('all');
  applyDiscoverFilters();

  // If a Library video was active before preview, restore it
  const savedVideo = state._libraryVideoBeforePreview;
  const savedId = state._libraryVideoIdBeforePreview;
  state._libraryVideoBeforePreview = null;
  state._libraryVideoIdBeforePreview = null;

  if (savedId && savedVideo) {
    state.activeVideoId = savedId;
    state.activeVideo = savedVideo;
    document.getElementById('player-wrap').style.display = 'flex';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('video-title-text').textContent = savedVideo.title || '';
    const resumeAt = savedVideo.last_position_seconds > 5 ? savedVideo.last_position_seconds : 0;
    loadYouTubeVideo(savedVideo.youtube_id, resumeAt);
  } else {
    document.getElementById('player-wrap').style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
  }
}

document.getElementById('btn-preview-close').addEventListener('click', closePreview);
document.getElementById('btn-preview-add').addEventListener('click', (e) => {
  if (state.previewVideo) showPlaylistPicker(state.previewVideo, e.currentTarget, true);
});

function syncTranscriptScroll() {
  if (!state.previewTranscript.length || !state.ytPlayer?.getCurrentTime) return;
  const t = state.ytPlayer.getCurrentTime();

  // Find active transcript entry
  let activeIdx = 0;
  for (let i = 0; i < state.previewTranscript.length; i++) {
    if (state.previewTranscript[i].start <= t) activeIdx = i;
    else break;
  }

  // Sync transcript — highlight active span
  const spans = document.querySelectorAll('#tsearch-results span[data-idx]');
  spans.forEach(el => {
    const idx = parseInt(el.dataset.idx);
    const wasActive = el.classList.contains('now-playing');
    const isActive = idx === activeIdx;
    if (wasActive !== isActive) el.classList.toggle('now-playing', isActive);
  });
  if (!state.tsearchMatches.length) {
    const activeSpan = document.querySelector(`#tsearch-results span[data-idx="${activeIdx}"]`);
    if (activeSpan) {
      const container = document.getElementById('tsearch-results');
      const containerRect = container.getBoundingClientRect();
      const spanRect = activeSpan.getBoundingClientRect();
      const spanRelativeTop = spanRect.top - containerRect.top + container.scrollTop;
      const targetScroll = spanRelativeTop - container.clientHeight * 0.25;
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }

  // Sync chapter list — highlight active chapter
  if (state.previewChapters.length) {
    let activeChapterIdx = 0;
    for (let i = 0; i < state.previewChapters.length; i++) {
      if (state.previewChapters[i].start_time <= t) activeChapterIdx = i;
      else break;
    }
    const chItems = document.querySelectorAll('#chapters-list .chapter-item');
    chItems.forEach((el, i) => {
      const wasActive = el.classList.contains('chapter-active');
      const isActive = i === activeChapterIdx;
      if (wasActive !== isActive) el.classList.toggle('chapter-active', isActive);
    });
    // Scroll active chapter into view if changed
    if (chItems[activeChapterIdx] && !chItems[activeChapterIdx].classList.contains('chapter-was-active')) {
      chItems.forEach(el => el.classList.remove('chapter-was-active'));
      chItems[activeChapterIdx].classList.add('chapter-was-active');
      chItems[activeChapterIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Sync clips list — highlight clip whose range covers current time
  const clipItems = document.querySelectorAll('#clips-list .clip-item');
  clipItems.forEach(el => {
    const ts = parseFloat(el.dataset.ts);
    if (isNaN(ts)) return;
    const clip = (state.clips || []).find(c => c.timestamp_seconds === ts);
    const end = clip?.end_seconds ?? ts + 3;
    const isActive = t >= ts && t <= end;
    el.classList.toggle('clip-active', isActive);
  });

  // Sync All tab — highlight item whose range covers current time
  const allItems = document.querySelectorAll('#all-list .all-item');
  let lastActive = null;
  allItems.forEach(el => {
    const ts = parseFloat(el.dataset.ts);
    if (!isNaN(ts) && ts <= t) lastActive = el;
  });
  allItems.forEach(el => el.classList.toggle('all-active', el === lastActive));
  if (lastActive && state.activeTab === 'all') {
    lastActive.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ── Within-video transcript search ── */
function renderFullTranscript(q = '') {
  const resultsEl = document.getElementById('tsearch-results');
  resultsEl.innerHTML = '';
  if (!state.previewTranscript.length) {
    resultsEl.innerHTML = state.previewVideo
      ? '<p style="padding:8px 12px;color:var(--text2);font-size:11px">Transcript not yet loaded for this video.<br>Add it to a playlist — it will be fetched automatically.</p>'
      : '<p style="padding:8px 12px;color:var(--text2);font-size:11px">No transcript available.</p>';
    return;
  }

  const qLower = q.toLowerCase();
  const isSearchActive = qLower.length > 0;

  // Paragraph layout: wrap all entries in one flowing <p>, each word group is a <span>
  const para = document.createElement('p');
  para.className = 'transcript-para';

  state.previewTranscript.forEach((entry, i) => {
    const text = entry.text.trim();
    if (!text) return;

    const isMatch = isSearchActive && text.toLowerCase().includes(qLower);

    const span = document.createElement('span');
    span.className = 'tseg' + (isMatch ? ' match' : '') + (isSearchActive && !isMatch ? ' dim' : '');
    span.dataset.idx = i;
    span.title = fmtTime(entry.start); // timestamp as tooltip

    // Highlight matching term within the span
    if (isMatch) {
      const idx = text.toLowerCase().indexOf(qLower);
      span.innerHTML =
        text.slice(0, idx) +
        `<mark>${text.slice(idx, idx + q.length)}</mark>` +
        text.slice(idx + q.length);
    } else {
      span.textContent = text;
    }

    // Add a space after each segment to separate words
    span.appendChild(document.createTextNode(' '));
    span.onclick = () => seekTo(entry.start);
    para.appendChild(span);
  });

  resultsEl.appendChild(para);
}

function runTranscriptVideoSearch() {
  const q = document.getElementById('tsearch-input').value.trim();
  const statusEl = document.getElementById('tsearch-status');

  state.tsearchMatches = [];
  state.tsearchIdx = -1; // -1 so first ] lands on match 0

  if (!q) {
    statusEl.textContent = '';
    renderFullTranscript();
    renderTimelineMarkers();
    return;
  }

  const qLower = q.toLowerCase();
  state.previewTranscript.forEach((entry, i) => {
    if (entry.text.toLowerCase().includes(qLower)) {
      state.tsearchMatches.push(i);
    }
  });

  statusEl.textContent = state.tsearchMatches.length
    ? `${state.tsearchMatches.length} match${state.tsearchMatches.length !== 1 ? 'es' : ''} — press ] to navigate`
    : `No matches for "${q}"`;

  renderFullTranscript(q);
  renderTimelineMarkers();

  // Scroll to first match, seek video, and activate [ / ] navigation immediately
  if (state.tsearchMatches.length) {
    state.tsearchIdx = 0;
    const firstEntryIdx = state.tsearchMatches[0];
    const firstSpan = document.querySelector(`#tsearch-results [data-idx="${firstEntryIdx}"]`);
    firstSpan?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    seekTo(state.previewTranscript[firstEntryIdx].start);
    // Blur input so [ / ] keystrokes reach the document handler
    document.getElementById('tsearch-input').blur();
    document.getElementById('tsearch-status').textContent =
      `1 / ${state.tsearchMatches.length} — [ ] to navigate`;
  }
}

document.getElementById('tsearch-btn').addEventListener('click', runTranscriptVideoSearch);
document.getElementById('tsearch-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runTranscriptVideoSearch();
  if (e.key === 'Escape') clearTranscriptSearch();
});
// Show/hide clear button as user types
document.getElementById('tsearch-input').addEventListener('input', (e) => {
  const clearBtn = document.getElementById('tsearch-clear');
  if (clearBtn) clearBtn.style.display = e.target.value ? '' : 'none';
  if (!e.target.value) clearTranscriptSearch();
});
document.getElementById('tsearch-clear').addEventListener('click', clearTranscriptSearch);

function clearTranscriptSearch() {
  document.getElementById('tsearch-input').value = '';
  document.getElementById('tsearch-clear').style.display = 'none';
  document.getElementById('tsearch-status').textContent = '';
  state.tsearchMatches = [];
  state.tsearchIdx = 0;
  renderFullTranscript();
  renderTimelineMarkers();
}

/* ── Transcript search navigation ── */
function tsearchNav(dir) {
  if (!state.tsearchMatches.length) return;
  if (state.tsearchIdx === -1) {
    state.tsearchIdx = dir > 0 ? 0 : state.tsearchMatches.length - 1;
  } else {
    state.tsearchIdx = (state.tsearchIdx + dir + state.tsearchMatches.length) % state.tsearchMatches.length;
  }
  const entryIdx = state.tsearchMatches[state.tsearchIdx];
  seekTo(state.previewTranscript[entryIdx].start);
  renderTimelineMarkers();
  const activeSpan = document.querySelector(`#tsearch-results [data-idx="${entryIdx}"]`);
  activeSpan?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  document.getElementById('tsearch-status').textContent =
    `${state.tsearchIdx + 1} / ${state.tsearchMatches.length} — [ ] to navigate`;
}

async function markCurrentSearchMatch() {
  if (!state.tsearchMatches.length || !state.activeVideoId) return;
  if (state.previewVideo) return; // Library only
  const entryIdx = state.tsearchMatches[state.tsearchIdx];
  const entry = state.previewTranscript[entryIdx];
  const nextEntry = state.previewTranscript[entryIdx + 1];
  const end = nextEntry ? nextEntry.start : entry.start + (entry.duration || 3);
  const q = document.getElementById('tsearch-input')?.value.trim() || '';
  await api.post('/api/clips', {
    video_id: state.activeVideoId,
    timestamp_seconds: entry.start,
    end_seconds: end,
    label: q || entry.text.slice(0, 60),
    type: 'highlight',
  });
  await loadClipsAndNotes();
  toast(`⭐ Clipped at ${fmtTime(entry.start)} — ] for next match`);
}

/* ── Smart clip at playhead (C key) — Ollama finds idea boundary ── */
async function smartClipAtPlayhead() {
  if (!state.ytPlayer || !state.activeVideoId || state.previewVideo) return;
  if (!state.previewTranscript.length) { toast('No transcript available for smart clip'); return; }

  const t = state.ytPlayer.getCurrentTime();
  // Find transcript entry containing current playhead
  let idx = state.previewTranscript.findIndex(
    (e, i) => e.start <= t && t < (state.previewTranscript[i + 1]?.start ?? e.start + (e.duration || 5))
  );
  if (idx === -1) idx = state.previewTranscript.filter(e => e.start <= t).length - 1;
  if (idx < 0) { toast('Playhead is before transcript start'); return; }

  // Use playhead ±15s as rough range — Ollama will tighten to idea boundary
  const roughStart = Math.max(0, t - 15);
  const roughEnd = t + 15;
  const video = state.videos.find(v => v.id === state.activeVideoId);
  const ytId = video?.youtube_id;
  if (!ytId) return;

  toast('✨ Finding idea boundary…', 4000);
  try {
    const result = await api.post('/api/videos/refine-clip', {
      youtube_id: ytId,
      start_seconds: roughStart,
      end_seconds: roughEnd,
    });
    const clipStart = result.start ?? roughStart;
    const clipEnd = result.end ?? roughEnd;
    const label = state.previewTranscript.find(e => e.start >= clipStart)?.text?.slice(0, 60) || '';
    await api.post('/api/clips', {
      video_id: state.activeVideoId,
      timestamp_seconds: clipStart,
      end_seconds: clipEnd,
      label,
      type: 'highlight',
    });
    await loadClipsAndNotes();
    toast(`⭐ Clipped ${fmtTime(clipStart)} → ${fmtTime(clipEnd)}${result.reason ? ' — ' + result.reason : ''}`);
  } catch (e) {
    toast('Smart clip failed — is Ollama running?');
  }
}

/* ── Ollama clip edge refinement ── */
async function refineClip(clipId, youtubeId, start, end) {
  toast('✨ Refining clip edges with AI…', 5000);
  try {
    const result = await api.post('/api/videos/refine-clip', {
      youtube_id: youtubeId,
      start_seconds: start,
      end_seconds: end,
    });
    if (result.refined) {
      await api.patch(`/api/clips/${clipId}`, {
        timestamp_seconds: result.start,
        end_seconds: result.end,
        ollama_refined: 1,
      });
      await loadClipsAndNotes();
      toast(`✨ Refined: ${fmtTime(result.start)} → ${fmtTime(result.end)}${result.reason ? ' — ' + result.reason : ''}`);
    } else {
      toast(`✨ Edges already optimal${result.reason ? ': ' + result.reason : ''}`);
    }
  } catch (e) {
    toast('Refinement failed — is Ollama running?');
  }
}

/* ── Clip from transcript text selection ── */
let _clipSelBtn = null;

function removeClipSelectionBtn() {
  if (_clipSelBtn) { _clipSelBtn.remove(); _clipSelBtn = null; }
}

function showClipSelectionBtn(startT, endT, label) {
  removeClipSelectionBtn();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();

  const btn = document.createElement('button');
  btn.className = 'clip-selection-btn';
  btn.textContent = `✂ Clip  ${fmtTime(startT)} → ${fmtTime(endT)}`;
  btn.style.top = `${rect.bottom + window.scrollY + 4}px`;
  btn.style.left = `${rect.left + window.scrollX}px`;
  btn.onclick = async (e) => {
    e.stopPropagation();
    removeClipSelectionBtn();
    window.getSelection()?.removeAllRanges();
    await api.post('/api/clips', {
      video_id: state.activeVideoId,
      timestamp_seconds: startT,
      end_seconds: endT,
      label: label || 'transcript clip',
      type: 'highlight',
    });
    await loadClipsAndNotes();
    seekTo(startT);
    toast(`✂ Clipped: ${fmtTime(startT)} → ${fmtTime(endT)}`);
  };
  document.body.appendChild(btn);
  _clipSelBtn = btn;
  // Auto-remove on next click outside
  setTimeout(() => document.addEventListener('click', removeClipSelectionBtn, { once: true }), 0);
}

function handleTranscriptSelection() {
  if (!state.activeVideoId || state.previewVideo) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { removeClipSelectionBtn(); return; }
  const range = sel.getRangeAt(0);
  // Works for both paragraph spans (new) and legacy div rows
  const items = document.querySelectorAll('#tsearch-results [data-idx]');
  const selected = [...items].filter(el => range.intersectsNode(el));
  if (!selected.length) { removeClipSelectionBtn(); return; }

  const firstIdx = parseInt(selected[0].dataset.idx);
  const lastIdx = parseInt(selected[selected.length - 1].dataset.idx);
  const startT = state.previewTranscript[firstIdx]?.start;
  const lastEntry = state.previewTranscript[lastIdx];
  if (startT == null || !lastEntry) { removeClipSelectionBtn(); return; }
  const endT = lastEntry.start + (lastEntry.duration || 3);
  showClipSelectionBtn(startT, endT, sel.toString().trim().slice(0, 80));
}

document.getElementById('tsearch-results').addEventListener('mouseup', handleTranscriptSelection);

/* ── Local video download ── */

// Native video player state
let _localVideoEl = null;

function loadLocalVideo(url, startAt = 0, videoId = null, autoplay = true) {
  const container = document.getElementById('yt-player-container');

  // Hide YouTube iframe rather than destroying it — preserves the player for later reuse
  if (state.ytPlayer) {
    try { state.ytPlayer.pauseVideo(); } catch (e) {}
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.style.display = 'none';
  }

  // Remove old local player
  if (_localVideoEl) { _localVideoEl.remove(); _localVideoEl = null; }

  const video = document.createElement('video');
  video.id = 'local-video';
  video.src = url;
  video.controls = false; // we use our own controls
  video.style.cssText = 'width:100%;height:100%;background:#000;display:block;';
  video.currentTime = startAt;
  video.autoplay = autoplay;

  video.addEventListener('loadedmetadata', () => {
    state.duration = video.duration;
    document.getElementById('time-total').textContent = fmtTime(video.duration);
    video.currentTime = startAt;
  });

  video.addEventListener('play', () => {
    document.getElementById('btn-playpause').textContent = '⏸';
    startProgressTimer();
  });
  video.addEventListener('pause', () => {
    document.getElementById('btn-playpause').textContent = '▶';
    stopProgressTimer();
  });
  video.addEventListener('ended', () => {
    document.getElementById('btn-playpause').textContent = '▶';
    stopProgressTimer();
  });

  container.innerHTML = '';
  container.appendChild(video);
  _localVideoEl = video;

  // Patch ytPlayer interface so all existing controls work transparently
  state.ytPlayer = {
    getCurrentTime: () => video.currentTime,
    getDuration: () => video.duration || 0,
    seekTo: (t) => { video.currentTime = t; },
    pauseVideo: () => video.pause(),
    playVideo: () => video.play(),
    getPlayerState: () => video.paused ? 2 : 1, // 1=playing, 2=paused
    getVideoLoadedFraction: () => {
      if (!video.buffered.length || !video.duration) return 0;
      return video.buffered.end(video.buffered.length - 1) / video.duration;
    },
    loadVideoById: ({ videoId: ytId, startSeconds }) => {
      // Called if switching to YouTube — handled by caller
    },
    destroy: () => { video.pause(); video.src = ''; },
  };

  // Add local indicator — sibling AFTER title span, not inside it
  const indicator = document.getElementById('local-indicator');
  if (!indicator) {
    const ind = document.createElement('span');
    ind.id = 'local-indicator';
    ind.className = 'local-indicator';
    ind.title = 'Playing from local file';
    ind.textContent = '● local';
    document.getElementById('video-title-text')?.after(ind);
  }
}

function unloadLocalVideo() {
  if (_localVideoEl) { _localVideoEl.pause(); _localVideoEl.src = ''; _localVideoEl.remove(); _localVideoEl = null; }
  document.getElementById('local-indicator')?.remove();
  // Re-show YouTube iframe if hidden — don't destroy the player
  const iframe = document.querySelector('#yt-player-container iframe');
  if (iframe) iframe.style.display = '';
}
let _dlPollTimer = null;
async function startDownloadPolling() {
  if (_dlPollTimer) return;
  _dlPollTimer = setInterval(async () => {
    try {
      const status = await api.get('/api/downloads/status');
      if (status.active !== null || status.queue.length > 0) {
        // Re-fetch videos to get updated download_status fields
        await loadVideos();
      } else {
        // Nothing active — stop polling
        clearInterval(_dlPollTimer);
        _dlPollTimer = null;
        await loadVideos(); // one final refresh
      }
    } catch (e) { /* ignore */ }
  }, 3000);
}

// Called when opening a Library video — check if local file available
async function getLocalVideoUrl(videoId) {
  try {
    // Use the videos API to check download status — avoids HEAD request issues
    const resp = await fetch(`/api/videos/${videoId}`);
    if (!resp.ok) return null;
    const video = await resp.json();
    if (video.download_status === 'complete' && video.local_path) {
      return `/api/downloads/file/${videoId}`;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ══════════════════════════════════════
   MY TEACHERS
   ══════════════════════════════════════ */


async function loadTrustedTeachers() {
  state.trustedTeachers = await api.get('/api/teachers').catch(() => []);
  renderFollowingPills();
}

function renderFollowingPills() {
  const section = document.getElementById('following-section');
  const container = document.getElementById('following-pills');
  if (!section || !container) return;

  if (!state.trustedTeachers.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = '';

  state.trustedTeachers.forEach(t => {
    const pill = document.createElement('span');
    pill.className = 'following-pill' + (state.discoverChannel === t.name ? ' active' : '');
    pill.innerHTML = `
      ${t.thumbnail ? `<img src="${t.thumbnail}" class="following-pill-thumb" alt="" />` : ''}
      <span class="following-pill-name">${t.name}</span>
      <button class="following-pill-remove" title="Unfollow">✕</button>`;
    pill.querySelector('.following-pill-name').onclick = () => {
      state.discoverChannel = state.discoverChannel === t.name ? null : t.name;
      state.discoverChannelId = null;
      document.getElementById('discover-input').value = t.name;
      runDiscoverSearch();
    };
    pill.querySelector('.following-pill-remove').onclick = async (e) => {
      e.stopPropagation();
      await api.del(`/api/teachers/${t.id}`);
      if (state.discoverChannel === t.name) { state.discoverChannel = null; state.discoverChannelId = null; }
      await loadTrustedTeachers();
      applyDiscoverFilters();
      toast(`Unfollowed ${t.name}`);
    };
    container.appendChild(pill);
  });
}

async function followChannel(channelId, name, thumbnail) {
  let resolvedId = channelId, resolvedThumb = thumbnail;
  if (channelId && !channelId.startsWith('UC')) {
    try {
      const info = await api.get(`/api/teachers/lookup?name=${encodeURIComponent(name)}`);
      resolvedId = info.channel_id; resolvedThumb = info.thumbnail || thumbnail;
    } catch (e) {}
  }
  await api.post('/api/teachers', { channel_id: resolvedId || name, name, thumbnail: resolvedThumb });
  await loadTrustedTeachers();
  toast(`Following ${name}`);
  applyDiscoverFilters();
}

async function unfollowChannel(name) {
  const teacher = state.trustedTeachers.find(t => t.name === name || t.channel_id === name);
  if (teacher) {
    await api.del(`/api/teachers/${teacher.id}`);
    if (state.discoverChannel === name) { state.discoverChannel = null; state.discoverChannelId = null; }
    await loadTrustedTeachers();
    applyDiscoverFilters();
    toast(`Unfollowed ${name}`);
  }
}

// My Teachers search — uses YouTube Data API via backend
async function runTeachersSearch() {
  const q = document.getElementById('discover-input').value.trim();
  const statusEl = document.getElementById('discover-status');
  const resultsEl = document.getElementById('discover-results');

  if (!state.trustedTeachers.length) {
    statusEl.textContent = 'No teachers yet — add some from All YouTube first';
    resultsEl.innerHTML = '';
    return;
  }

  statusEl.textContent = `Searching across ${state.trustedTeachers.length} teacher${state.trustedTeachers.length !== 1 ? 's' : ''}…`;
  resultsEl.innerHTML = '';

  const params = new URLSearchParams({ order: state.discoverOrder, limit: 20 });
  if (q) params.set('q', q);
  if (state.discoverDuration && state.discoverDuration !== 'custom') {
    // Map to YouTube API duration values
    const map = { short: 'short', medium: 'medium', long: 'long' };
    if (map[state.discoverDuration]) params.set('duration', map[state.discoverDuration]);
  }

  try {
    const data = await api.get(`/api/teachers/search?${params}`);
    if (data.message) { statusEl.textContent = data.message; return; }
    const results = data.results || [];
    state.discoverAllResults = results;
    statusEl.textContent = results.length
      ? `${results.length} results across My Teachers`
      : 'No results — try different keywords or filters';
    renderDiscoverResults(results);
  } catch (e) {
    statusEl.textContent = 'Search failed';
  }
}

// Wire sort buttons — client-side sort on cached results, no re-fetch
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const order = btn.dataset.order;
    const dirLabels = { viewCount: ['Most Viewed ↓','Most Viewed ↑'], date: ['Recent ↓','Recent ↑'] };
    if (state.discoverOrder === order && order !== 'relevance') {
      // Toggle direction
      state.discoverOrderDir = state.discoverOrderDir === 'desc' ? 'asc' : 'desc';
      const labels = dirLabels[order];
      if (labels) btn.textContent = state.discoverOrderDir === 'desc' ? labels[0] : labels[1];
    } else {
      state.discoverOrder = order;
      state.discoverOrderDir = 'desc';
      document.querySelectorAll('.sort-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        const origLabels = { relevance: 'Relevant', viewCount: 'Most Viewed ↓', date: 'Recent ↓' };
        if (origLabels[b.dataset.order] !== undefined) b.textContent = b === btn ? origLabels[order] : { relevance: 'Relevant', viewCount: 'Most Viewed', date: 'Recent' }[b.dataset.order];
      });
      // Show direction on clicked button
      const labels = dirLabels[order];
      if (labels) btn.textContent = labels[0]; // default desc
    }
    applyDiscoverFilters();
  });
});

// Override search to route to My Teachers when in that mode
const _origRunDiscoverSearch = runDiscoverSearch;
// (runDiscoverSearch already checks mode below)

/* ── Boot ── */
(async () => {
  await loadPlaylists();
  await loadVideos();
  await loadTrustedTeachers();
})();

/* ══════════════════════════════════════════
   SPRINT 2 — Discover + Transcript Search + Help
   ══════════════════════════════════════════ */

/* ── Panel toggle (Library / Discover) ── */
document.querySelectorAll('.panel-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const wasDiscover = state.activePanel === 'discover';
    state.activePanel = btn.dataset.panel;
    document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('library-view').style.display = state.activePanel === 'library' ? 'flex' : 'none';
    document.getElementById('discover-view').style.display = state.activePanel === 'discover' ? 'flex' : 'none';

    // Switching back to Library: pause Discover preview, restore source video UI
    if (state.activePanel === 'library' && wasDiscover) {
      try { state.ytPlayer?.pauseVideo(); } catch (e) {}
      if (state.activeVideo) {
        const v = state.activeVideo;
        document.getElementById('normal-title-row').style.display = 'flex';
        document.getElementById('empty-state').style.display = 'none';
        renderLibraryActionBar(v);
        document.getElementById('notes-video-title').textContent = v.title || 'Video';
        document.getElementById('export-btns').style.display = 'flex';
        // Reload local video paused if needed
        if (v.local_path && !_localVideoEl) {
          loadLocalVideo(v.local_path, v.last_position_seconds || 0, v.youtube_id, false);
        }
      }
    }
  });
});

/* ── Transcript search ── */
async function runTranscriptSearch() {
  const raw = document.getElementById('search-input').value.trim();
  if (!raw) return;
  document.getElementById('library-clear-btn').style.display = '';
  const resultsEl = document.getElementById('transcript-results');
  const listEl = document.getElementById('transcript-results-list');
  const labelEl = document.getElementById('transcript-results-label');
  listEl.innerHTML = '<p style="padding:8px 12px;color:var(--text2);font-size:12px">Searching…</p>';
  resultsEl.style.display = 'block';

  // Parse operators
  const inCurrent = /\bin:current\b/i.test(raw);
  const inTranscripts = /\bin:transcripts\b/i.test(raw);
  const q = raw.replace(/\bin:current\b/gi, '').replace(/\bin:transcripts\b/gi, '').trim();
  if (!q) { listEl.innerHTML = '<p style="padding:8px 12px;color:var(--text2);font-size:12px">Enter a search term.</p>'; return; }

  const params = new URLSearchParams({ q });
  if (inCurrent && state.activePlaylistId) params.set('playlist_id', state.activePlaylistId);
  const results = await api.get(`/api/search/transcript?${params}`);

  const scopeLabel = inCurrent && state.activePlaylistId ? ' in this playlist' : ' across library';
  const searchType = inTranscripts ? 'transcript' : 'transcript';
  labelEl.textContent = `${results.length} transcript match${results.length !== 1 ? 'es' : ''} for "${q}"${scopeLabel}`;
  listEl.innerHTML = '';

  if (!results.length) {
    listEl.innerHTML = '<p style="padding:8px 12px;color:var(--text2);font-size:12px">No matches found in transcripts.</p>';
    return;
  }

  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'transcript-match';
    item.innerHTML = `
      <div class="transcript-match-title">${r.title}</div>
      <div class="transcript-match-ts">${fmtTime(r.timestamp_seconds)}</div>
      <div class="transcript-match-snippet">${r.snippet}</div>`;
    item.onclick = async () => {
      let video = state.videos.find(v => v.id === r.video_id);
      if (!video) {
        // Fetch video directly from API — always works regardless of active playlist
        try {
          video = await api.get(`/api/videos/${r.video_id}`);
          if (video?.playlist_id) {
            state.activePlaylistId = video.playlist_id;
            await loadVideos();
            // Re-fetch from state after loading
            video = state.videos.find(v => v.id === r.video_id) || video;
          }
        } catch (e) {
          video = null;
        }
      }
      if (video) {
        if (state.activeVideoId !== video.id) {
          await openVideo(video);
          setTimeout(() => seekTo(r.timestamp_seconds), 1000);
        } else {
          seekTo(r.timestamp_seconds);
        }
      } else {
        toast('Could not find this video');
      }
    };
    listEl.appendChild(item);
  });
}

document.getElementById('btn-transcript-search').addEventListener('click', () => {
  const val = document.getElementById('search-input').value;
  // ⌕ button only runs transcript search when operators are present
  if (/\bin:transcripts\b|\bin:current\b/i.test(val)) runTranscriptSearch();
});

/* ── YouTube Discover ── */
let discoverSearchTimer;

async function runDiscoverSearch(appendMode = false, pageToken = null) {
  const q = document.getElementById('discover-input').value.trim();
  if (!q) return;
  // Sync clear button visibility (handles programmatic value sets)
  document.getElementById('discover-clear-btn').style.display = q ? '' : 'none';

  // Capture isRelated flag before resetting it
  const isRelated = !!(state._isRelatedSearch);
  state._isRelatedSearch = false;

  // Save to search history (skip operator-only or related searches)
  if (!appendMode && !isRelated) {
    const clean = q.replace(/\b(in:transcripts|in:current|duration:\w+|order:\w+|from:\S+)\b/gi, '').trim();
    if (clean.length > 2) saveDiscoverHistory(clean);
  }
  const statusEl = document.getElementById('discover-status');

  // Hide back bar when user runs a fresh manual search (not a related search)
  if (!appendMode && !isRelated) {
    document.getElementById('related-back-bar').style.display = 'none';
    state._relatedPrevQuery = null;
  }

  // Always clear results immediately before any async work to prevent accumulation
  state.discoverAllResults = [];
  state.discoverNextPageToken = null;

  if (!appendMode) {
    statusEl.textContent = 'Searching…';
    document.getElementById('discover-results').innerHTML = '';
  } else {
    statusEl.textContent = 'Loading more…';
  }

  const params = new URLSearchParams({ q, limit: 50, order: state.discoverOrder });
  if (state.discoverChannel) params.set('channel', state.discoverChannel);
  if (state.discoverChannelId) params.set('channel_id', state.discoverChannelId);
  if (state.discoverMode === 'teachers') params.set('teachers_only', 'true');
  if (pageToken) params.set('page_token', pageToken);

  try {
    const data = await api.get(`/api/search/youtube?${params}`);
    const videos = Array.isArray(data) ? data : (data.videos || []);
    const apiAvailable = Array.isArray(data) ? false : (data.api_available || false);
    const nextToken = data.next_page_token || null;
    const channelScoped = data.channel_scoped || !!state.discoverChannel;
    const opsApplied = data.operators_applied || {};

    if (appendMode) {
      state.discoverAllResults = [...state.discoverAllResults, ...videos];
    } else {
      state.discoverAllResults = videos;
    }
    state.discoverNextPageToken = nextToken;
    state.discoverIsChannelScoped = channelScoped;

    updateSortVisibility(apiAvailable);
    updateLoadMoreBtn(nextToken, channelScoped);

    // Build status label from parsed operators
    const cleanQ = data.clean_q || opsApplied.clean_q || q;
    const chLabel = (state.discoverChannel && state.discoverChannel.toLowerCase() !== cleanQ.toLowerCase())
      ? ` · "${state.discoverChannel}"` : '';
    const opParts = [];
    if (opsApplied.order) opParts.push(`sorted by ${opsApplied.order}`);
    if (opsApplied.duration) opParts.push(`${opsApplied.duration} videos`);
    if (opsApplied.channel && !state.discoverChannel) opParts.push(`from ${opsApplied.channel}`);
    const opLabel = opParts.length ? ` · ${opParts.join(', ')}` : '';
    state._lastSearchLabel = `"${cleanQ}"${chLabel}${opLabel}`;

    // Sync sort chip UI if order operator was parsed
    if (opsApplied.order && opsApplied.order !== state.discoverOrder) {
      state.discoverOrder = opsApplied.order;
      document.querySelectorAll('.sort-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.order === opsApplied.order));
    }

    if (!apiAvailable && state.discoverOrder !== 'relevance') {
      const statusEl2 = document.getElementById('discover-status');
      if (statusEl2) statusEl2.textContent += ' (sorting unavailable — API limit)';
    }
    applyDiscoverFilters(); // sets final status line with filter-aware counts
  } catch (e) {
    statusEl.textContent = `Search failed: ${e.message || 'check console'}`;
    statusEl.style.color = 'var(--skip)';
    setTimeout(() => { statusEl.style.color = ''; }, 4000);
  }
}

function updateLoadMoreBtn(nextToken, channelScoped) {
  let btn = document.getElementById('load-more-btn');
  if (!nextToken || !channelScoped) {
    if (btn) btn.style.display = 'none';
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'load-more-btn';
    btn.textContent = 'Load more';
    btn.onclick = () => runDiscoverSearch(true, state.discoverNextPageToken);
    document.getElementById('discover-results').after(btn);
  }
  btn.style.display = 'block';
  btn.textContent = 'Load more';
}

function applyDiscoverFilters() {
  let results = [...state.discoverAllResults];

  // Duration filter — client-side on cached results
  const dur = state.discoverDuration;
  if (dur === 'short') {
    results = results.filter(v => v.duration_seconds < 600);
  } else if (dur === 'medium') {
    results = results.filter(v => v.duration_seconds >= 600 && v.duration_seconds <= 1800);
  } else if (dur === 'long') {
    results = results.filter(v => v.duration_seconds > 1800);
  } else if (dur === 'custom') {
    const min = parseInt(document.getElementById('disc-custom-dur-min').value) || 0;
    const maxVal = document.getElementById('disc-custom-dur-max').value;
    const max = maxVal ? parseInt(maxVal) : Infinity;
    results = results.filter(v => v.duration_seconds >= min * 60 && v.duration_seconds <= max * 60);
  }

  // Sort — client-side on cached results
  const dir = state.discoverOrderDir === 'asc' ? 1 : -1;
  if (state.discoverOrder === 'viewCount') {
    results.sort((a, b) => dir * ((a.view_count || 0) - (b.view_count || 0)));
  } else if (state.discoverOrder === 'date') {
    results.sort((a, b) => dir * (a.published_at || '').localeCompare(b.published_at || ''));
  }

  // Update status line to reflect active filters
  const statusEl = document.getElementById('discover-status');
  if (statusEl && state.discoverAllResults.length) {
    const total = state.discoverAllResults.length;
    const filtered = results.length;
    const durLabel = { short: ' · <10m', medium: ' · 10-30m', long: ' · 30m+' }[dur] || '';
    // Only show sort label when not default relevance and user explicitly sorted
    const sortLabel = state.discoverOrder === 'viewCount'
      ? (state.discoverOrderDir === 'asc' ? ' · least viewed' : ' · most viewed')
      : state.discoverOrder === 'date'
      ? (state.discoverOrderDir === 'asc' ? ' · oldest' : ' · recent')
      : '';
    const searchLabel = state._lastSearchLabel || `"${document.getElementById('discover-input').value.trim()}"`;
    const countLabel = filtered < total ? `${filtered} of ${total}` : `${total}`;
    statusEl.textContent = `${countLabel} results for ${searchLabel}${durLabel}${sortLabel}`;
  }

  renderDiscoverResults(results);
}

function updateSortVisibility(apiAvailable) {
  const sortRow = document.getElementById('teachers-sort-row');
  if (!sortRow) return;
  sortRow.style.display = 'flex';
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const isViewCount = btn.dataset.order === 'viewCount';
    const isDate = btn.dataset.order === 'date';
    const needsApi = isViewCount || isDate;
    btn.disabled = needsApi && !apiAvailable;
    btn.style.opacity = (needsApi && !apiAvailable) ? '0.4' : '';
    if (needsApi && !apiAvailable) {
      btn.title = 'YouTube API required — rate limit may have been reached';
    } else {
      btn.title = '';
    }
  });
}

function renderDiscoverResults(results) {
  const container = document.getElementById('discover-results');
  container.innerHTML = '';

  // Channel filter chip
  const chipRow = document.createElement('div');
  chipRow.className = 'channel-chip-row';
  if (state.discoverChannel) {
    const chip = document.createElement('span');
    chip.className = 'channel-chip active';
    chip.innerHTML = `📺 ${state.discoverChannel} <button class="chip-clear" title="Clear channel filter">✕</button>`;
    chip.querySelector('.chip-clear').onclick = () => {
      state.discoverChannel = null;
      state.discoverChannelId = null;
      state.discoverAllResults = [];
      runDiscoverSearch();
    };
    chipRow.appendChild(chip);
  }
  container.appendChild(chipRow);

  if (!results.length) {
    container.innerHTML += '<p style="padding:12px;color:var(--text2);font-size:12px">No results found.</p>';
    return;
  }

  // Build library lookup: youtube_id → [{id, playlist_id, playlist_name}]
  const inLibrary = {};
  state.videos.forEach(v => {
    if (!inLibrary[v.youtube_id]) inLibrary[v.youtube_id] = [];
    inLibrary[v.youtube_id].push({
      id: v.id,
      playlist_id: v.playlist_id,
      playlist_name: state.playlists.find(p => p.id === v.playlist_id)?.name || '?',
    });
  });

  results.forEach(v => {
    const card = document.createElement('div');
    card.className = 'discover-card';
    const isPreviewing = state.previewVideo?.youtube_id === v.youtube_id;
    const saved = inLibrary[v.youtube_id] || [];
    const isSaved = saved.length > 0;

    const isPlaying = isPreviewing && state.ytPlayer?.getPlayerState?.() === YT.PlayerState.PLAYING;
    const previewLabel = isPreviewing ? (isPlaying ? '⏸ Previewing' : '▶ Previewing') : '▶ Preview';    const previewClass = isPreviewing ? 'discover-preview-btn previewing-active' : 'discover-preview-btn';

    // Playlist membership line (shown below buttons when saved)
    const savedLine = isSaved
      ? `<div class="discover-saved-line">📁 ${saved.map(s => s.playlist_name).join(', ')}</div>`
      : '';

    // Trust state for this channel
    const isFollowing = state.trustedTeachers.some(t => t.name === v.channel || t.channel_id === v.channel_id);
    const followBtn = v.channel
      ? `<button class="follow-btn ${isFollowing ? 'following' : ''}">${isFollowing ? 'Following ✓' : '+ Follow'}</button>`
      : '';

    card.innerHTML = `
      <img class="discover-thumb" src="${v.thumbnail}" alt="" loading="lazy" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" />
      <div class="discover-info">
        <div class="discover-title">${v.title}</div>
        <div class="discover-meta">
          ${fmtDuration(v.duration_seconds)}
          ${v.view_count ? ` · ${_fmtViews(v.view_count)} views` : ''}
          ${v.channel ? ` · <button class="channel-link" data-channel="${v.channel}">${v.channel}</button>` : ''}
        </div>
      </div>
      <div class="discover-actions">
        <button class="discover-add-btn ${isSaved ? 'added' : ''}">${isSaved ? '✓ Added' : '＋ Add'}</button>
        <button class="${previewClass}">${previewLabel}</button>
        ${followBtn}
        ${savedLine}
        <button class="discover-remove-btn" title="Remove from results" style="margin-left:auto">✕</button>
      </div>`;

    const chBtn = card.querySelector('.channel-link');
    if (chBtn) {
      chBtn.onclick = (e) => {
        e.stopPropagation();
        state.discoverChannel = v.channel;
        state.discoverChannelId = v.channel_id || null;
        // Reset sort to relevance for channel searches
        state.discoverOrder = 'relevance';
        state.discoverOrderDir = 'desc';
        document.querySelectorAll('.sort-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.order === 'relevance');
          const origLabels = { relevance: 'Relevant', viewCount: 'Most Viewed', date: 'Recent' };
          if (origLabels[b.dataset.order]) b.textContent = origLabels[b.dataset.order];
        });
        runDiscoverSearch();
      };
    }

    card.querySelector('.discover-add-btn').onclick = (e) => {
      e.stopPropagation();
      if (isSaved) showLibraryActionMenu(v, saved, e.currentTarget);
      else showPlaylistPicker(v, e.currentTarget);
    };

    card.querySelector('.' + previewClass.split(' ')[0]).onclick = (e) => {
      e.stopPropagation();
      // Check live state — not the stale closure value of isPreviewing
      const stillPreviewing = state.previewVideo?.youtube_id === v.youtube_id;
      if (stillPreviewing) {
        togglePlayPause(); // onStateChange will update the button label reliably
      } else {
        openPreview(v);
      }
    };

    card.querySelector('.discover-remove-btn').onclick = (e) => {
      e.stopPropagation();
      if (isPreviewing) closePreview();
      state.discoverAllResults = state.discoverAllResults.filter(r => r.youtube_id !== v.youtube_id);
      applyDiscoverFilters();
    };

    // Clicking anywhere on the card opens the preview (action buttons stop propagation)
    card.onclick = () => {
      const stillPreviewing = state.previewVideo?.youtube_id === v.youtube_id;
      if (stillPreviewing) togglePlayPause();
      else openPreview(v);
    };

    // Follow/Unfollow button
    const followBtnEl = card.querySelector('.follow-btn');
    if (followBtnEl) {
      followBtnEl.onclick = async (e) => {
        e.stopPropagation();
        if (isFollowing) {
          await unfollowChannel(v.channel);
        } else {
          await followChannel(v.channel_id || v.channel, v.channel, v.thumbnail);
        }
      };
    }

    container.appendChild(card);
  });
}

function _fmtViews(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function showLibraryActionMenu(video, savedEntries, anchorEl) {
  document.querySelectorAll('.library-action-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'library-action-menu playlist-picker';
  menu.addEventListener('click', e => e.stopPropagation()); // prevent outer close listener

  savedEntries.forEach(entry => {
    const lbl = document.createElement('div');
    lbl.className = 'playlist-picker-item playlist-picker-label';
    lbl.textContent = `In: ${entry.playlist_name}`;
    menu.appendChild(lbl);

    const moveBtn = document.createElement('div');
    moveBtn.className = 'playlist-picker-item';
    moveBtn.textContent = 'Move to…';
    moveBtn.onclick = () => {
      menu.remove();
      showPlaylistPicker(video, anchorEl, false, entry);
    };
    menu.appendChild(moveBtn);

    const removeBtn = document.createElement('div');
    removeBtn.className = 'playlist-picker-item danger';
    removeBtn.textContent = `Remove from ${entry.playlist_name}`;
    removeBtn.onclick = async () => {
      menu.remove();
      try {
        await api.del(`/api/videos/${entry.id}`);
        await loadVideos();
        applyDiscoverFilters();
        toast(`Removed from "${entry.playlist_name}"`);
      } catch (e) {
        toast('Error removing video');
      }
    };
    menu.appendChild(removeBtn);

    if (savedEntries.length > 1) {
      const sep = document.createElement('div');
      sep.className = 'playlist-picker-sep';
      menu.appendChild(sep);
    }
  });

  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'playlist-picker-item';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => menu.remove();
  menu.appendChild(cancelBtn);

  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.appendChild(menu);
  setTimeout(() => { document.addEventListener('click', () => menu.remove(), { once: true }); }, 0);
}

function showPlaylistPicker(video, anchorEl, fromPreview = false, moveFrom = null) {
  document.querySelectorAll('.playlist-picker').forEach(el => el.remove());
  if (!state.playlists.length) { toast('Create a playlist first'); return; }

  const picker = document.createElement('div');
  picker.className = 'playlist-picker';

  state.playlists.forEach(pl => {
    if (moveFrom && pl.id === moveFrom.playlist_id) return; // skip current playlist in move
    const item = document.createElement('div');
    item.className = 'playlist-picker-item';
    item.textContent = pl.name;
    item.onclick = async () => {
      picker.remove();
      try {
        await api.post('/api/videos', { url: video.url, playlist_id: pl.id });
        // If moving, remove from old playlist
        if (moveFrom) {
          await api.del(`/api/videos/${moveFrom.id}`);
          toast(`Moved to "${pl.name}"`);
        } else {
          toast(`Added to "${pl.name}" — fetching metadata…`);
        }
        await loadVideos();
        applyDiscoverFilters();
        if (fromPreview) {
          closePreview();
          // Switch to Library tab
          state.activePanel = 'library';
          document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'library'));
          document.getElementById('library-view').style.display = 'flex';
          document.getElementById('discover-view').style.display = 'none';
          document.getElementById('btn-new-playlist').style.display = '';
        }
        // Poll for enrichment
        const added = state.videos.find(v => v.youtube_id === video.youtube_id && v.playlist_id === pl.id);
        if (added && !moveFrom) {
          let tries = 0;
          const poll = setInterval(async () => {
            tries++;
            const updated = await api.get(`/api/videos/${added.id}`);
            if (updated.title !== 'Loading...' || tries > 20) {
              clearInterval(poll);
              state.videos = state.videos.map(v => v.id === updated.id ? updated : v);
              renderLibrary();
            }
          }, 2000);
        }
      } catch (e) {
        const msg = e.message || '';
        toast(msg.includes('409') ? 'Already in that playlist' : 'Error adding video');
      }
    };
    picker.appendChild(item);
  });

  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${rect.left}px`;
  document.body.appendChild(picker);
  setTimeout(() => { document.addEventListener('click', () => picker.remove(), { once: true }); }, 0);
}

document.getElementById('btn-discover-search').addEventListener('click', runDiscoverSearch);
document.getElementById('discover-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { document.getElementById('search-hint').style.display = 'none'; runDiscoverSearch(); }
  if (e.key === 'Escape') {
    document.getElementById('search-hint').style.display = 'none';
    clearDiscoverSearch();
  }
});
document.getElementById('discover-input').addEventListener('input', (e) => {
  document.getElementById('discover-clear-btn').style.display = e.target.value ? '' : 'none';
});
/* ── Discover search history ── */
function saveDiscoverHistory(q) {
  const history = getDiscoverHistory();
  const filtered = history.filter(h => h !== q);
  filtered.unshift(q);
  localStorage.setItem('yl_search_history', JSON.stringify(filtered.slice(0, 10)));
  renderSearchHistory();
}

function getDiscoverHistory() {
  try { return JSON.parse(localStorage.getItem('yl_search_history') || '[]'); } catch { return []; }
}

function renderSearchHistory() {
  const hint = document.getElementById('search-hint');
  const existingHistory = hint.querySelector('.search-history-section');
  if (existingHistory) existingHistory.remove();

  const history = getDiscoverHistory();
  if (!history.length) return;

  const section = document.createElement('div');
  section.className = 'search-history-section';
  const label = document.createElement('div');
  label.className = 'search-history-label';
  label.textContent = 'Recent searches';
  section.appendChild(label);

  history.slice(0, 5).forEach(q => {
    const row = document.createElement('div');
    row.className = 'hint-row search-history-row';
    row.innerHTML = `<span class="history-icon">🕐</span><span>${q}</span>`;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.getElementById('discover-input').value = q;
      document.getElementById('search-hint').style.display = 'none';
      runDiscoverSearch();
    });
    section.appendChild(row);
  });

  hint.appendChild(section);
}

document.getElementById('discover-input').addEventListener('focus', () => {
  renderSearchHistory();
  document.getElementById('search-hint').style.display = 'block';
});
document.getElementById('discover-input').addEventListener('blur', (e) => {
  setTimeout(() => { document.getElementById('search-hint').style.display = 'none'; }, 150);
});

document.getElementById('discover-clear-btn').addEventListener('click', clearDiscoverSearch);

function clearDiscoverSearch() {
  document.getElementById('discover-input').value = '';
  document.getElementById('discover-clear-btn').style.display = 'none';
  document.getElementById('discover-status').textContent = '';
  document.getElementById('discover-results').innerHTML = '';
  const loadMore = document.getElementById('load-more-btn');
  if (loadMore) loadMore.style.display = 'none';
  state.discoverAllResults = [];
  state.discoverNextPageToken = null;
  state.discoverChannel = null;
  state.discoverChannelId = null;
  // Re-render following pills (clears active state)
  renderFollowingPills();
}

// Hint row click — insert operator into search box
document.querySelectorAll('.hint-row').forEach(row => {
  row.addEventListener('mousedown', (e) => {
    e.preventDefault(); // prevent blur firing before click
    const op = row.dataset.op;
    const input = document.getElementById('discover-input');
    const current = input.value.trim();
    // Don't add duplicate operators
    if (!current.includes(op.split(':')[0] + ':')) {
      input.value = current ? `${current} ${op}` : op;
    }
    input.focus();
    if (!op.endsWith(':')) { // if no value needed, run search immediately
      runDiscoverSearch();
    }
  });
});

// Discover duration filter — client-side on cached results, no re-fetch
document.querySelectorAll('.disc-dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.discoverDuration = btn.dataset.dur;
    document.querySelectorAll('.disc-dur-btn').forEach(b => b.classList.toggle('active', b === btn));
    const customRow = document.getElementById('disc-custom-duration-row');
    customRow.style.display = state.discoverDuration === 'custom' ? 'flex' : 'none';
    if (state.discoverDuration !== 'custom') applyDiscoverFilters();
  });
});

document.getElementById('disc-custom-dur-apply').addEventListener('click', () => applyDiscoverFilters());
document.getElementById('disc-custom-dur-min').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyDiscoverFilters(); });
document.getElementById('disc-custom-dur-max').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyDiscoverFilters(); });

/* ── Help overlay ── */
function toggleHelp() {
  const el = document.getElementById('help-overlay');
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
document.getElementById('btn-close-help').addEventListener('click', toggleHelp);
document.getElementById('help-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('help-overlay')) toggleHelp();
});

/* ── Server heartbeat — close tab when server shuts down ── */
(function() {
  let missedBeats = 0;
  setInterval(async () => {
    try {
      const r = await fetch('/api/playlists', { cache: 'no-store' });
      if (r.ok) missedBeats = 0;
      else { missedBeats++; if (missedBeats >= 2) window.close(); }
    } catch (e) {
      missedBeats++;
      if (missedBeats >= 2) window.close();
    }
  }, 3000);
})();

/* ── Ollama availability check ── */
(async function checkOllama() {
  try {
    const r = await fetch('/api/videos/semantic-tags?youtube_id=_check', { cache: 'no-store' });
    const d = await r.json();
    state.ollamaAvailable = d.available !== false;
  } catch (e) {
    state.ollamaAvailable = false;
  }
  // Update What's next button tooltip
  const btn = document.getElementById('btn-whats-next');
  if (btn && !state.ollamaAvailable) {
    btn.title = 'Requires Ollama (not running). Install from ollama.com then run: ollama pull gemma3:4b';
    btn.style.opacity = '0.5';
  }
  // Re-evaluate detect questions bar now that Ollama status is known
  updateDetectQuestionsBar();
})();

/* ── Detect questions button ── */
function updateDetectQuestionsBar() {
  const bar = document.getElementById('questions-detect-bar');
  if (!bar) return;
  // Show for Library videos (not preview). Hide only if Ollama is explicitly known unavailable.
  const visible = !!state.activeVideoId && !state.previewVideo && state.ollamaAvailable !== false;
  bar.style.display = visible ? 'block' : 'none';
  // If Ollama unavailable, update button to explain why
  const btn = document.getElementById('btn-detect-questions');
  if (btn && state.ollamaAvailable === false) {
    btn.textContent = '✦ Detect questions (requires Ollama)';
    btn.title = 'Install Ollama and run: ollama pull gemma3:4b';
    btn.style.opacity = '0.5';
    bar.style.display = 'block'; // still show it, just greyed out
  }
}

document.getElementById('btn-detect-questions').addEventListener('click', async function () {
  const btn = this;
  const isReanalyse = btn.dataset.state === 'done';
  const video = state.videos.find(v => v.id === state.activeVideoId);
  if (!video) return;

  btn.disabled = true;
  btn.textContent = 'Analysing transcript…';

  try {
    const result = await api.post('/api/notes/detect-questions', {
      video_id: video.id,
      youtube_id: video.youtube_id,
      force: isReanalyse,
    });
    await loadClipsAndNotes();
    const n = result.count || 0;
    btn.dataset.state = 'done';
    btn.textContent = `✓ ${n} question${n === 1 ? '' : 's'} detected · Re-analyse`;
    btn.disabled = false;
    if (n > 0) switchTab('questions');
  } catch (e) {
    btn.textContent = '✦ Detect questions in transcript';
    btn.disabled = false;
    toast('Question detection failed — is Ollama running?');
  }
});
