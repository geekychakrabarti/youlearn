/* YouLearn Onboarding Tour
 * Spotlight tour — shows once on first launch, relaunchable from menu bar.
 * localStorage key: 'yl_tour_done'
 */

const TOUR_STEPS = [
  {
    target: '#library-panel',
    title: 'Your Library',
    desc: 'This is your curated collection of YouTube videos. Add playlists to organise your learning — no algorithm, no distractions.',
    position: 'right',
  },
  {
    target: '.panel-tabs',
    title: 'Library & Discover',
    desc: 'Switch between your Library (curated videos) and Discover (search YouTube without distractions). Click Discover to explore new content.',
    position: 'bottom',
  },
  {
    target: '#btn-new-playlist',
    title: 'Create a Playlist',
    desc: 'Start by creating a playlist for a topic you want to learn. Add videos from Discover or paste a YouTube URL.',
    position: 'bottom',
  },
  {
    target: '#search-input',
    title: 'Search Your Library',
    desc: 'Search video titles and semantic tags. Use in:transcripts to search spoken content, or in:current to scope to the active playlist.',
    position: 'right',
  },
  {
    target: '#notes-panel',
    title: 'Notes & Clips Panel',
    desc: 'The All tab shows your chapters, clips, notes and questions in chronological order. Click any item to jump to that moment in the video.',
    position: 'left',
  },
  {
    target: '#empty-state',
    title: 'Mark as You Learn',
    desc: 'Open a video and use M to highlight · N for a note · Q for a question · S to skip. Your marks sync with the transcript automatically.',
    position: 'right',
  },
  {
    target: '#discover-view',
    title: 'Discover Without Distraction',
    desc: 'Search YouTube by topic, creator or duration. Use from:channel to follow creators, duration:short/medium to match your time, and order:views for popular content.',
    position: 'right',
    onEnter: () => {
      document.querySelector('.panel-tab[data-panel="discover"]')?.click();
    },
    onLeave: () => {
      document.querySelector('.panel-tab[data-panel="library"]')?.click();
    },
  },
];

class Tour {
  constructor() {
    this.step = 0;
    this.overlay = document.getElementById('tour-overlay');
    this.backdrop = document.getElementById('tour-backdrop');
    this.spotlight = document.getElementById('tour-spotlight');
    this.tooltip = document.getElementById('tour-tooltip');
    this.titleEl = document.getElementById('tour-title');
    this.descEl = document.getElementById('tour-desc');
    this.labelEl = document.getElementById('tour-step-label');
    this.progressEl = document.getElementById('tour-progress');
    this.nextBtn = document.getElementById('tour-next');
    this.prevBtn = document.getElementById('tour-prev');
    this.skipBtn = document.getElementById('tour-skip');

    this.nextBtn.onclick = () => this.advance(1);
    this.prevBtn.onclick = () => this.advance(-1);
    this.skipBtn.onclick = () => this.finish();
    this.backdrop.onclick = () => this.finish();

    // Keyboard navigation
    this._keyHandler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') this.advance(1);
      if (e.key === 'ArrowLeft') this.advance(-1);
      if (e.key === 'Escape') this.finish();
    };
  }

  start() {
    this.step = 0;
    this.overlay.style.display = 'block';
    document.addEventListener('keydown', this._keyHandler);
    this._render(0);
  }

  finish() {
    const current = TOUR_STEPS[this.step];
    if (current?.onLeave) current.onLeave();
    this.overlay.style.display = 'none';
    document.removeEventListener('keydown', this._keyHandler);
    document.querySelectorAll('.tour-active-target').forEach(el => el.classList.remove('tour-active-target'));
    localStorage.setItem('yl_tour_done', '1');
  }

  advance(dir) {
    const current = TOUR_STEPS[this.step];
    if (current?.onLeave) current.onLeave();
    const next = this.step + dir;
    if (next >= TOUR_STEPS.length) { this.finish(); return; }
    if (next < 0) return;
    this.step = next;
    this._render(0);
  }

  _render(depth = 0) {
    if (depth > TOUR_STEPS.length) { this.finish(); return; } // prevent infinite loop
    const s = TOUR_STEPS[this.step];
    const total = TOUR_STEPS.length;

    // Remove highlight from previous target
    document.querySelectorAll('.tour-active-target').forEach(el => el.classList.remove('tour-active-target'));

    // Fire onEnter hook if defined (e.g. switch tabs)
    if (s.onEnter) s.onEnter();

    // Skip steps that require a video if none is loaded
    const videoLoaded = document.getElementById('player-wrap')?.style.display !== 'none';
    if (s.requiresVideo && !videoLoaded) {
      this.step = this.step < TOUR_STEPS.length - 1 ? this.step + 1 : this.step - 1;
      this._render(depth + 1);
      return;
    }

    // Find target element
    const target = document.querySelector(s.target);
    if (!target) { this.step++; this._render(depth + 1); return; }

    // Lift target above the backdrop so it's visibly highlighted
    target.classList.add('tour-active-target');

    // Update tooltip content
    this.labelEl.textContent = `Step ${this.step + 1} of ${total}`;
    this.titleEl.textContent = s.title;
    this.descEl.textContent = s.desc;
    this.progressEl.textContent = `${this.step + 1} / ${total}`;
    this.nextBtn.textContent = this.step === total - 1 ? 'Done ✓' : 'Next →';
    this.prevBtn.style.visibility = this.step === 0 ? 'hidden' : 'visible';

    // Position spotlight over target
    const rect = target.getBoundingClientRect();
    const pad = 8;
    this.spotlight.style.cssText = `
      left: ${rect.left - pad}px;
      top: ${rect.top - pad}px;
      width: ${rect.width + pad * 2}px;
      height: ${rect.height + pad * 2}px;
    `;

    // Position tooltip
    this._positionTooltip(rect, s.position);

    // Scroll target into view smoothly
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _positionTooltip(targetRect, position) {
    const tt = this.tooltip;
    const pad = 16;
    const ttW = 320;

    // Reset and measure
    tt.style.left = '-9999px';
    tt.style.top = '-9999px';
    const ttH = tt.offsetHeight || 160;

    let left, top;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    switch (position) {
      case 'right':
        left = targetRect.right + pad;
        top = targetRect.top + (targetRect.height - ttH) / 2;
        break;
      case 'left':
        left = targetRect.left - ttW - pad;
        top = targetRect.top + (targetRect.height - ttH) / 2;
        break;
      case 'bottom':
        left = targetRect.left + (targetRect.width - ttW) / 2;
        top = targetRect.bottom + pad;
        break;
      case 'top':
        left = targetRect.left + (targetRect.width - ttW) / 2;
        top = targetRect.top - ttH - pad;
        break;
      default:
        left = targetRect.right + pad;
        top = targetRect.top;
    }

    // Clamp to viewport
    left = Math.max(pad, Math.min(left, vw - ttW - pad));
    top = Math.max(pad, Math.min(top, vh - ttH - pad));

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
  }
}

// Expose globally so menubar can trigger it
window.startTour = function() {
  if (!window._tour) window._tour = new Tour();
  window._tour.start();
};

// Auto-launch on first visit (no playlists = first time)
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('yl_tour_done')) {
    // Small delay so the app loads first
    setTimeout(() => window.startTour(), 1500);
  }
});

// Handle #start-tour hash from menu bar
if (window.location.hash === '#start-tour') {
  window.history.replaceState(null, '', window.location.pathname);
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.startTour(), 1000);
  });
}

// Handle #open-help hash from menu bar
if (window.location.hash === '#open-help') {
  window.history.replaceState(null, '', window.location.pathname);
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      document.getElementById('help-modal').style.display = 'flex';
    }, 1000);
  });
}
