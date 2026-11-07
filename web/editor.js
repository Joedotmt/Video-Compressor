import { TimelineNavigation } from './timeline.js';
import { PreviewView } from './preview.js';
import { expression } from './compressor.js';
import { clamp, timecode, parseTime, segmentsFromPoints, normalizeEdits, fitRatio, dragCrop, moveSegment, zoomScrollPosition, timelineGeometry } from './edits.js';
const $ = id => document.getElementById(id);
const cropFields = ['x', 'y', 'width', 'height'];
export class VideoEditor {
  constructor(onChange, onPreview) {
    this.onChange = onChange; this.source = null; this.url = null; this.busy = false;
    this.points = []; this.ranges = []; this.nextPointId = 1; this.selected = null; this.activePoint = null; this.crop = null;
    this.video = $('edit-video'); this.playhead = 0;
    this.timelineZoom = 1; this.previewZoom = 1; this.cropDragging = false;
    this.preview = new PreviewView(this);
    this.spaceHeld = false; this.spaceUsed = false; this.timelineNeedsFit = true;
    this.navigation = new TimelineNavigation(this);
    this.bind(onPreview);
  }
  reset(file, source) {
    this.dispose(); this.source = source; this.points = []; this.ranges = []; this.nextPointId = 1; this.selected = null; this.activePoint = null; this.playhead = 0;
    this.crop = { x: 0, y: 0, width: source.width, height: source.height };
    $('crop-ratio').value = '0'; $('trim-mode').value = 'keep'; $('preview-kept').checked = false;
    $('seek').max = source.duration; this.timelineZoom = 1; this.previewZoom = 1;
    this.preview.reset(); this.timelineNeedsFit = true;
    $('timeline-scroll').scrollLeft = 0;
    $('timeline-content').style.width = '100%';
    $('playhead-handle').setAttribute('aria-valuemax', source.duration);
    $('video-duration').textContent = `/ ${timecode(source.duration)}`;
    $('video-stage').style.aspectRatio = `${source.width} / ${source.height}`;

    this.setPreview(file); this.renderCrop(); this.renderSegments(); this.updateTime();
    $('edit-panel').querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    this.error('');
  }
  dispose() {
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.navigation?.finish?.(); this.finishTrimDrag?.(); this.finishCropDrag?.();
    this.url = null; this.source = null; this.preview?.reset(); this.spaceHeld = false; $('preview-viewport').classList.remove('space-pan');
  }
  setPreview(blob) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob); $('preview-unavailable').hidden = true;
    this.video.src = this.url; this.video.load();
  }
  setBusy(busy) { if (busy) { this.navigation?.finish?.(); this.finishTrimDrag?.(); } this.busy = busy; $('edit-controls').disabled = busy || !this.source; if (busy) this.video.pause(); }
  error(text = '') { $('edit-error').textContent = text; }
  getEdits() {
    if (this.points.length && !this.ranges.length) throw new Error('These points do not define a segment. Move or delete a point.');
    if ($('edit-panel').querySelector('[aria-invalid="true"]')) throw new Error('Correct the highlighted edit values.');
    return { mode: $('trim-mode').value, segments: this.segments.map(s => ({ ...s })), crop: this.hasCrop() ? { ...this.crop } : null };
  }
  hasCrop() { return !!this.source && (this.crop.x !== 0 || this.crop.y !== 0 || this.crop.width !== this.source.width || this.crop.height !== this.source.height); }
  notify() { this.onChange(); }
  position(time) {
    if (!this.source) return;
    this.playhead = clamp(time, 0, this.source.duration);
    if (this.video.readyState) this.video.currentTime = this.playhead;
    this.updateTime();
  }
  updateTime() {
    $('seek').value = this.playhead;
    if (document.activeElement !== $('playhead-time')) $('playhead-time').value = timecode(this.playhead);
    $('timeline-playhead').style.left = `${this.source ? this.timeX(this.playhead) : 0}px`;
    $('playhead-handle').setAttribute('aria-valuenow', this.playhead);
    $('playhead-handle').setAttribute('aria-valuetext', timecode(this.playhead));
  }
  async play() {
    if (this.video.paused) {
      if ($('preview-kept').checked) {
        try {
          const ranges = normalizeEdits(this.getEdits(), this.source).segments;
          if (!ranges.some(s => this.playhead >= s.start && this.playhead < s.end)) this.position((ranges.find(s => s.start > this.playhead) || ranges[0]).start);
        } catch (e) { this.error(e.message); return; }
      }
      try { await this.video.play(); } catch { this.error('Preview cannot play. Try creating a compatible preview.'); $('preview-unavailable').hidden = false; }
    } else this.video.pause();
  }
  get segments() { return this.ranges.map(({ start, end }) => ({ start, end })); }
  rebuildSegments(focusId = null) {
    const previous = this.ranges[this.selected];
    this.ranges = segmentsFromPoints(this.points, this.source.duration);
    const index = focusId !== null
      ? this.ranges.findIndex(s => s.startId === focusId || s.endId === focusId)
      : previous ? this.ranges.findIndex(s => s.startId === previous.startId && s.endId === previous.endId) : -1;
    this.selected = index < 0 ? null : index;
    this.activePoint = focusId;
  }
  addPoint(type, time = this.playhead) {
    this.finishTrimDrag?.();
    if ((type === 'in' && time >= this.source.duration) || (type === 'out' && time <= 0)) {
      this.error(type === 'in' ? 'Place In before the end of the video.' : 'Place Out after the start of the video.'); return;
    }
    const point = this.points.find(p => p.type === type && Math.abs(p.time - time) < 1e-7)
      || { id: this.nextPointId++, type, time };
    const ordered = [...this.points.filter(p => p !== point), point]
      .sort((a, b) => a.time - b.time || (a.type === b.type ? a.id - b.id : a.type === 'out' ? -1 : 1));
    let first = ordered.indexOf(point), last = first;
    // A new mark replaces adjacent marks of the same type. An opposite mark
    // separates segments, so I after O (or O before I) still starts a new range.
    while (first > 0 && ordered[first - 1].type === type) first--;
    while (last + 1 < ordered.length && ordered[last + 1].type === type) last++;
    const replaced = new Set(ordered.slice(first, last + 1));
    this.points = this.points.filter(p => !replaced.has(p));
    this.points.push(point);
    this.rebuildSegments(point.id); this.error(''); this.renderSegments(); this.notify();
  }
  markIn() { this.addPoint('in'); }
  markOut() { this.addPoint('out'); }
  remove(index) {
    // Keep the other displayed ranges unchanged, including inferred source edges.
    const remaining = this.ranges.filter((_, i) => i !== index);
    this.points = remaining.flatMap(s => [
      { id: this.nextPointId++, type: 'in', time: s.start },
      { id: this.nextPointId++, type: 'out', time: s.end }
    ]);
    this.selected = null; this.activePoint = null; this.rebuildSegments();
    this.error(''); this.renderSegments(); this.notify();
  }
  deleteSelection() {
    if (this.selected !== null) this.remove(this.selected);
    else if (this.activePoint !== null) {
      this.points = this.points.filter(p => p.id !== this.activePoint);
      this.rebuildSegments(); this.error(''); this.renderSegments(); this.notify();
    }
  }
  split() {
    const range = this.ranges.find(s => s.start < this.playhead && s.end > this.playhead);
    if ((!range && this.points.length) || this.playhead <= 0 || this.playhead >= this.source.duration) {
      this.error('Move the playhead inside a segment to split it.'); return;
    }
    if (!this.points.length) this.points.push({ id: this.nextPointId++, type: 'in', time: 0 });
    this.points.push({ id: this.nextPointId++, type: 'out', time: this.playhead });
    const point = { id: this.nextPointId++, type: 'in', time: this.playhead }; this.points.push(point);
    this.rebuildSegments(point.id); this.error(''); this.renderSegments(); this.notify();
  }
  selectSegment(index) {
    this.selected = index; this.activePoint = null; this.error(''); this.renderSegments(); this.notify();
  }
  renderInspector() {
    const segment = this.ranges[this.selected];
    const point = this.points.find(p => p.id === this.activePoint);
    $('segment-heading').textContent = segment ? `Segment ${this.selected + 1}` : point ? `${point.type === 'in' ? 'In' : 'Out'} Point` : 'Segment';
    $('segment-empty').hidden = !!segment || !!point;
    $('segment-fields').hidden = !segment; $('point-fields').hidden = !!segment || !point;
    $('delete-segment').disabled = !segment && !point;
    for (const [key, id] of [['start', 'segment-in'], ['end', 'segment-out']]) {
      $(id).removeAttribute('aria-invalid');
      $(id).value = segment ? timecode(segment[key]) : '';
    }
    $('point-time').removeAttribute('aria-invalid');
    if (segment) $('segment-duration').textContent = timecode(segment.end - segment.start);
    else if (point) { $('point-label').textContent = point.type === 'in' ? 'In' : 'Out'; $('point-time').value = timecode(point.time); }
  }
  renderSegments() {
    const track = $('timeline-segments'), markers = $('timeline-points'); track.replaceChildren(); markers.replaceChildren();
    this.ranges.forEach((segment, index) => {
      const bar = document.createElement('div'); bar.className = 'timeline-segment';
      bar.classList.toggle('selected', this.selected === index); bar.classList.toggle('removed', $('trim-mode').value === 'remove');
      bar.dataset.index = index;
      const body = document.createElement('button'); body.type = 'button'; body.textContent = String(index + 1);
      body.setAttribute('aria-label', `Select segment ${index + 1}`); body.setAttribute('aria-pressed', this.selected === index);
      body.onpointerdown = event => this.dragSegment(event, index);
      body.onclick = () => this.selectSegment(index); bar.append(body); track.append(bar);
    });
    // Actual points remain visible even if another point currently supersedes them.
    // The inferred 0/end boundaries can also be dragged to create explicit points.
    const handles = this.points.map(point => ({ point, index: this.ranges.findIndex(s => s.startId === point.id || s.endId === point.id) }));
    this.ranges.forEach((s, index) => {
      if (s.startId === null) handles.push({ point: { id: null, type: 'in', time: s.start }, index });
      if (s.endId === null) handles.push({ point: { id: null, type: 'out', time: s.end }, index });
    });
    for (const { point, index } of handles) {
      const key = point.type === 'in' ? 'start' : 'end';
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = `trim-handle ${key}`;
      handle.style.left = `${this.timeX(point.time)}px`;
      handle.dataset.time = point.time; handle.dataset.pointId = point.id ?? '';
      handle.title = `${point.type === 'in' ? 'In' : 'Out'} ${timecode(point.time)}`;
      handle.setAttribute('aria-label', index < 0 ? `Drag ${point.type} point at ${timecode(point.time)}` : `Drag segment ${index + 1} ${point.type === 'in' ? 'In' : 'Out'} point`);
      handle.classList.toggle('selected', index >= 0 && this.selected === index || this.activePoint === point.id && point.id !== null);
      handle.onpointerdown = event => this.dragPoint(event, point, index);
      handle.onclick = () => { if (index >= 0) this.selectSegment(index); else { this.selected = null; this.activePoint = point.id; this.error(''); this.renderSegments(); this.notify(); } };
      handle.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || this.busy) return;
        event.preventDefault(); event.stopPropagation();
        const id = this.ensurePoint(point);
        this.movePoint(id, point.time + (event.shiftKey ? 1 : 1 / this.source.fps) * (event.key === 'ArrowLeft' ? -1 : 1), this.pointBounds(point, index));
        this.renderSegments(); this.notify();
        $('timeline-points').querySelector(`[data-point-id="${id}"]`)?.focus();
      };
      markers.append(handle);
    }
    this.layoutTimeline(); this.renderInspector();
    try {
      if (this.points.length && !this.ranges.length) throw new Error('These points do not define a segment.');
      const edit = normalizeEdits({ segments: this.segments, mode: $('trim-mode').value }, this.source);
      $('trim-summary').textContent = this.points.length ? `${timecode(edit.duration)} kept · ${edit.segments.length} output segment${edit.segments.length === 1 ? '' : 's'}` : 'No cuts. The full video will be kept.';
    } catch (e) { $('trim-summary').textContent = e.message; }
  }
  ensurePoint(point) {
    if (point.id !== null) return point.id;
    const added = { ...point, id: this.nextPointId++ }; this.points.push(added); return added.id;
  }
  pointBounds(point, index) {
    const range = this.ranges[index];
    if (!range) return [0, this.source.duration];
    const gap = Math.min(1 / this.source.fps, (range.end - range.start) / 2);
    return point.type === 'in' ? [this.ranges[index - 1]?.end ?? 0, range.end - gap] : [range.start + gap, this.ranges[index + 1]?.start ?? this.source.duration];
  }
  movePoint(id, time, bounds = [0, this.source.duration]) {
    this.points.find(p => p.id === id).time = clamp(time, ...bounds);
    this.rebuildSegments(id); this.error('');
  }
  editBoundary(key, value) {
    const segment = this.ranges[this.selected];
    if (!segment) return;
    const time = parseTime(value);
    normalizeEdits({ segments: [{ ...segment, [key]: time }] }, this.source);
    const limits = this.pointBounds({ type: key === 'start' ? 'in' : 'out' }, this.selected);
    if (time < limits[0] || time > limits[1]) throw new Error('Segments cannot overlap.');
    const id = this.ensurePoint({ id: segment[`${key}Id`], type: key === 'start' ? 'in' : 'out', time });
    this.movePoint(id, time); this.renderSegments();
  }
  dragSegment(event, index) {
    if (this.busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const viewport = $('timeline-scroll'), original = this.ranges.map(s => ({ ...s }));
    const segment = original[index], startX = event.clientX, startScroll = viewport.scrollLeft;
    const pixelsPerSecond = this.timelineMetrics().pixelsPerSecond;
    let startId = segment.startId, endId = segment.endId, moved = false;
    viewport.setPointerCapture(event.pointerId); this.trimDragging = true;
    this.selectSegment(index); viewport.classList.add('moving-segment');
    const move = e => {
      const view = viewport.getBoundingClientRect();
      if (e.clientX < view.left + 20) this.scrollTimeline(viewport.scrollLeft - 16);
      else if (e.clientX > view.right - 20) this.scrollTimeline(viewport.scrollLeft + 16);
      const pixels = e.clientX - startX + viewport.scrollLeft - startScroll;
      if (!moved && Math.abs(pixels) < 3) return;
      moved = true;
      const next = moveSegment(original, index, pixels / pixelsPerSecond, this.source.duration);
      startId = this.ensurePoint({ id: startId, type: 'in', time: segment.start });
      endId = this.ensurePoint({ id: endId, type: 'out', time: segment.end });
      this.points.find(p => p.id === startId).time = next.start;
      this.points.find(p => p.id === endId).time = next.end;
      this.rebuildSegments(startId); this.error(''); this.renderSegments(); this.notify();
    };
    const end = () => {
      viewport.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.removeEventListener(name, end);
      viewport.classList.remove('moving-segment'); this.trimDragging = false; this.finishTrimDrag = null;
    };
    this.finishTrimDrag = end;
    viewport.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, end);
  }
  dragPoint(event, point, index) {
    if (this.busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const viewport = $('timeline-scroll'), bounds = this.pointBounds(point, index);
    const id = this.ensurePoint(point), startTime = point.time, startX = event.clientX;
    const startScroll = viewport.scrollLeft, pixelsPerSecond = this.timelineMetrics().pixelsPerSecond;
    // Capture on the stable viewport so recalculating segments cannot end a drag.
    viewport.setPointerCapture(event.pointerId); this.trimDragging = true;
    this.rebuildSegments(id); this.renderSegments();
    const move = e => {
      const view = viewport.getBoundingClientRect();
      if (e.clientX < view.left + 20) this.scrollTimeline(viewport.scrollLeft - 16);
      else if (e.clientX > view.right - 20) this.scrollTimeline(viewport.scrollLeft + 16);
      this.movePoint(id, startTime + (e.clientX - startX + viewport.scrollLeft - startScroll) / pixelsPerSecond, bounds);
      this.renderSegments(); this.notify();
    };
    const end = () => {
      viewport.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.removeEventListener(name, end);
      this.trimDragging = false; this.finishTrimDrag = null; this.notify();
    };
    this.finishTrimDrag = end;
    viewport.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, end);
  }
  ratio() { return $('crop-ratio').value === 'original' ? this.source.width / this.source.height : Number($('crop-ratio').value); }
  renderCrop(updateInputs = true) {
    if (!this.source) return;
    const box = $('crop-box');
    cropFields.forEach(key => { const input = $(`crop-${key}`); if (updateInputs) { input.value = this.crop[key]; input.removeAttribute('aria-invalid'); } });
    box.style.left = `${this.crop.x / this.source.width * 100}%`; box.style.top = `${this.crop.y / this.source.height * 100}%`;
    box.style.width = `${this.crop.width / this.source.width * 100}%`; box.style.height = `${this.crop.height / this.source.height * 100}%`;
    if (!this.cropDragging) this.renderPreview();
  }
  drag(event) {
    if (this.busy || event.button !== 0) return;
    event.preventDefault(); this.video.pause();
    this.cropDragging = true; $('preview-viewport').classList.add('crop-dragging');
    const target = event.target.closest('[data-handle]') || $('crop-box'), handle = target.dataset.handle || 'move';
    const original = { ...this.crop }, rect = $('video-stage').getBoundingClientRect(), x = event.clientX, y = event.clientY;
    target.setPointerCapture(event.pointerId);
    const move = e => { this.crop = dragCrop(original, handle, (e.clientX - x) * this.source.width / rect.width, (e.clientY - y) * this.source.height / rect.height, this.source, this.ratio()); this.renderCrop(); this.notify(); };
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', end); this.cropDragging = false; $('preview-viewport').classList.remove('crop-dragging'); this.renderPreview(); this.error(''); this.notify(); this.finishCropDrag = null; };
    this.finishCropDrag = end;
    target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', end);
  }
  scrollTimeline(value) {
    const viewport = $('timeline-scroll'), width = viewport.clientWidth || 640;
    viewport.scrollLeft = clamp(value, 0, Math.max(0, this.timelineMetrics().width - width));
    this.renderRuler(); this.navigation.render();
  }
  timelineMetrics() { return timelineGeometry(this.source.duration, $('timeline-scroll').clientWidth || 640, this.timelineZoom); }
  timeX(time) { const g = this.timelineMetrics(); return g.padding + time * g.pixelsPerSecond; }
  xTime(x) { const g = this.timelineMetrics(); return (x - g.padding) / g.pixelsPerSecond; }
  layoutTimeline() {
    if (!this.source) return;
    const g = this.timelineMetrics();
    $('timeline-content').style.width = `${g.width}px`;
    $('source-clip').style.left = `${g.padding}px`; $('source-clip').style.width = `${g.clipWidth}px`;
    for (const bar of $('timeline-segments').children) {
      const segment = this.segments[Number(bar.dataset.index)];
      bar.style.left = `${this.timeX(segment.start)}px`;
      bar.style.width = `${(segment.end - segment.start) * g.pixelsPerSecond}px`;
    }
    for (const handle of $('timeline-points').children) handle.style.left = `${this.timeX(Number(handle.dataset.time))}px`;
    this.updateTime(); this.renderRuler(); this.navigation.render();
  }
  refreshView() {
    if (!this.source) return;
    this.renderPreview(); this.layoutTimeline();
    if (this.timelineNeedsFit && $('timeline-scroll').clientWidth && !this.busy) {
      this.timelineNeedsFit = false; this.zoomTimeline(1, this.source.duration / 2);
    }
  }
  zoomTimeline(zoom, time = this.playhead, anchor = null) {
    if (!this.source || this.busy || this.trimDragging) return;
    const viewport = $('timeline-scroll');
    this.timelineZoom = clamp(zoom, 1, 4096);
    this.layoutTimeline();
    const width = viewport.clientWidth || 640;
    this.scrollTimeline(zoomScrollPosition(this.timelineZoom, width, this.source.duration, time, anchor ?? width / 2));
  }
  scrub(event) {
    if (this.busy || !this.source || event.button !== 0 || !['timeline-ruler', 'playhead-handle'].includes(event.currentTarget.id)) return;
    event.preventDefault(); this.video.pause();
    const target = event.currentTarget; target.setPointerCapture(event.pointerId);
    const move = e => {
      const viewport = $('timeline-scroll'), view = viewport.getBoundingClientRect();
      if (e.clientX < view.left + 16) this.scrollTimeline(viewport.scrollLeft - 12);
      else if (e.clientX > view.right - 16) this.scrollTimeline(viewport.scrollLeft + 12);
      this.position(this.xTime(e.clientX - $('timeline-content').getBoundingClientRect().left));
    };
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('lostpointercapture', end); };
    move(event); target.addEventListener('pointermove', move); target.addEventListener('lostpointercapture', end);
  }
  renderRuler() {
    if (!this.source) return;
    const viewport = $('timeline-scroll'), ruler = $('timeline-ruler');
    const width = viewport.clientWidth;
    if (!width) return;
    const g = this.timelineMetrics(), secondsPerPixel = 1 / g.pixelsPerSecond;
    const start = this.xTime(viewport.scrollLeft), end = start + width * secondsPerPixel;
    const target = (end - start) * 110 / width;
    const intervals = [1 / this.source.fps, 2 / this.source.fps, 5 / this.source.fps, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].sort((a, b) => a - b);
    const interval = intervals.find(n => n >= target) || Math.ceil(target / 3600) * 3600;
    ruler.replaceChildren();
    for (let time = Math.ceil(start / interval) * interval; time <= end + 1e-7; time += interval) {
      const tick = document.createElement('span'); tick.textContent = `${time < -1e-7 ? '−' : ''}${timecode(Math.abs(time))}`;
      tick.style.left = `${this.timeX(time)}px`;
      tick.classList.toggle('zero', Math.abs(time) < 1e-7);
      if (time < 0 || time > this.source.duration) tick.className = 'outside';
      ruler.append(tick);
    }
  }
  renderPreview() { if (!this.cropDragging) this.preview.render(); }
  bind(onPreview) {
    $('timeline-scroll').onscroll = () => { this.renderRuler(); this.navigation.render(); };
    $('timeline-scroll').addEventListener('wheel', event => {
      if (!this.source || this.busy || event.ctrlKey || event.metaKey) return;
      const viewport = $('timeline-scroll');
      if (event.altKey) {
        event.preventDefault();
        const anchor = clamp(event.clientX - viewport.getBoundingClientRect().left, 0, viewport.clientWidth);
        const time = this.xTime(viewport.scrollLeft + anchor);
        this.zoomTimeline(this.timelineZoom * (event.deltaY < 0 ? 1.25 : .8), time, anchor);
      } else {
        event.preventDefault(); this.scrollTimeline(viewport.scrollLeft + (event.deltaX || event.deltaY));
      }
    }, { passive: false });
    $('timeline-ruler').onpointerdown = event => this.scrub(event);
    $('playhead-handle').onpointerdown = event => this.scrub(event);
    $('timeline').onclick = event => { if (!event.target.closest('button')) { this.selected = null; this.activePoint = null; this.renderSegments(); this.notify(); } };
    $('playhead-handle').onkeydown = event => {
      if (this.busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      this.position(event.key === 'Home' ? 0 : event.key === 'End' ? this.source.duration : this.playhead + (event.key === 'ArrowLeft' ? -1 : 1) / this.source.fps);
    };
    const mobile = document.defaultView?.matchMedia?.('(max-width: 760px)');
    if (mobile) {
      const updateInspector = () => this.preview.setInspectorOpen(!mobile.matches);
      updateInspector(); mobile.addEventListener('change', updateInspector);
    }
    if (globalThis.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.refreshView());
      this.resizeObserver.observe($('preview-viewport'));
      this.resizeObserver.observe($('inspector'));
      this.resizeObserver.observe($('timeline-scroll'));
    }

    $('make-preview').onclick = onPreview;
    this.video.addEventListener('error', () => { if (this.url) $('preview-unavailable').hidden = false; });
    this.video.addEventListener('loadedmetadata', () => this.position(this.playhead));
    this.video.addEventListener('play', () => { $('play').textContent = 'Pause'; });
    this.video.addEventListener('pause', () => { $('play').textContent = 'Play'; });
    this.video.addEventListener('timeupdate', () => {
      this.playhead = this.video.currentTime; this.updateTime();
      if (!this.video.paused && $('preview-kept').checked) {
        try {
          const kept = normalizeEdits(this.getEdits(), this.source).segments;
          if (!kept.some(s => this.playhead >= s.start && this.playhead < s.end)) {
            const next = kept.find(s => s.start > this.playhead);
            if (next) this.position(next.start); else this.video.pause();
          }
        } catch { this.video.pause(); }
      }
    });
    $('play').onclick = () => this.play();
    $('step-back').onclick = () => { this.video.pause(); this.position(this.playhead - 1 / this.source.fps); };
    $('step-forward').onclick = () => { this.video.pause(); this.position(this.playhead + 1 / this.source.fps); };
    $('seek').oninput = () => this.position(Number($('seek').value));
    $('playhead-time').onchange = () => { try { this.position(parseTime($('playhead-time').value)); this.error(''); } catch (e) { this.error(e.message); } };
    $('mark-in').onclick = () => this.markIn(); $('mark-out').onclick = () => this.markOut();
    $('split-segment').onclick = () => this.split();
    $('delete-segment').onclick = () => this.deleteSelection();
    for (const [key, id] of [['start', 'segment-in'], ['end', 'segment-out']]) $(id).onchange = () => {
      try { this.editBoundary(key, $(id).value); this.error(''); }
      catch (e) { $(id).setAttribute('aria-invalid', 'true'); this.error(e.message); }
      this.notify();
    };
    $('point-time').onchange = () => {
      try {
        const time = parseTime($('point-time').value);
        if (time < 0 || time > this.source.duration) throw new Error('Point must be within the video.');
        this.movePoint(this.activePoint, time); this.renderSegments();
      } catch (e) { $('point-time').setAttribute('aria-invalid', 'true'); this.error(e.message); }
      this.notify();
    };
    $('reset-trim').onclick = () => { this.points = []; this.ranges = []; this.nextPointId = 1; this.selected = null; this.activePoint = null; this.error(''); this.renderSegments(); this.notify(); };
    $('trim-mode').onchange = () => { this.renderSegments(); this.notify(); };
    $('reset-crop').onclick = () => { this.crop = { x: 0, y: 0, width: this.source.width, height: this.source.height }; $('crop-ratio').value = '0'; this.renderCrop(); this.error(''); this.notify(); };
    $('crop-ratio').onchange = () => { this.crop = fitRatio(this.source, this.ratio()); this.renderCrop(); this.error(''); this.notify(); };
    for (const key of cropFields) $(`crop-${key}`).oninput = () => {
      try {
        const next = Object.fromEntries(cropFields.map(k => [k, expression($(`crop-${k}`).value)]));
        normalizeEdits({ crop: next }, this.source); this.crop = next;
        if (['width', 'height'].includes(key)) $('crop-ratio').value = '0';
        cropFields.forEach(k => $(`crop-${k}`).removeAttribute('aria-invalid'));
        this.renderCrop(false); this.error('');
      } catch (e) { $(`crop-${key}`).setAttribute('aria-invalid', 'true'); this.error(e.message); }
      this.notify();
    };
    $('crop-box').onpointerdown = event => this.drag(event);
    $('crop-box').onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || this.busy) return;
      event.preventDefault(); event.stopPropagation(); const delta = event.shiftKey ? 10 : 1;
      this.crop = dragCrop(this.crop, event.target.dataset.handle || 'move', event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0, event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0, this.source, this.ratio());
      this.renderCrop(); this.notify();
    };
    document.addEventListener('keydown', event => {
      if ($('edit-panel').hidden || this.busy || !this.source || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input:not([type="range"]):not([type="checkbox"]), select, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      // Keep ordinary button/summary activation on Space and Enter.
      if (key === ' ' && event.target.closest('button:not(.crop-handle), summary, input[type="checkbox"]')) return;
      if (key === ' ') {
        event.preventDefault();
        if (!event.repeat) { this.spaceHeld = true; this.spaceUsed = false; $('preview-viewport').classList.add('space-pan'); }
        return;
      }
      if (event.target.matches('input[type="range"]') && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) return;
      const actions = { i: () => this.markIn(), o: () => this.markOut(), '=': () => this.zoomTimeline(this.timelineZoom * 2), '+': () => this.zoomTimeline(this.timelineZoom * 2), '-': () => this.zoomTimeline(this.timelineZoom / 2), '\\': () => this.zoomTimeline(1, this.source.duration / 2), b: () => this.split(), z: () => this.preview.fit(), h: () => this.preview.setTool('hand'), v: () => this.preview.setTool('crop'), arrowleft: () => this.position(this.playhead - (event.shiftKey ? 5 : 1)), arrowright: () => this.position(this.playhead + (event.shiftKey ? 5 : 1)), ',': () => $('step-back').click(), '.': () => $('step-forward').click(), delete: () => this.deleteSelection() };
      if (actions[key]) { event.preventDefault(); actions[key](); }
    });
    document.addEventListener('keyup', event => {
      if (event.key !== ' ' || !this.spaceHeld) return;
      event.preventDefault(); this.spaceHeld = false; $('preview-viewport').classList.remove('space-pan');
      if (!this.spaceUsed && !this.busy && !$('edit-panel').hidden) this.play();
    });
    document.defaultView?.addEventListener('blur', () => {
      this.spaceHeld = false; $('preview-viewport').classList.remove('space-pan');
    });
  }
}
