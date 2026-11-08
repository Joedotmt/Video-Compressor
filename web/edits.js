// Source-space edit geometry and time ranges, shared by the UI and encoder.
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// The final boundary may include a partial frame; preserve the exact source end.
export const frameCount = source => Math.ceil(source.duration * source.fps - 1e-7);
export const frameIndex = (time, source) => time >= source.duration ? frameCount(source) : clamp(Math.round(time * source.fps), 0, frameCount(source));
export const frameTime = (index, source) => Math.min(clamp(index, 0, frameCount(source)) / source.fps, source.duration);
export function snapTime(time, source, bounds = [0, source.duration]) {
  const first = Math.ceil(bounds[0] * source.fps - 1e-7);
  const last = bounds[1] >= source.duration ? frameCount(source) : Math.floor(bounds[1] * source.fps + 1e-7);
  return frameTime(clamp(frameIndex(time, source), first, last), source);
}
export function timecode(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function parseTime(value) {
  const text = String(value).trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text)) throw new Error('Use seconds or HH:MM:SS.mmm.');
  const parts = text.split(':').map(Number);
  if (parts.slice(1).some(n => n >= 60)) throw new Error('Minutes and seconds must be below 60.');
  const seconds = parts.reduce((total, n) => total * 60 + n, 0);
  if (!Number.isFinite(seconds)) throw new Error('Enter a valid time.');
  return seconds;
}
// Points are stored independently of selection and paired in source-time order.
// A leading Out uses source start; a trailing In uses source end. Consecutive
// Ins use the last In before an Out; unmatched Outs remain available for later Ins.
export function segmentsFromPoints(points, duration) {
  const sorted = [...points].sort((a, b) => a.time - b.time || (a.type === b.type ? a.id - b.id : a.type === 'out' ? -1 : 1));
  const segments = [];
  let start = sorted[0]?.type === 'out' ? 0 : null, startId = null;
  for (const point of sorted) {
    if (!Number.isFinite(point.time) || point.time < 0 || point.time > duration || !['in', 'out'].includes(point.type)) throw new Error('Points must be within the video.');
    if (point.type === 'in') { start = point.time; startId = point.id; }
    else {
      if (start !== null && point.time > start) segments.push({ start, end: point.time, startId, endId: point.id });
      start = null; startId = null;
    }
  }
  if (start !== null && start < duration) segments.push({ start, end: duration, startId, endId: null });
  return segments;
}
export function normalizeEdits(edits, source) {
  const { duration, width, height } = source;
  const ranges = (edits?.segments || []).map(({ start, end }) => {
    if (![start, end].every(Number.isFinite) || start < 0 || end > duration + 1e-6 || start >= end) throw new Error('Every segment needs an In before its Out, within the video.');
    return { start, end: Math.min(end, duration) };
  }).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const mode = edits?.mode || 'keep';
  if (!['keep', 'remove'].includes(mode)) throw new Error('Choose Keep or Remove marked segments.');
  let segments = merged;
  if (!ranges.length) segments = [{ start: 0, end: duration }];
  else if (mode === 'remove') {
    segments = []; let cursor = 0;
    for (const range of merged) {
      if (range.start > cursor) segments.push({ start: cursor, end: range.start });
      cursor = range.end;
    }
    if (cursor < duration) segments.push({ start: cursor, end: duration });
  }
  if (!segments.length) throw new Error('These cuts remove the entire video. Keep at least one segment.');
  let crop = edits?.crop ? { ...edits.crop } : { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width < 2 || crop.height < 2 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error('Crop must fit inside the source video and be at least 2 × 2 pixels.');
  return { segments, crop, duration: segments.reduce((total, s) => total + s.end - s.start, 0) };
}
export function fitRatio(bounds, ratio) {
  let width = bounds.width, height = bounds.height;
  if (ratio) {
    if (width / height > ratio) width = Math.round(height * ratio);
    else height = Math.round(width / ratio);
  }
  return { x: Math.floor((bounds.width - width) / 2), y: Math.floor((bounds.height - height) / 2), width, height };
}
export function dragCrop(original, handle, dx, dy, bounds, ratio = 0) {
  if (handle === 'move') return { ...original, x: clamp(Math.round(original.x + dx), 0, bounds.width - original.width), y: clamp(Math.round(original.y + dy), 0, bounds.height - original.height) };
  let left = original.x, top = original.y, right = left + original.width, bottom = top + original.height;
  if (handle.includes('w')) left = clamp(Math.round(left + dx), 0, right - 2);
  if (handle.includes('e')) right = clamp(Math.round(right + dx), left + 2, bounds.width);
  if (handle.includes('n')) top = clamp(Math.round(top + dy), 0, bottom - 2);
  if (handle.includes('s')) bottom = clamp(Math.round(bottom + dy), top + 2, bounds.height);
  if (ratio) {
    const horizontal = handle.includes('e') || handle.includes('w');
    let width = horizontal ? right - left : (bottom - top) * ratio;
    let height = width / ratio;
    // Anchor the opposite edge/corner. Side handles resize around the other axis's center.
    const anchorX = handle.includes('w') ? original.x + original.width : handle.includes('e') ? original.x : original.x + original.width / 2;
    const anchorY = handle.includes('n') ? original.y + original.height : handle.includes('s') ? original.y : original.y + original.height / 2;
    const maxWidth = handle.includes('w') ? anchorX : handle.includes('e') ? bounds.width - anchorX : 2 * Math.min(anchorX, bounds.width - anchorX);
    const maxHeight = handle.includes('n') ? anchorY : handle.includes('s') ? bounds.height - anchorY : 2 * Math.min(anchorY, bounds.height - anchorY);
    const factor = Math.min(1, maxWidth / width, maxHeight / height);
    width = Math.max(2, Math.round(width * factor)); height = Math.max(2, Math.round(height * factor));
    left = Math.round(handle.includes('w') ? anchorX - width : handle.includes('e') ? anchorX : anchorX - width / 2);
    top = Math.round(handle.includes('n') ? anchorY - height : handle.includes('s') ? anchorY : anchorY - height / 2);
    return { x: clamp(left, 0, bounds.width - width), y: clamp(top, 0, bounds.height - height), width, height };
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// View-only geometry: zooming and panning never alter export coordinates.
export function timelineGeometry(duration, viewport, zoom) {
  const width = viewport * zoom, clipWidth = width * .9;
  return { clipWidth, padding: 0, width, pixelsPerSecond: clipWidth / duration };
}
export function zoomScrollPosition(zoom, viewport, duration, time, anchor = viewport / 2) {
  const g = timelineGeometry(duration, viewport, zoom);
  return clamp(g.padding + time * g.pixelsPerSecond - anchor, 0, g.width - viewport);
}
export function moveSegment(ranges, index, delta, duration) {
  const segment = ranges[index];
  const min = (ranges[index - 1]?.end ?? 0) - segment.start;
  const max = (ranges[index + 1]?.start ?? duration) - segment.end;
  const shift = clamp(delta, min, max);
  return { start: segment.start + shift, end: segment.end + shift };
}
export const minimumPreviewScale = .0001;
export function resizedDimensions(crop, stretch) {
  return { width: Math.max(2, Math.floor((crop.width * stretch.x + 1e-7) / 2) * 2),
    height: Math.max(2, Math.floor((crop.height * stretch.y + 1e-7) / 2) * 2) };
}
export function dragResize(size, handle, dx, dy, proportional = false) {
  let width = size.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0);
  let height = size.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0);
  if (proportional) {
    const horizontal = /[ew]/.test(handle), vertical = /[ns]/.test(handle);
    const factor = !vertical || horizontal && Math.abs(width / size.width - 1) >= Math.abs(height / size.height - 1)
      ? width / size.width : height / size.height;
    const bounded = clamp(factor, Math.max(2 / size.width, 2 / size.height), Math.min(16384 / size.width, 16384 / size.height));
    width = size.width * bounded; height = size.height * bounded;
  }
  return { width: Math.floor(clamp(width, 2, 16384) / 2) * 2, height: Math.floor(clamp(height, 2, 16384) / 2) * 2 };
}
export function previewGeometry(source, viewportWidth, viewportHeight, scale = null, center = null, controlsHeight = 0, stretch = { x: 1, y: 1 }, fitBounds = { x: 0, y: 0, ...source }) {
  const marginY = controlsHeight ? Math.max(20, controlsHeight + 24) : 20;
  const fit = Math.min(Math.max(1, viewportWidth - 40) / (fitBounds.width * stretch.x), Math.max(1, viewportHeight - 2 * marginY) / (fitBounds.height * stretch.y));
  scale = scale === null ? fit : clamp(scale, minimumPreviewScale, Math.max(fit, 64));
  center ||= { x: fitBounds.x + fitBounds.width / 2, y: fitBounds.y + fitBounds.height / 2 };
  const scaleX = scale * stretch.x, scaleY = scale * stretch.y;
  return { scale, scaleX, scaleY, stretchX: stretch.x, stretchY: stretch.y, fitScale: fit, center, width: source.width * scaleX, height: source.height * scaleY,
    left: viewportWidth / 2 - center.x * scaleX, top: viewportHeight / 2 - center.y * scaleY };
}
export function cropControlsPosition(geometry, crop, viewport, controls) {
  const anchorX = geometry.left + crop.x * (geometry.scaleX ?? geometry.scale);
  // Use one crop-relative anchor at every zoom level, including during a drag.
  const anchorY = geometry.top + crop.y * (geometry.scaleY ?? geometry.scale);
  return {
    left: clamp(anchorX, 8, Math.max(8, viewport.width - controls.width - 8)),
    top: clamp(anchorY - controls.height - 16, 8, Math.max(8, viewport.height - controls.height - 8))
  };
}
export function zoomPreviewAt(geometry, anchor, viewport, nextScale) {
  const x = (anchor.x - geometry.left) / (geometry.scaleX ?? geometry.scale);
  const y = (anchor.y - geometry.top) / (geometry.scaleY ?? geometry.scale);
  return { x: x - (anchor.x - viewport.width / 2) / (nextScale * (geometry.stretchX ?? 1)),
    y: y - (anchor.y - viewport.height / 2) / (nextScale * (geometry.stretchY ?? 1)) };
}
