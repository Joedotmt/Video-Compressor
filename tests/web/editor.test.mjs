import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { VideoEditor } from '../../web/editor.js';
const dom = new JSDOM(readFileSync('index.html', 'utf8'), { url: 'http://localhost/' });
globalThis.document = dom.window.document;
for (const method of ['pause', 'load']) dom.window.HTMLMediaElement.prototype[method] = () => {};
const $ = id => document.getElementById(id);
let notifications = 0;
const editor = new VideoEditor(() => notifications++, () => {});
const source = { width: 640, height: 480, duration: 10, fps: 25, audio: true };
const key = (value, target = document.body) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
const reset = () => { editor.reset(new Blob(['test']), source); editor.setBusy(false); $('edit-panel').hidden = false; };
test('I/O repeatedly creates multiple ranges and exact fields update boundaries', () => {
  reset(); editor.position(1); key('i', $('seek')); assert.deepEqual(editor.getEdits().segments, [{ start: 1, end: 10 }]);
  assert.equal(document.querySelector('.timeline-segment').style.width, '518.4px');
  editor.position(3); key('o'); editor.position(5); key('i'); editor.position(8); key('o');
  assert.deepEqual(editor.getEdits().segments, [{ start: 1, end: 3 }, { start: 5, end: 8 }]);
  document.querySelector('[aria-label="Select segment 1"]').click();
  const input = $('segment-in'); input.value = '1.250'; input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(editor.segments[0].start, 1.25);
  $('trim-mode').value = 'remove'; $('trim-mode').dispatchEvent(new dom.window.Event('change'));
  assert.equal(editor.getEdits().mode, 'remove'); assert.ok(notifications > 0);
});
test('shortcuts do not intercept text editing, other tabs, or active encodes', () => {
  reset(); editor.position(2); key('i', $('crop-width')); assert.equal(editor.points.length, 0);
  $('edit-panel').hidden = true; key('i'); assert.equal(editor.points.length, 0);
  $('edit-panel').hidden = false; editor.setBusy(true); key('i'); assert.equal(editor.points.length, 0);
});
test('selected range can be edited, split and deleted', () => {
  reset(); editor.position(2); editor.markIn(); editor.position(8); editor.markOut();
  document.querySelector('[aria-label="Select segment 1"]').click();
  editor.position(3); key('i'); assert.equal(editor.segments[0].start, 3);
  editor.position(5); key('b'); assert.deepEqual(editor.segments, [{ start: 3, end: 5 }, { start: 5, end: 8 }]);
  key('Delete'); assert.deepEqual(editor.segments, [{ start: 3, end: 5 }]);
});
test('invalid crop values block export; exact arithmetic updates rectangle; reset clears edits', () => {
  reset(); assert.equal($('crop-enabled'), null);
  $('crop-width').value = '640/2'; $('crop-width').dispatchEvent(new dom.window.Event('input'));
  $('crop-x').value = '11'; $('crop-x').dispatchEvent(new dom.window.Event('input'));
  assert.equal(editor.getEdits().crop.width, 320); assert.equal(editor.getEdits().crop.x, 11);
  $('crop-x').value = '999'; $('crop-x').dispatchEvent(new dom.window.Event('input'));
  assert.throws(() => editor.getEdits(), /highlighted/);
  $('reset-crop').click(); assert.equal(editor.getEdits().crop, null);
  editor.position(1); editor.markIn(); $('reset-trim').click(); assert.equal(editor.getEdits().segments.length, 0);
});

test('an In point is immediately exportable, repeated I adjusts it and O closes it', () => {
  reset(); editor.position(2); key('i');
  assert.deepEqual(editor.getEdits().segments, [{ start: 2, end: 10 }]);
  assert.equal($('cancel-draft'), null);
  editor.position(4); key('i'); assert.deepEqual(editor.segments, [{ start: 4, end: 10 }]);
  editor.position(6); key('o'); editor.position(8); key('i');
  assert.deepEqual(editor.segments, [{ start: 4, end: 6 }, { start: 8, end: 10 }]);
  key('Delete'); assert.deepEqual(editor.segments, [{ start: 4, end: 6 }]);
  editor.position(10); key('i'); assert.equal(editor.segments.length, 1);
});
test('timeline zoom keeps the playhead centered, supports fit and does not change edits', () => {
  reset(); Object.defineProperty($('timeline-scroll'), 'clientWidth', { value: 640, configurable: true });
  editor.position(5); key('i'); const before = editor.getEdits();
  key('='); assert.equal(editor.timelineZoom, 2); assert.equal($('timeline-scroll').scrollLeft, 256);
  assert.equal($('timeline-content').style.width, '1280px');
  key('+'); assert.equal(editor.timelineZoom, 4); assert.equal($('timeline-scroll').scrollLeft, 832);
  key('-'); assert.equal(editor.timelineZoom, 2);
  key('\\'); assert.equal(editor.timelineZoom, 1); assert.equal($('timeline-scroll').scrollLeft, 0);
  assert.deepEqual(editor.getEdits(), before);
  key('=', $('crop-width')); assert.equal(editor.timelineZoom, 1);
  editor.position(6); key('o'); editor.position(8); key('i'); assert.equal(editor.segments.length, 2);
});
test('preview zoom is independent of crop edits; Z fits the whole video', () => {
  reset(); Object.defineProperty($('preview-viewport'), 'clientWidth', { value: 640, configurable: true });
  Object.defineProperty($('preview-viewport'), 'clientHeight', { value: 480, configurable: true });
  editor.crop = { x: 100, y: 100, width: 80, height: 60 }; editor.renderCrop();
  const before = editor.getEdits();
  $('preview-zoom').value = '400'; $('preview-zoom').dispatchEvent(new dom.window.Event('change'));
  assert.equal(editor.previewZoom, 4);
  const camera = { ...editor.preview.geometry };
  editor.crop.x = 200; editor.renderCrop();
  assert.deepEqual(editor.preview.geometry, camera);
  editor.crop.x = 100; assert.deepEqual(editor.getEdits(), before);
  $('reset-crop').click(); assert.equal(editor.previewZoom, 4); assert.equal(editor.getEdits().crop, null);
  key('z'); assert.equal(editor.preview.scale, null); assert.equal(editor.preview.center, null);
  assert.ok(editor.previewZoom < 1);
  assert.equal($('crop-width').disabled, false);
});
test('crop dragging converts zoomed screen pixels back to source pixels', () => {
  reset(); editor.crop = { x: 100, y: 100, width: 100, height: 100 };
  editor.preview.zoom(4); editor.renderCrop();
  $('video-stage').getBoundingClientRect = () => ({ width: 2560, height: 1920 });
  const box = $('crop-box'); box.setPointerCapture = () => {};
  const pointer = (type, x, y) => {
    const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, button: 0, pointerId: 1 }); box.dispatchEvent(e);
  };
  editor.drag({ button: 0, target: box, clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} });
  pointer('pointermove', 80, 40);
  assert.equal(editor.crop.x, 120); assert.equal(editor.crop.y, 110);
  assert.equal($('preview-viewport').classList.contains('crop-dragging'), true);
  pointer('lostpointercapture', 80, 40);
  assert.equal($('preview-viewport').classList.contains('crop-dragging'), false);
  editor.dispose();
});

test('boundary dragging is relative to the grab point, includes scrolling and never seeks', () => {
  for (const [type, startTime, expected] of [['in', 2, 3], ['out', 7, 8]]) {
    reset(); editor.position(2); key('i'); editor.position(7); key('o'); editor.position(5);
    const viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
    viewport.getBoundingClientRect = () => ({ left: 0, right: 640 });
    const point = editor.points.find(p => p.type === type), pps = editor.timelineMetrics().pixelsPerSecond;
    // Grab 5px away from the boundary. No movement must produce no time change.
    editor.dragPoint({ button: 0, pointerId: 1, clientX: 305, preventDefault() {}, stopPropagation() {} }, point, 0);
    const move = x => { const e = new dom.window.Event('pointermove'); Object.assign(e, { clientX: x }); viewport.dispatchEvent(e); };
    move(305); assert.equal(point.time, startTime);
    viewport.scrollLeft += pps / 2; move(305 + pps / 2);
    assert.ok(Math.abs(point.time - expected) < 1e-8);
    assert.equal(editor.playhead, 5);
    assert.equal($(type === 'in' ? 'segment-in' : 'segment-out').value, `00:00:0${expected}.000`);
    viewport.dispatchEvent(new dom.window.Event('pointerup'));
    assert.equal(editor.trimDragging, false);
  }
});
test('points define ranges independently of selected segment', () => {
  reset();
  for (const [frame, type] of [[100, 'i'], [150, 'o'], [50, 'o'], [200, 'i']]) {
    editor.position(frame / source.fps); key(type);
  }
  assert.deepEqual(editor.segments, [{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 8, end: 10 }]);
  assert.equal(editor.points.length, 4);
  assert.equal($('timeline-marks'), null);
  assert.ok(!$('timeline').textContent.includes('V1'));
  editor.selectSegment(0); editor.position(9); key('o');
  assert.deepEqual(editor.segments, [{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 8, end: 9 }]);
  editor.selectSegment(2); editor.position(3); key('i');
  assert.equal(editor.points.at(-1).type, 'in'); assert.equal(editor.points.at(-1).time, 3);
});
test('clicking the track or selecting a segment does not seek; inspector edits and deletes selection', () => {
  reset(); assert.equal($('segment-inspector').hidden, true);
  editor.position(2); key('i'); editor.position(4); key('o'); editor.position(6); key('i'); editor.position(8); key('o');
  editor.position(5);
  document.querySelector('[aria-label="Select segment 1"]').click();
  assert.equal($('segment-inspector').hidden, false);
  assert.equal(editor.playhead, 5); assert.equal($('segment-in').value, '00:00:02.000');
  assert.equal($('segment-out').value, '00:00:04.000'); assert.equal($('segment-duration').textContent, '00:00:02.000');
  assert.ok($('segment-in').closest('.timeline-footer')); assert.ok($('trim-mode').closest('.timeline-footer'));
  $('segment-out').value = '1'; $('segment-out').dispatchEvent(new dom.window.Event('change'));
  assert.throws(() => editor.getEdits(), /highlighted/);
  $('segment-out').value = '3.5'; $('segment-out').dispatchEvent(new dom.window.Event('change'));
  assert.equal(editor.getEdits().segments[0].end, 3.5); assert.equal(editor.playhead, 5);
  $('delete-segment').click(); assert.deepEqual(editor.segments, [{ start: 6, end: 8 }]);
  $('source-clip').click(); assert.equal(editor.playhead, 5); assert.equal(editor.selected, null);
  assert.equal($('segment-fields').hidden, true); assert.equal($('delete-segment').disabled, true);
  assert.equal($('segment-inspector').hidden, true);
  assert.equal(typeof $('timeline').onpointerdown, 'undefined');
});
test('dragging the playhead scrubs zoomed timelines and clamps outside the source', () => {
  reset(); const handle = $('playhead-handle'); handle.setPointerCapture = () => {};
  $('timeline-content').getBoundingClientRect = () => ({ left: -200 });
  const begin = time => editor.scrub({ button: 0, target: handle, currentTarget: handle, pointerId: 1, clientX: editor.timeX(time) - 200, preventDefault() {} });
  begin(3); assert.ok(Math.abs(editor.playhead - 3) < 1e-8);
  for (const [time, expected] of [[6, 6], [-2, 0], [15, 10]]) {
    const move = new dom.window.Event('pointermove'); Object.assign(move, { clientX: editor.timeX(time) - 200 }); handle.dispatchEvent(move);
    assert.ok(Math.abs(editor.playhead - expected) < 1e-8);
  }
  handle.dispatchEvent(new dom.window.Event('lostpointercapture'));
  key('Home', handle); assert.equal(editor.playhead, 0);
  key('End', handle); assert.equal(editor.playhead, 10);
});
test('Space-drag pans without playing or changing crop; a Space tap plays', () => {
  reset(); editor.preview.zoom(2); const view = $('preview-viewport'); view.setPointerCapture = () => {};
  const before = editor.getEdits(), scale = editor.preview.geometry.scale;
  const event = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  let plays = 0; const original = editor.play; editor.play = () => { plays++; };
  const release = () => document.body.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  key(' ', document.querySelector('.crop-handle')); editor.preview.begin(event(100, 100));
  editor.preview.move(event(180, 140)); editor.preview.end(event(180, 140)); release();
  assert.equal(plays, 0); assert.equal(editor.preview.center.x, 320 - 80 / scale);
  assert.deepEqual(editor.getEdits(), before);
  key(' '); release(); assert.equal(plays, 1);
  key('z'); assert.equal(editor.preview.center, null);
  editor.play = original;
});
test('a second touch switches from crop dragging to pinch/pan without moving the crop', () => {
  reset(); editor.crop = { x: 100, y: 100, width: 300, height: 200 }; editor.renderCrop();
  const view = $('preview-viewport'), box = $('crop-box'); view.setPointerCapture = () => {}; box.setPointerCapture = () => {};
  const touch = (id, x, y) => ({ button: 0, pointerId: id, pointerType: 'touch', target: box, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  editor.preview.begin(touch(1, 200, 200)); editor.drag(touch(1, 200, 200));
  assert.equal(editor.cropDragging, true);
  const before = editor.getEdits(), initial = editor.preview.geometry.scale;
  editor.preview.begin(touch(2, 400, 200)); assert.equal(editor.cropDragging, false);
  editor.preview.move(touch(1, 100, 220)); editor.preview.move(touch(2, 500, 220));
  assert.ok(Math.abs(editor.preview.scale - initial * 2) < 1e-8);
  assert.deepEqual(editor.getEdits(), before);
  editor.preview.move(touch(1, 490, 220));
  assert.equal(editor.preview.scale, null); assert.equal(editor.preview.center, null);
  editor.preview.end(touch(2, 500, 220)); editor.preview.end(touch(1, 100, 220));
  assert.equal(editor.preview.gesture, null); assert.equal(editor.preview.points.size, 0);
  editor.dispose();
});

test('repeated Out and In marks replace the nearby boundary in either direction', () => {
  reset();
  const mark = (frame, type) => { editor.position(frame / source.fps); key(type); };
  mark(10, 'i'); mark(20, 'o'); mark(30, 'o');
  assert.deepEqual(editor.segments, [{ start: 10 / source.fps, end: 30 / source.fps }]);
  assert.equal(editor.points.length, 2);
  assert.equal($('segment-out').value, '00:00:01.200');
  mark(25, 'o');
  assert.deepEqual(editor.segments, [{ start: 10 / source.fps, end: 25 / source.fps }]);
  mark(15, 'i'); mark(5, 'i');
  assert.deepEqual(editor.segments, [{ start: 5 / source.fps, end: 25 / source.fps }]);
  assert.equal(editor.points.length, 2);
  assert.equal(document.querySelectorAll('#timeline-points button').length, 2);
  mark(5, 'i'); assert.equal(editor.points.length, 2);
});
test('opposite boundaries separate marks so new segments still form on either side', () => {
  reset();
  const mark = (frame, type) => { editor.position(frame / source.fps); key(type); };
  mark(10, 'i'); mark(20, 'o'); mark(5, 'o'); mark(30, 'i');
  assert.deepEqual(editor.segments, [
    { start: 0, end: 5 / source.fps },
    { start: 10 / source.fps, end: 20 / source.fps },
    { start: 30 / source.fps, end: source.duration }
  ]);
  editor.selectSegment(0); mark(40, 'i');
  assert.equal(editor.points.length, 4);
  assert.deepEqual(editor.segments.at(-1), { start: 40 / source.fps, end: source.duration });
  mark(22, 'o'); assert.equal(editor.points.length, 4);
  assert.deepEqual(editor.segments[1], { start: 10 / source.fps, end: 22 / source.fps });
});

test('whole-segment dragging preserves duration and stops at neighbors without seeking', () => {
  reset();
  for (const [time, type] of [[1, 'i'], [2, 'o'], [4, 'i'], [6, 'o'], [8, 'i'], [9, 'o']]) { editor.position(time); key(type); }
  editor.position(5);
  const viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
  viewport.getBoundingClientRect = () => ({ left: -10000, right: 10000 });
  const pps = editor.timelineMetrics().pixelsPerSecond;
  editor.dragSegment({ button: 0, clientX: 300, pointerId: 1, preventDefault() {}, stopPropagation() {} }, 1);
  const move = delta => { const e = new dom.window.Event('pointermove'); Object.assign(e, { clientX: 300 + delta * pps }); viewport.dispatchEvent(e); };
  move(1); assert.deepEqual(editor.segments[1], { start: 5, end: 7 });
  move(20); assert.deepEqual(editor.segments[1], { start: 6, end: 8 });
  move(-20); assert.deepEqual(editor.segments[1], { start: 2, end: 4 });
  assert.deepEqual(editor.segments[0], { start: 1, end: 2 }); assert.deepEqual(editor.segments[2], { start: 8, end: 9 });
  assert.equal(editor.playhead, 5); assert.equal($('segment-duration').textContent, '00:00:02.000');
  viewport.dispatchEvent(new dom.window.Event('pointerup'));
  assert.equal(editor.trimDragging, false);
});
test('whole-segment dragging respects source boundaries and inferred In/Out points', () => {
  reset(); editor.position(2); key('o');
  const viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
  viewport.getBoundingClientRect = () => ({ left: -10000, right: 10000 });
  const pps = editor.timelineMetrics().pixelsPerSecond;
  editor.dragSegment({ button: 0, clientX: 300, pointerId: 1, preventDefault() {}, stopPropagation() {} }, 0);
  const move = delta => { const e = new dom.window.Event('pointermove'); Object.assign(e, { clientX: 300 + delta * pps }); viewport.dispatchEvent(e); };
  move(20); assert.deepEqual(editor.segments, [{ start: 8, end: 10 }]);
  move(-20); assert.deepEqual(editor.segments, [{ start: 0, end: 2 }]);
  viewport.dispatchEvent(new dom.window.Event('pointerup'));
});
test('middle-drag pans without seeking or altering edits and cannot expose negative time', () => {
  reset(); editor.position(2); key('i'); editor.position(4); key('o');
  const before = editor.getEdits(), viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
  editor.zoomTimeline(4, 0, 0); editor.scrollTimeline(200);
  const event = (type, x, button = 1) => { const e = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: x, button, pointerId: 1 }); return e; };
  document.querySelector('.timeline-segment button').dispatchEvent(event('pointerdown', 300));
  viewport.dispatchEvent(event('pointermove', 200)); assert.equal(viewport.scrollLeft, 300);
  viewport.dispatchEvent(event('pointermove', 1000)); assert.equal(viewport.scrollLeft, 0);
  viewport.dispatchEvent(event('pointerup', 1000)); assert.equal(viewport.classList.contains('panning'), false);
  assert.equal(editor.playhead, 4); assert.deepEqual(editor.getEdits(), before);
  assert.equal(editor.timeX(0), 0);
});
test('navigator ends zoom around the opposite edge, body pans, and fit restores the source view', () => {
  reset(); editor.position(2); key('i'); const before = editor.getEdits();
  const nav = editor.navigation, bar = $('timeline-navigator'); bar.setPointerCapture = () => {};
  Object.defineProperty(bar, 'clientWidth', { value: 640, configurable: true });
  const begin = (id, x) => nav.dragNavigator({ target: $(id), button: 0, clientX: x, pointerId: 1, preventDefault() {} });
  const move = x => { const e = new dom.window.Event('pointermove'); Object.assign(e, { clientX: x }); bar.dispatchEvent(e); };
  const end = () => bar.dispatchEvent(new dom.window.Event('pointerup'));
  begin('timeline-window-end', 640); move(320); end();
  assert.equal(editor.timelineZoom, 2); assert.equal($('timeline-scroll').scrollLeft, 0);
  const initial = nav.metrics();
  begin('timeline-window-start', 0); move(160); end();
  assert.equal(editor.timelineZoom, 4); assert.ok(Math.abs(nav.metrics().end - initial.end) < 1e-8);
  const left = $('timeline-scroll').scrollLeft;
  begin('timeline-window-pan', 200); move(240); end();
  assert.ok($('timeline-scroll').scrollLeft > left);
  key('Home', $('timeline-window-pan')); assert.equal($('timeline-scroll').scrollLeft, 0);
  bar.dispatchEvent(new dom.window.Event('dblclick')); assert.equal(editor.timelineZoom, 1);
  assert.deepEqual(editor.getEdits(), before); assert.equal($('timeline-zoom'), null);
});

test('all zoom-out controls restore a centered fit after zooming and panning', () => {
  reset(); const preview = editor.preview, view = $('preview-viewport');
  const before = editor.getEdits();
  const displaced = () => { preview.zoom(4); preview.center = { x: -10000, y: 10000 }; preview.render(); };
  const centered = () => {
    assert.equal(preview.scale, null); assert.equal(preview.center, null);
    assert.ok(Math.abs(preview.geometry.left + preview.geometry.width / 2 - view.clientWidth / 2) < 1e-8);
    assert.ok(Math.abs(preview.geometry.top + preview.geometry.height / 2 - view.clientHeight / 2) < 1e-8);
    assert.equal($('preview-zoom-out').disabled, true);
    assert.deepEqual(editor.getEdits(), before);
  };
  displaced();
  for (let i = 0; i < 30; i++) view.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: 100, clientX: 10, clientY: 10, bubbles: true, cancelable: true }));
  centered();
  displaced(); for (let i = 0; i < 30; i++) $('preview-zoom-out').click(); centered();
  displaced(); $('preview-zoom').value = '1'; $('preview-zoom').dispatchEvent(new dom.window.Event('change')); centered();
  assert.ok(Number($('preview-zoom').value) > 1);
});
test('crop overlay controls remain editable without triggering preview pan or zoom', () => {
  reset(); editor.preview.zoom(2); editor.preview.setTool('hand');
  assert.equal($('inspector').parentElement, $('preview-viewport'));
  const before = { ...editor.preview.geometry };
  editor.preview.begin({ target: $('crop-width'), button: 0, pointerId: 1, clientX: 300, clientY: 100 });
  assert.equal(editor.preview.gesture, null);
  const wheel = new dom.window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  $('crop-width').dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false); assert.deepEqual(editor.preview.geometry, before);
  $('crop-width').value = '320'; $('crop-width').dispatchEvent(new dom.window.Event('input'));
  assert.equal(editor.getEdits().crop.width, 320);
});

test('crop strip follows the crop continuously during dragging, typing and zooming', () => {
  reset();
  const inspector = $('inspector');
  Object.defineProperty(inspector, 'offsetWidth', { value: 300, configurable: true });
  Object.defineProperty(inspector, 'offsetHeight', { value: 40, configurable: true });
  editor.crop = { x: 200, y: 200, width: 200, height: 200 };
  editor.preview.zoom(2); editor.renderCrop();
  const left = parseFloat(inspector.style.left), top = parseFloat(inspector.style.top);
  editor.cropDragging = true; editor.crop.x += 10; editor.crop.y += 5; editor.renderCrop();
  assert.equal(parseFloat(inspector.style.left), left + 20);
  assert.equal(parseFloat(inspector.style.top), top + 10);
  editor.cropDragging = false;
  editor.renderCrop(); assert.equal(parseFloat(inspector.style.left), left + 20);
  $('crop-x').focus(); $('crop-x').value = '220'; $('crop-x').dispatchEvent(new dom.window.Event('input'));
  assert.equal(parseFloat(inspector.style.left), left + 40);
  $('crop-x').blur(); editor.preview.fit();
  const cropTop = editor.preview.geometry.top + editor.crop.y * editor.preview.geometry.scale;
  assert.ok(Math.abs(parseFloat(inspector.style.top) + 40 + 16 - cropTop) < 1e-8);
  $('reset-crop').click();
  assert.ok(parseFloat(inspector.style.top) + 40 <= editor.preview.geometry.top - 16 + 1e-8);
  assert.equal($('crop-controls-toggle'), null); assert.equal($('crop-fields').hidden, false);
});

test('transport icons track playback state and frame-step buttons retain their behavior', () => {
  reset(); const play = $('play');
  assert.ok(play.querySelector('svg')); assert.equal(play.getAttribute('aria-label'), 'Play');
  editor.video.dispatchEvent(new dom.window.Event('play'));
  assert.equal(play.dataset.playing, 'true'); assert.equal(play.getAttribute('aria-label'), 'Pause');
  assert.ok(play.querySelector('.pause-glyph'));
  editor.video.dispatchEvent(new dom.window.Event('pause'));
  assert.equal(play.dataset.playing, 'false'); assert.equal(play.getAttribute('aria-label'), 'Play');
  editor.video.dispatchEvent(new dom.window.Event('play')); editor.video.dispatchEvent(new dom.window.Event('ended'));
  assert.equal(play.dataset.playing, 'false');
  editor.position(2); $('step-forward').click(); assert.equal(editor.playhead, 2 + 1 / source.fps);
  $('step-back').click(); assert.equal(editor.playhead, 2);
  assert.ok($('step-forward').querySelector('svg')); assert.ok($('step-back').querySelector('svg'));
  assert.equal(document.querySelector('.time-jump').textContent.trim(), '');
  assert.equal($('playhead-time').getAttribute('aria-label'), 'Playhead time');
});
