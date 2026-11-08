import { clamp, minimumPreviewScale, previewGeometry, zoomPreviewAt, cropControlsPosition } from './edits.js';
const $ = id => document.getElementById(id);

// A source-coordinate camera with separate image stretch and viewing zoom.
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
    this.controlsHeight = 40; this.editTool = 'crop'; this.fitCrop = false;
    this.points.clear(); this.viewport.classList.remove('panning'); this.setTool('crop');
  }
  setTool(tool) {
    this.editor.finishCropDrag?.();
    this.tool = tool;
    this.editTool = tool;
    $('preview-scale-tool').setAttribute('aria-pressed', tool === 'scale');
    $('crop-fields').hidden = tool !== 'crop';
    $('scale-fields').hidden = this.editTool !== 'scale';
    this.viewport.classList.toggle('scale-tool', this.editTool === 'scale');
    for (const handle of document.querySelectorAll('.crop-handle')) handle.setAttribute('aria-label', handle.getAttribute('aria-label').replace(/Resize (crop|output)/, this.editTool === 'scale' ? 'Resize output' : 'Resize crop'));
    $('inspector').setAttribute('aria-label', this.editTool === 'scale' ? 'Scale controls' : 'Crop controls');
    $('preview-crop-tool').setAttribute('aria-pressed', tool === 'crop');
    $('preview-hand-tool').setAttribute('aria-pressed', tool === 'hand');
    this.viewport.classList.toggle('hand-tool', tool === 'hand');
    $('crop-overlay').hidden = tool === 'hand';
    $('scale-reference').hidden = tool !== 'scale';
    this.selectCrop(tool !== 'hand');
    this.render();
  }
  selectCrop(selected) {
    selected = selected && this.tool !== 'hand';
    this.cropSelected = selected;
    this.viewport.classList.toggle('crop-deselected', !selected);
    $('inspector').hidden = !selected;
    $('crop-box').setAttribute('aria-label', selected ? (this.editTool === 'scale' ? 'Scale rectangle. Use handles or arrow keys to resize; Shift for 10 pixels.' : 'Crop rectangle. Use arrow keys to move; Shift for 10 pixels.') : 'Crop rectangle, not selected. Press Enter to edit.');
    if (selected) this.positionInspector();
  }
  dimensions() { return { width: this.viewport.clientWidth, height: this.viewport.clientHeight }; }
  positionInspector() {
    if (!this.geometry) return;
    const inspector = $('inspector'), view = this.dimensions();
    const controls = { width: inspector.offsetWidth || Math.min(560, view.width - 16), height: inspector.offsetHeight || 40 };
    const position = cropControlsPosition(this.geometry, this.editor.crop, view, controls);
    inspector.style.left = `${position.left}px`; inspector.style.top = `${position.top}px`;
  }
  render() {
    const source = this.editor.source, view = this.dimensions();
    if (!source || !view.width || !view.height) return;
    this.controlsHeight = Math.max(40, $('inspector').offsetHeight || this.controlsHeight);
    this.geometry = previewGeometry(source, view.width, view.height, this.scale, this.center, this.controlsHeight, this.editor.stretch, this.fitCrop ? this.editor.crop : undefined);
    if (this.scale !== null) {
      this.scale = this.geometry.scale; this.center = this.geometry.center;
    }
    this.editor.previewZoom = this.geometry.scale;
    for (const key of ['width', 'height', 'left', 'top']) $('video-stage').style[key] = `${this.geometry[key]}px`;
    const crop = this.editor.crop;
    this.editor.video.style.clipPath = this.tool !== 'crop' ? `inset(${crop.y / source.height * 100}% ${(source.width - crop.x - crop.width) / source.width * 100}% ${(source.height - crop.y - crop.height) / source.height * 100}% ${crop.x / source.width * 100}%)` : '';
    // Original pixel dimensions at the same viewing zoom, behind the output.
    // Share the output's top-left corner so their extents can be compared directly.
    const g = this.geometry, reference = $('scale-reference');
    reference.style.left = `${g.left + crop.x * g.scaleX}px`;
    reference.style.top = `${g.top + crop.y * g.scaleY}px`;
    reference.style.width = `${source.width * g.scale}px`;
    reference.style.height = `${source.height * g.scale}px`;
    reference.title = `Original resolution: ${source.width} × ${source.height}`;
    this.positionInspector();
    if (document.activeElement !== $('preview-zoom')) $('preview-zoom').value = Number((this.geometry.scale * 100).toFixed(2));
    $('preview-zoom').min = minimumPreviewScale * 100;
    $('preview-zoom').max = Math.max(6400, this.geometry.fitScale * 100);
    $('preview-zoom-out').disabled = this.geometry.scale <= minimumPreviewScale;
    $('preview-fit').setAttribute('aria-pressed', this.scale === null);
  }
  fit() {
    if (this.editor.busy || this.editor.cropDragging) return;
    // Remember the requested framing so switching tools alone does not move it.
    this.fitCrop = this.tool !== 'crop';
    this.scale = null; this.center = null; this.render();
  }
  zoom(scale, anchor = null) {
    if (this.editor.busy || this.editor.cropDragging) return;
    this.render();
    if (!this.geometry) return;
    const view = this.dimensions();
    anchor ||= { x: view.width / 2, y: view.height / 2 };
    scale = clamp(scale, minimumPreviewScale, Math.max(64, this.geometry.fitScale));
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
    this.viewport.focus({ preventScroll: true });
    this.render(); if (!this.geometry) return;
    const point = this.relative(event);
    if (event.pointerType === 'touch') this.points.set(event.pointerId, point);
    if (this.points.size === 2) {
      this.editor.finishCropDrag?.();
      const [a, b] = [...this.points.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: this.geometry.scale,
        source: { x: (mid.x - this.geometry.left) / this.geometry.scaleX, y: (mid.y - this.geometry.top) / this.geometry.scaleY } };
      for (const id of this.points.keys()) this.viewport.setPointerCapture(id);
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (event.button === 1 || this.tool === 'hand' || this.editor.spaceHeld) {
      this.editor.spaceUsed = true;
      this.gesture = { kind: 'pan', id: event.pointerId, point, scale: this.geometry.scale, scaleX: this.geometry.scaleX, scaleY: this.geometry.scaleY,
        center: { ...this.geometry.center } };
      this.viewport.setPointerCapture(event.pointerId);
      this.viewport.classList.add('panning');
      event.preventDefault(); event.stopPropagation();
    } else if (event.target?.closest('#crop-box')) {
      if (!this.cropSelected) {
        this.selectCrop(true);
        $('crop-box').focus({ preventScroll: true });
        event.preventDefault(); event.stopPropagation();
      } else if (event.pointerType === 'touch') $('crop-box').focus({ preventScroll: true });
    } else {
      this.selectCrop(false);
      this.viewport.focus({ preventScroll: true });
    }
  }
  move(event) {
    if (this.points.has(event.pointerId)) this.points.set(event.pointerId, this.relative(event));
    if (!this.gesture || this.editor.busy) return;
    const gesture = this.gesture;
    if (gesture.kind === 'pan' && gesture.id === event.pointerId) {
      const point = this.relative(event);
      this.scale = gesture.scale;
      this.center = { x: gesture.center.x - (point.x - gesture.point.x) / gesture.scaleX,
        y: gesture.center.y - (point.y - gesture.point.y) / gesture.scaleY };
    } else if (gesture.kind === 'pinch' && this.points.size === 2) {
      const [a, b] = [...this.points.values()], view = this.dimensions();
      this.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, minimumPreviewScale, Math.max(64, this.geometry.fitScale));
      this.center = { x: gesture.source.x - ((a.x + b.x) / 2 - view.width / 2) / (this.scale * this.editor.stretch.x),
        y: gesture.source.y - ((a.y + b.y) / 2 - view.height / 2) / (this.scale * this.editor.stretch.y) };
    } else return;
    event.preventDefault(); event.stopPropagation(); this.render();
  }
  end(event) {
    this.points.delete(event.pointerId);
    if (this.gesture?.id === event.pointerId || this.gesture?.kind === 'pinch') this.gesture = null;
    this.viewport.classList.remove('panning');
  }
  bind() {
    this.viewport.addEventListener('keydown', event => {
      if (this.editor.busy || !this.editor.source) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        this.editor.finishCropDrag?.(); this.selectCrop(false);
        this.viewport.focus({ preventScroll: true });
      } else if (event.key === 'Enter' && event.target.closest('#crop-box')) {
        event.preventDefault(); event.stopPropagation(); this.selectCrop(true);
      }
    }, true);
    $('preview-crop-tool').onclick = () => { this.setTool('crop'); this.viewport.focus({ preventScroll: true }); };
    $('preview-scale-tool').onclick = () => { this.setTool('scale'); this.viewport.focus({ preventScroll: true }); };
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
