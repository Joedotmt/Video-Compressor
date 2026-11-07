import { clamp, previewGeometry, zoomPreviewAt } from './edits.js';
const $ = id => document.getElementById(id);

// A source-coordinate camera. Crop edits and camera movement are independent.
export class PreviewView {
  constructor(editor) {
    this.editor = editor;
    this.viewport = $('preview-viewport');
    this.points = new Map();
    this.reset();
    this.bind();
  }
  reset() {
    this.scale = null; this.center = null; this.geometry = null; this.gesture = null;
    this.points.clear(); this.viewport.classList.remove('panning'); this.setTool('crop');
  }
  setTool(tool) {
    this.tool = tool;
    $('preview-crop-tool').setAttribute('aria-pressed', tool === 'crop');
    $('preview-hand-tool').setAttribute('aria-pressed', tool === 'hand');
    this.viewport.classList.toggle('hand-tool', tool === 'hand');
  }
  dimensions() { return { width: this.viewport.clientWidth, height: this.viewport.clientHeight }; }
  render() {
    const source = this.editor.source, view = this.dimensions();
    if (!source || !view.width || !view.height) return;
    this.geometry = previewGeometry(source, view.width, view.height, this.scale, this.center);
    if (this.geometry.scale <= this.geometry.fitScale * (1 + 1e-9)) {
      this.scale = null; this.center = null;
    } else {
      this.scale = this.geometry.scale; this.center = this.geometry.center;
    }
    this.editor.previewZoom = this.geometry.scale;
    for (const key of ['width', 'height', 'left', 'top']) $('video-stage').style[key] = `${this.geometry[key]}px`;
    if (document.activeElement !== $('preview-zoom')) $('preview-zoom').value = Number((this.geometry.scale * 100).toFixed(2));
    $('preview-zoom').min = Number((this.geometry.fitScale * 100).toFixed(2));
    $('preview-zoom').max = Math.max(6400, this.geometry.fitScale * 100);
    $('preview-zoom-out').disabled = this.scale === null;
    $('preview-fit').setAttribute('aria-pressed', this.scale === null);
  }
  fit() {
    if (this.editor.busy || this.editor.cropDragging) return;
    this.scale = null; this.center = null; this.render();
  }
  zoom(scale, anchor = null) {
    if (this.editor.busy || this.editor.cropDragging) return;
    this.render();
    if (!this.geometry) return;
    const view = this.dimensions();
    anchor ||= { x: view.width / 2, y: view.height / 2 };
    if (scale <= this.geometry.fitScale) { this.fit(); return; }
    scale = Math.min(scale, Math.max(64, this.geometry.fitScale));
    this.center = zoomPreviewAt(this.geometry, anchor, view, scale);
    this.scale = scale; this.render();
  }
  relative(event) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  begin(event) {
    if (event.target?.closest('.crop-inspector')) return;
    if (this.editor.busy || !this.editor.source || ![0, 1].includes(event.button)) return;
    this.render(); if (!this.geometry) return;
    const point = this.relative(event);
    if (event.pointerType === 'touch') this.points.set(event.pointerId, point);
    if (this.points.size === 2) {
      this.editor.finishCropDrag?.();
      const [a, b] = [...this.points.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: this.geometry.scale,
        source: { x: (mid.x - this.geometry.left) / this.geometry.scale, y: (mid.y - this.geometry.top) / this.geometry.scale } };
      for (const id of this.points.keys()) this.viewport.setPointerCapture(id);
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (event.button === 1 || this.tool === 'hand' || this.editor.spaceHeld) {
      this.editor.spaceUsed = true;
      const source = this.editor.source;
      this.gesture = { kind: 'pan', id: event.pointerId, point, scale: this.geometry.scale,
        center: this.center ? { ...this.center } : { x: source.width / 2, y: source.height / 2 } };
      this.viewport.setPointerCapture(event.pointerId);
      this.viewport.classList.add('panning');
      event.preventDefault(); event.stopPropagation();
    } else if (event.pointerType === 'touch') $('crop-box').focus({ preventScroll: true });
  }
  move(event) {
    if (this.points.has(event.pointerId)) this.points.set(event.pointerId, this.relative(event));
    if (!this.gesture || this.editor.busy) return;
    const gesture = this.gesture;
    if (gesture.kind === 'pan' && gesture.id === event.pointerId) {
      const point = this.relative(event);
      this.scale = gesture.scale;
      this.center = { x: gesture.center.x - (point.x - gesture.point.x) / gesture.scale,
        y: gesture.center.y - (point.y - gesture.point.y) / gesture.scale };
    } else if (gesture.kind === 'pinch' && this.points.size === 2) {
      const [a, b] = [...this.points.values()], view = this.dimensions();
      this.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, this.geometry.fitScale, Math.max(64, this.geometry.fitScale));
      this.center = { x: gesture.source.x - ((a.x + b.x) / 2 - view.width / 2) / this.scale,
        y: gesture.source.y - ((a.y + b.y) / 2 - view.height / 2) / this.scale };
    } else return;
    event.preventDefault(); event.stopPropagation(); this.render();
  }
  end(event) {
    this.points.delete(event.pointerId);
    if (this.gesture?.id === event.pointerId || this.gesture?.kind === 'pinch') this.gesture = null;
    this.viewport.classList.remove('panning');
  }
  bind() {
    $('preview-crop-tool').onclick = () => { this.setTool('crop'); this.viewport.focus({ preventScroll: true }); };
    $('preview-hand-tool').onclick = () => { this.setTool('hand'); this.viewport.focus({ preventScroll: true }); };
    $('preview-fit').onclick = () => this.fit();
    $('preview-zoom-in').onclick = () => this.zoom((this.geometry?.scale || 1) * 1.25);
    $('preview-zoom-out').onclick = () => this.zoom((this.geometry?.scale || 1) / 1.25);
    $('preview-zoom').onchange = () => {
      const value = Number($('preview-zoom').value);
      const maximum = Number($('preview-zoom').max);
      if (!Number.isFinite(value) || value <= 0 || value > maximum) { this.editor.error(`Enter a positive preview zoom up to ${maximum}%.`); return; }
      this.zoom(value / 100); this.editor.error('');
      if (this.geometry) $('preview-zoom').value = Number((this.geometry.scale * 100).toFixed(2));
    };
    this.viewport.addEventListener('wheel', event => {
      if (event.target.closest('.crop-inspector')) return;
      if (this.editor.busy || this.editor.cropDragging) return;
      event.preventDefault();
      this.zoom((this.geometry?.scale || 1) * Math.exp(-clamp(event.deltaY, -100, 100) * .003), this.relative(event));
    }, { passive: false });
    this.viewport.addEventListener('pointerdown', e => this.begin(e), true);
    this.viewport.addEventListener('pointermove', e => this.move(e), true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.viewport.addEventListener(type, e => {
      if (type !== 'lostpointercapture' || e.target === this.viewport) this.end(e);
    });
    this.viewport.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  }
}
