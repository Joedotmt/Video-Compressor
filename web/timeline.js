import { clamp, timecode } from './edits.js';
const $ = id => document.getElementById(id);

// The navigator represents the visible time window. Its ends resize that window.
export class TimelineNavigation {
  constructor(editor) {
    this.editor = editor; this.scroll = $('timeline-scroll'); this.bar = $('timeline-navigator');
    this.bar.addEventListener('pointerdown', event => this.dragNavigator(event));
    this.bar.addEventListener('dblclick', () => editor.zoomTimeline(1, 0, 0));
    this.scroll.addEventListener('pointerdown', event => this.pan(event), true);
    this.scroll.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
    for (const id of ['timeline-window-start', 'timeline-window-pan', 'timeline-window-end']) {
      $(id).addEventListener('keydown', event => {
        if (editor.busy || !editor.source || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const g = this.metrics(), delta = g.span * (event.shiftKey ? .1 : .02) * (event.key === 'ArrowLeft' ? -1 : 1);
        if (id === 'timeline-window-pan') editor.scrollTimeline(event.key === 'Home' ? 0 : event.key === 'End' ? g.maxScroll : this.scroll.scrollLeft + delta * g.pixelsPerSecond);
        else if (event.key === 'Home' || event.key === 'End') editor.zoomTimeline(1, 0, 0);
        else this.resize(id === 'timeline-window-start' ? 'start' : 'end', g, delta);
      });
    }
  }
  metrics() {
    const e = this.editor, g = e.timelineMetrics();
    const viewport = this.scroll.clientWidth || 640, width = this.bar.clientWidth || viewport;
    const maxScroll = Math.max(0, g.width - viewport), domain = e.source.duration / .9;
    const start = this.scroll.scrollLeft / g.pixelsPerSecond, span = viewport / g.pixelsPerSecond;
    const minimumThumb = document.defaultView?.matchMedia?.('(pointer: coarse)').matches ? 72 : 36;
    const thumbWidth = Math.min(width, Math.max(minimumThumb, width / e.timelineZoom));
    return { ...g, viewport, width, maxScroll, domain, start, span, end: start + span, thumbWidth,
      left: maxScroll ? this.scroll.scrollLeft / maxScroll * (width - thumbWidth) : 0 };
  }
  render() {
    if (!this.editor.source) return;
    const g = this.metrics();
    $('timeline-thumb').style.left = `${g.left}px`; $('timeline-thumb').style.width = `${g.thumbWidth}px`;
    for (const [id, value, max] of [['timeline-window-start', g.start, g.domain], ['timeline-window-end', g.end, g.domain], ['timeline-window-pan', g.start, Math.max(0, g.domain - g.span)]]) {
      $(id).setAttribute('aria-valuemin', '0'); $(id).setAttribute('aria-valuemax', max);
      $(id).setAttribute('aria-valuenow', value);
      $(id).setAttribute('aria-valuetext', `${timecode(g.start)} to ${timecode(g.end)}`);
    }
  }
  capture(target, event, move, cleanup = () => {}) {
    this.finish?.();
    target.setPointerCapture(event.pointerId);
    const end = () => {
      target.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) target.removeEventListener(type, end);
      cleanup(); this.finish = null;
    };
    target.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(type, end);
    this.finish = end;
  }
  pan(event) {
    const e = this.editor;
    if (event.button !== 1 || e.busy || !e.source || e.trimDragging) return;
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX, startScroll = this.scroll.scrollLeft;
    this.scroll.classList.add('panning');
    this.capture(this.scroll, event, move => e.scrollTimeline(startScroll + startX - move.clientX), () => this.scroll.classList.remove('panning'));
  }
  resize(edge, g, delta) {
    const minimum = g.domain / 4096;
    const start = edge === 'start' ? clamp(g.start + delta, 0, g.end - minimum) : g.start;
    const end = edge === 'end' ? clamp(g.end + delta, g.start + minimum, g.domain) : g.end;
    this.editor.zoomTimeline(g.domain / (end - start), start, 0);
  }
  dragNavigator(event) {
    const e = this.editor;
    if (event.button !== 0 || e.busy || !e.source || e.trimDragging) return;
    event.preventDefault();
    const g = this.metrics(), x = event.clientX, id = event.target.id;
    const edge = id === 'timeline-window-start' ? 'start' : id === 'timeline-window-end' ? 'end' : null;
    if (event.target === this.bar) {
      const offset = event.clientX - this.bar.getBoundingClientRect().left;
      e.scrollTimeline(g.maxScroll * clamp((offset - g.thumbWidth / 2) / Math.max(1, g.width - g.thumbWidth), 0, 1));
      return;
    }
    this.capture(this.bar, event, move => {
      const delta = move.clientX - x;
      if (edge) this.resize(edge, g, delta * g.span / g.thumbWidth);
      else e.scrollTimeline(g.start * g.pixelsPerSecond + delta * g.maxScroll / Math.max(1, g.width - g.thumbWidth));
    });
  }
}
