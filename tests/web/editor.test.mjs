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
  assert.equal(editor.segments[0].start, 1.24);
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
test('track clicks seek and clear selection; inspector edits and deletes selection', () => {
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
  assert.equal(editor.getEdits().segments[0].end, 3.52); assert.equal(editor.playhead, 5);
  $('delete-segment').click(); assert.deepEqual(editor.segments, [{ start: 6, end: 8 }]);
  $('timeline-content').getBoundingClientRect = () => ({ left: 0 });
  $('source-clip').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: editor.timeX(3) }));
  assert.equal(editor.playhead, 3); assert.equal(editor.selected, null);
  assert.equal($('segment-fields').hidden, true); assert.equal($('delete-segment').disabled, true);
  assert.equal($('segment-inspector').hidden, true);
  assert.equal(typeof $('timeline').onpointerdown, 'function');
});
test('timeline clicks account for zoom and scroll, clamp to the source, and ignore busy state', () => {
  reset(); editor.zoomTimeline(4);
  $('timeline-content').getBoundingClientRect = () => ({ left: -200 });
  const click = time => $('timeline').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: editor.timeX(time) - 200 }));
  click(4); assert.equal(editor.playhead, 4);
  click(-1); assert.equal(editor.playhead, 0);
  click(11); assert.equal(editor.playhead, 10);
  editor.setBusy(true); click(2); assert.equal(editor.playhead, 10);
  editor.setBusy(false);
});
test('a segment click seeks after pointer release without moving the segment', () => {
  reset(); editor.position(2); key('i'); editor.position(6); key('o');
  const viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
  $('timeline-content').getBoundingClientRect = () => ({ left: -100 });
  const clientX = editor.timeX(4) - 100;
  editor.dragSegment({ button: 0, clientX, pointerId: 1, preventDefault() {}, stopPropagation() {} }, 0);
  viewport.dispatchEvent(new dom.window.MouseEvent('pointerup', { clientX }));
  assert.equal(editor.playhead, 4); assert.deepEqual(editor.segments, [{ start: 2, end: 6 }]);
  assert.equal(editor.selected, 0);
});
test('holding on the timeline scrubs until release, cancellation, or export', () => {
  reset(); editor.zoomTimeline(4);
  const timeline = $('timeline'), viewport = $('timeline-scroll');
  timeline.setPointerCapture = () => {};
  viewport.getBoundingClientRect = () => ({ left: -10000, right: 10000 });
  $('timeline-content').getBoundingClientRect = () => ({ left: -500 });
  const event = (type, time) => new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: editor.timeX(time) - 500 });
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'busy']) {
    timeline.onpointerdown({ target: $('source-clip'), currentTarget: timeline, button: 0, pointerId: 1, clientX: editor.timeX(3) - 500, preventDefault() {} });
    assert.equal(editor.playhead, 3);
    timeline.dispatchEvent(event('pointermove', 7)); assert.equal(editor.playhead, 7);
    if (end === 'busy') editor.setBusy(true);
    else timeline.dispatchEvent(event(end, 7));
    timeline.dispatchEvent(event('pointermove', 9)); assert.equal(editor.playhead, 7);
    editor.setBusy(false);
  }
});
test('ruler keeps partially visible labels on both sides of the viewport', () => {
  reset(); editor.zoomTimeline(4);
  const viewport = $('timeline-scroll');
  Object.defineProperty(viewport, 'clientWidth', { value: 640, configurable: true });
  viewport.scrollLeft = 40; editor.renderRuler();
  const labels = () => [...$('timeline-ruler').children].map(tick => tick.textContent);
  assert.ok(labels().includes('00:00:00.000'));
  assert.ok(labels().includes('00:00:03.000'));
  viewport.scrollLeft = editor.timeX(2) + 10; editor.renderRuler();
  assert.ok(labels().includes('00:00:02.000'));
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
  assert.ok(editor.preview.scale < initial); assert.ok(editor.preview.scale > 0);
  assert.notEqual(editor.preview.center, null);
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

test('preview pans freely and zooms below fit; only Fit or Z recenters it', () => {
  reset(); const preview = editor.preview, view = $('preview-viewport');
  const before = editor.getEdits();
  const displaced = () => { preview.zoom(4); preview.center = { x: -10000, y: 10000 }; preview.render(); };
  const centered = () => {
    assert.equal(preview.scale, null); assert.equal(preview.center, null);
    assert.ok(Math.abs(preview.geometry.left + preview.geometry.width / 2 - view.clientWidth / 2) < 1e-8);
    assert.ok(Math.abs(preview.geometry.top + preview.geometry.height / 2 - view.clientHeight / 2) < 1e-8);
    assert.equal($('preview-zoom-out').disabled, false);
    assert.deepEqual(editor.getEdits(), before);
  };
  displaced(); assert.deepEqual(preview.center, { x: -10000, y: 10000 });
  for (let i = 0; i < 30; i++) view.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: 100, clientX: 10, clientY: 10, bubbles: true, cancelable: true }));
  assert.ok(preview.scale < preview.geometry.fitScale); assert.notEqual(preview.center, null);
  key('z'); centered();
  displaced(); for (let i = 0; i < 30; i++) $('preview-zoom-out').click();
  assert.ok(preview.scale < preview.geometry.fitScale); assert.notEqual(preview.center, null);
  $('preview-fit').click(); centered();
  displaced(); $('preview-zoom').value = '1'; $('preview-zoom').dispatchEvent(new dom.window.Event('change'));
  assert.equal(preview.scale, .01); assert.equal($('preview-zoom').value, '1');
  $('preview-zoom').value = '.01'; $('preview-zoom').dispatchEvent(new dom.window.Event('change'));
  assert.equal(preview.scale, .0001); assert.equal($('preview-zoom-out').disabled, true);
  key('z'); centered();
  view.setPointerCapture = () => {};
  const pointer = x => ({ target: view, button: 1, pointerId: 1, clientX: x, clientY: 100, preventDefault() {}, stopPropagation() {} });
  preview.begin(pointer(100)); preview.move(pointer(10000)); preview.end(pointer(10000));
  assert.ok(preview.center.x < -1000); assert.deepEqual(editor.getEdits(), before);
});
test('crop overlay controls remain editable without triggering preview pan or zoom', () => {
  reset(); editor.preview.zoom(2); editor.preview.setTool('crop');
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

test('seeks, marks, typed boundaries, splits and drags use source frame boundaries', () => {
  reset(); editor.zoomTimeline(4096);
  editor.position(1.019); assert.equal(editor.playhead, 1);
  editor.position(1.021); assert.equal(editor.playhead, 1.04);
  editor.addPoint('in', 1.013); editor.addPoint('out', 2.027);
  assert.deepEqual(editor.segments, [{ start: 1, end: 2.04 }]);
  editor.selectSegment(0); editor.editBoundary('start', '1.111');
  assert.equal(editor.segments[0].start, 1.12);
  const point = editor.points.find(p => p.type === 'out');
  editor.movePoint(point.id, 2.019); assert.equal(point.time, 2);
  editor.movePoint(point.id, 1.12, editor.pointBounds(point, 0));
  assert.equal(point.time, 1.16); // Never collapse the segment below one frame.
  editor.movePoint(point.id, 3); editor.position(2.013); editor.split();
  assert.deepEqual(editor.segments, [{ start: 1.12, end: 2 }, { start: 2, end: 3 }]);
  const viewport = $('timeline-scroll'); viewport.setPointerCapture = () => {};
  viewport.getBoundingClientRect = () => ({ left: -10000, right: 10000 });
  editor.dragSegment({ button: 0, clientX: 300, pointerId: 1, preventDefault() {}, stopPropagation() {} }, 1);
  const move = new dom.window.Event('pointermove');
  Object.assign(move, { clientX: 300 + .053 * editor.timelineMetrics().pixelsPerSecond }); viewport.dispatchEvent(move);
  viewport.dispatchEvent(new dom.window.Event('pointerup'));
  assert.deepEqual(editor.segments[1], { start: 2.04, end: 3.04 });
});

test('fractional frame rates step without drift and preserve the terminal source boundary', () => {
  const fractional = { ...source, fps: 30000 / 1001, duration: 10.02 };
  editor.reset(new Blob(['test']), fractional); editor.setBusy(false);
  editor.position(0);
  for (let i = 0; i < 300; i++) editor.stepFrame(1);
  assert.equal(editor.playhead, 300 / fractional.fps);
  editor.stepFrame(1); assert.equal(editor.playhead, fractional.duration);
  editor.stepFrame(-1); assert.equal(editor.playhead, 300 / fractional.fps);
  for (let i = 0; i < 300; i++) editor.stepFrame(-1);
  assert.equal(editor.playhead, 0);
  reset();
});

for (const videoFrames of [true, false]) {
  test(`${videoFrames ? 'video frame' : 'animation frame'} callbacks update playback and cancel cleanly`, () => {
    reset();
    const video = editor.video, view = document.defaultView, callbacks = new Map();
    let nextId = 0, paused = false, currentTime = 0, seeks = 0;
    const request = cb => { callbacks.set(++nextId, cb); return nextId; };
    const cancel = id => callbacks.delete(id);
    const fire = time => {
      const [id, cb] = callbacks.entries().next().value;
      callbacks.delete(id); cb(0, videoFrames ? { mediaTime: time } : undefined);
    };
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => paused },
      readyState: { configurable: true, value: 4 },
      currentTime: { configurable: true, get: () => currentTime, set: value => { currentTime = value; seeks++; } }
    });
    video.pause = () => { paused = true; video.dispatchEvent(new dom.window.Event('pause')); };
    if (videoFrames) { video.requestVideoFrameCallback = request; video.cancelVideoFrameCallback = cancel; }
    else { view.requestAnimationFrame = request; view.cancelAnimationFrame = cancel; }
    try {
      video.dispatchEvent(new dom.window.Event('play'));
      assert.equal(callbacks.size, 1);
      for (let frame = 1; frame <= 5; frame++) {
        currentTime = videoFrames ? .77 : frame / source.fps;
        fire(frame / source.fps);
        assert.equal(editor.playhead, frame / source.fps);
        assert.equal(callbacks.size, 1);
      }
      assert.equal(seeks, 0); // Drawing the playhead must never seek the video.
      currentTime = .9; video.dispatchEvent(new dom.window.Event('timeupdate'));
      assert.equal(editor.playhead, .2); // Coarse events cannot override the frame clock.
      editor.position(1); editor.markIn(); editor.position(2); editor.markOut();
      editor.position(4); editor.markIn(); editor.position(5); editor.markOut();
      $('preview-kept').checked = true;
      currentTime = 2; fire(2); assert.equal(currentTime, 4);
      const stale = callbacks.values().next().value;
      video.pause(); assert.equal(callbacks.size, 0);
      stale(0, { mediaTime: 7 }); assert.equal(callbacks.size, 0);
      assert.equal(editor.playhead, 4);
      paused = false; video.dispatchEvent(new dom.window.Event('play'));
      assert.equal(callbacks.size, 1);
      editor.dispose(); assert.equal(callbacks.size, 0);
    } finally {
      editor.stopPlaybackClock();
      for (const key of ['paused', 'readyState', 'currentTime', 'pause', 'requestVideoFrameCallback', 'cancelVideoFrameCallback']) delete video[key];
      if (!videoFrames) { delete view.requestAnimationFrame; delete view.cancelAnimationFrame; }
      reset();
    }
  });
}

test('Space controls playback from focused controls without triggering their default actions', () => {
  reset();
  let plays = 0;
  const original = editor.play;
  editor.play = () => { plays++; };
  const space = (target, type, repeat = false) => {
    const event = new dom.window.KeyboardEvent(type, { key: ' ', repeat, bubbles: true, cancelable: true });
    target.dispatchEvent(event); return event;
  };
  try {
    for (const id of ['step-forward', 'step-back', 'play', 'mark-in', 'preview-fit', 'preview-mute', 'preview-volume-toggle', 'preview-kept', 'preview-volume']) {
      const target = $(id), before = plays, position = editor.playhead;
      target.focus();
      assert.equal(space(target, 'keydown').defaultPrevented, true, id);
      space(target, 'keydown', true); space(target, 'keydown', true);
      assert.equal(space(target, 'keyup').defaultPrevented, true, id);
      assert.equal(plays, before + 1); assert.equal(editor.playhead, position);
      assert.equal(editor.spaceHeld, false);
    }
    for (const id of ['playhead-time', 'crop-width', 'crop-ratio']) {
      const before = plays;
      assert.equal(space($(id), 'keydown').defaultPrevented, false);
      space($(id), 'keyup'); assert.equal(plays, before);
    }
    $('edit-panel').hidden = true;
    const before = plays;
    space($('compress'), 'keydown'); space($('compress'), 'keyup');
    assert.equal(plays, before + 1);
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    $('step-forward').dispatchEvent(enter); assert.equal(enter.defaultPrevented, false);
  } finally { editor.play = original; $('edit-panel').hidden = false; }
});

test('preview volume and mute restore the previous level without changing edits', () => {
  reset();
  const video = editor.video, before = editor.getEdits();
  const volume = percent => { $('preview-volume').value = percent; $('preview-volume').dispatchEvent(new dom.window.Event('input')); };
  volume(35);
  assert.equal(video.volume, .35); assert.equal(video.muted, false);
  assert.equal($('preview-volume-value').value, '35%');
  $('preview-mute').click();
  assert.equal(video.muted, true); assert.equal($('preview-volume-toggle').dataset.muted, 'true');
  assert.equal($('preview-mute').textContent, 'Unmute');
  $('preview-mute').click(); assert.equal(video.muted, false); assert.equal(video.volume, .35);
  volume(0); $('preview-mute').click(); assert.equal(video.volume, .35);
  video.volume = .6; video.dispatchEvent(new dom.window.Event('volumechange'));
  assert.equal($('preview-volume').value, '60');
  assert.deepEqual(editor.getEdits(), before);
  reset(); assert.equal(video.volume, .6); // Replacing the video keeps listening volume.
  volume(100);
});

test('crop deselection hides controls without changing crop or camera; click, Enter, or V restores selection', () => {
  reset(); editor.crop = { x: 100, y: 100, width: 300, height: 200 }; editor.renderCrop();
  editor.preview.zoom(2);
  const preview = editor.preview, view = $('preview-viewport'), box = $('crop-box');
  const before = editor.getEdits(), camera = { ...preview.geometry };
  const pointer = target => ({ target, button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
  preview.begin(pointer($('preview-canvas')));
  assert.equal(preview.cropSelected, false); assert.equal($('inspector').hidden, true);
  assert.equal(view.classList.contains('crop-deselected'), true);
  preview.render(); assert.deepEqual(preview.geometry, camera);
  editor.drag(pointer(box)); assert.equal(editor.cropDragging, false);
  let consumed = false;
  preview.begin({ ...pointer(box), stopPropagation() { consumed = true; } });
  assert.equal(consumed, true); assert.equal(editor.cropDragging, false);
  assert.equal(preview.cropSelected, true); assert.equal($('inspector').hidden, false);
  key('Escape', $('crop-width'));
  assert.equal(preview.cropSelected, false); assert.equal(document.activeElement, view);
  key('Enter', box); assert.equal(preview.cropSelected, true);
  key('Escape', box); key('v'); assert.equal(preview.cropSelected, true);
  assert.deepEqual(editor.getEdits(), before); assert.deepEqual(preview.geometry, camera);
});

test('crop and scale share geometry; further cropping preserves stretch and shared dimensions', () => {
  reset(); editor.preview.zoom(1);
  editor.crop = { x: 40, y: 20, width: 320, height: 240 }; editor.renderCrop();
  const before = { ...editor.preview.geometry };
  key('s'); assert.equal(editor.preview.tool, 'scale');
  assert.deepEqual(editor.preview.geometry, before);
  assert.equal($('crop-fields').hidden, true); assert.equal($('scale-fields').hidden, false);
  $('scale-width').value = '320*2'; $('scale-width').dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(editor.stretch, { x: 2, y: 1 });
  assert.equal($('width').value, '640'); assert.equal($('scale-width').value, '320*2');
  assert.equal(editor.preview.geometry.width, 1280); assert.equal(editor.preview.geometry.height, 480);
  assert.match(editor.video.style.clipPath, /^inset/);
  const stretched = { ...editor.preview.geometry };
  key('v'); assert.deepEqual(editor.preview.geometry, stretched); assert.equal(editor.video.style.clipPath, '');
  $('crop-width').value = '160'; $('crop-width').dispatchEvent(new dom.window.Event('input'));
  assert.equal($('width').value, '320'); assert.deepEqual(editor.stretch, { x: 2, y: 1 });
  assert.deepEqual(editor.preview.geometry, stretched);
  key('s'); key('Escape', $('crop-box')); assert.equal($('inspector').hidden, true);
  key('Enter', $('crop-box')); assert.equal($('inspector').hidden, false);
  $('reset-scale').click(); assert.deepEqual(editor.stretch, { x: 1, y: 1 });
  assert.equal($('width').value, '160'); assert.equal(editor.crop.x, 40);
});

test('all scale handles track screen deltas and keep the opposite edge or corner fixed', () => {
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    reset(); editor.preview.zoom(2);
    editor.crop = { x: 40, y: 20, width: 320, height: 240 }; editor.renderCrop();
    editor.setOutputSize(640, 120); editor.preview.setTool('scale');
    const anchor = editor.resizeAnchor(handle), target = document.querySelector(`[data-handle="${handle}"]`);
    target.setPointerCapture = () => {};
    editor.drag({ target, button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
    const move = new dom.window.Event('pointermove', { bubbles: true });
    Object.assign(move, { pointerId: 1, clientX: 140, clientY: 120 }); target.dispatchEvent(move);
    const size = editor.getOutputSize();
    assert.equal(size.width, 640 + (handle.includes('e') ? 20 : handle.includes('w') ? -20 : 0));
    assert.equal(size.height, 120 + (handle.includes('s') ? 10 : handle.includes('n') ? -10 : 0));
    const g = editor.preview.geometry;
    assert.equal(editor.cropDragging, true);
    assert.ok(Math.abs(g.scaleX * editor.crop.width - size.width * anchor.scale) < 1e-7);
    assert.ok(Math.abs(g.scaleY * editor.crop.height - size.height * anchor.scale) < 1e-7);
    assert.equal(parseFloat($('video-stage').style.width), g.width);
    assert.equal(parseFloat($('video-stage').style.height), g.height);
    assert.ok(Math.abs(g.left + anchor.source.x * g.scaleX - anchor.screen.x) < 1e-7);
    assert.ok(Math.abs(g.top + anchor.source.y * g.scaleY - anchor.screen.y) < 1e-7);
    assert.deepEqual(editor.crop, { x: 40, y: 20, width: 320, height: 240 });
    target.dispatchEvent(new dom.window.Event('pointerup')); assert.equal(editor.cropDragging, false);
  }
});

test('scale fields validate, lock ratio and reset independently of cropping and preview zoom', () => {
  reset(); editor.preview.zoom(2); editor.preview.setTool('scale');
  $('scale-proportional').checked = true;
  const input = value => { $('scale-width').value = value; $('scale-width').dispatchEvent(new dom.window.Event('input')); };
  input('640/2'); assert.deepEqual(editor.getOutputSize(), { width: 320, height: 240 });
  assert.equal(editor.preview.scale, 2);
  input('0'); assert.throws(() => editor.getEdits(), /highlighted/);
  assert.deepEqual(editor.getOutputSize(), { width: 320, height: 240 });
  input('99999'); assert.throws(() => editor.getEdits(), /highlighted/);
  $('reset-scale').click(); assert.doesNotThrow(() => editor.getEdits());
  assert.deepEqual(editor.getOutputSize(), { width: 640, height: 480 });
  editor.reset(new Blob(['new']), source); assert.equal(editor.preview.scale, null);
  assert.deepEqual(editor.stretch, { x: 1, y: 1 }); assert.equal($('scale-proportional').checked, false);
});

test('nonuniform stretching keeps zoom anchors, pan and touch pinch in source coordinates', () => {
  reset(); editor.preview.zoom(1); editor.setOutputSize(1280, 240);
  const preview = editor.preview, view = $('preview-viewport'); view.setPointerCapture = () => {};
  const screen = { x: 220, y: 180 }, old = preview.geometry;
  const pixel = { x: (screen.x - old.left) / old.scaleX, y: (screen.y - old.top) / old.scaleY };
  preview.zoom(2, screen);
  assert.ok(Math.abs(preview.geometry.left + pixel.x * preview.geometry.scaleX - screen.x) < 1e-7);
  assert.ok(Math.abs(preview.geometry.top + pixel.y * preview.geometry.scaleY - screen.y) < 1e-7);
  const event = (id, x, y, touch = false) => ({ target: view, button: touch ? 0 : 1, pointerType: touch ? 'touch' : 'mouse', pointerId: id, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  const center = { ...preview.center };
  preview.begin(event(1, 100, 100)); preview.move(event(1, 180, 140)); preview.end(event(1, 180, 140));
  assert.equal(preview.center.x, center.x - 20); assert.equal(preview.center.y, center.y - 40);
  const g = preview.geometry, mid = { x: 300, y: 200 };
  const sourceMid = { x: (mid.x - g.left) / g.scaleX, y: (mid.y - g.top) / g.scaleY };
  preview.begin(event(1, 200, 200, true)); preview.begin(event(2, 400, 200, true));
  preview.move(event(1, 100, 200, true)); preview.move(event(2, 500, 200, true));
  assert.equal(preview.scale, 4);
  assert.ok(Math.abs(preview.geometry.left + sourceMid.x * preview.geometry.scaleX - mid.x) < 1e-7);
  assert.ok(Math.abs(preview.geometry.top + sourceMid.y * preview.geometry.scaleY - mid.y) < 1e-7);
  preview.end(event(1, 100, 200, true)); preview.end(event(2, 500, 200, true));
});

test('crop aspect presets describe the stretched output and source crop drags account for both axes', () => {
  reset(); editor.preview.zoom(1); editor.setOutputSize(1280, 240);
  $('crop-ratio').value = '1'; $('crop-ratio').dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(editor.getOutputSize(), { width: 240, height: 240 });
  assert.deepEqual(editor.stretch, { x: 2, y: .5 });
  editor.crop = { x: 40, y: 20, width: 320, height: 240 }; editor.renderCrop();
  const box = $('crop-box'); box.setPointerCapture = () => {};
  $('video-stage').getBoundingClientRect = () => ({ width: 1280, height: 240 });
  editor.drag({ target: box, button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
  const move = new dom.window.Event('pointermove'); Object.assign(move, { clientX: 140, clientY: 110 }); box.dispatchEvent(move);
  assert.equal(editor.crop.x, 60); assert.equal(editor.crop.y, 40);
  box.dispatchEvent(new dom.window.Event('pointerup'));
});

test('Fit and Z frame the stretched crop in Hand and Scale, and the source in Crop', () => {
  reset();
  const preview = editor.preview, view = $('preview-viewport');
  Object.defineProperty(view, 'clientWidth', { value: 640, configurable: true });
  Object.defineProperty(view, 'clientHeight', { value: 480, configurable: true });
  editor.crop = { x: 180, y: 50, width: 200, height: 120 }; editor.renderCrop();
  editor.setOutputSize(400, 60);
  const before = editor.getEdits();
  const checkCropFit = () => {
    const g = preview.geometry, crop = editor.crop;
    assert.ok(Math.abs(g.left + (crop.x + crop.width / 2) * g.scaleX - view.clientWidth / 2) < 1e-7);
    assert.ok(Math.abs(g.top + (crop.y + crop.height / 2) * g.scaleY - view.clientHeight / 2) < 1e-7);
    assert.ok(crop.width * g.scaleX <= view.clientWidth - 40 + 1e-7);
    assert.ok(crop.height * g.scaleY <= view.clientHeight - 128 + 1e-7);
    assert.equal(g.scale, Math.min((view.clientWidth - 40) / 400, (view.clientHeight - 128) / 60));
  };
  for (const tool of ['hand', 'scale']) {
    preview.setTool(tool); preview.zoom(4); preview.center = { x: -100, y: -100 }; preview.render();
    if (tool === 'hand') $('preview-fit').click(); else key('z');
    checkCropFit();
    const fitted = { ...preview.geometry };
    preview.setTool('crop'); assert.deepEqual(preview.geometry, fitted);
    key('z');
    assert.deepEqual(preview.geometry.center, { x: 320, y: 240 });
    assert.ok(preview.geometry.scale < fitted.scale);
  }
  preview.setTool('hand'); preview.fit();
  Object.defineProperty(view, 'clientWidth', { value: 390, configurable: true });
  preview.render(); checkCropFit();
  const g = preview.geometry; view.setPointerCapture = () => {};
  const pointer = x => ({ target: view, button: 0, pointerId: 1, clientX: x, clientY: 100, preventDefault() {}, stopPropagation() {} });
  preview.begin(pointer(100)); preview.move(pointer(120)); preview.end(pointer(120));
  assert.ok(Math.abs(preview.geometry.left - g.left - 20) < 1e-7);
  assert.equal(preview.geometry.top, g.top);
  assert.deepEqual(editor.getEdits(), before);
  assert.deepEqual(editor.getOutputSize(), { width: 400, height: 60 });
});

test('Hand consistently shows only the cropped output regardless of previous editing tool', () => {
  reset(); editor.preview.zoom(1);
  editor.crop = { x: 40, y: 20, width: 320, height: 240 }; editor.renderCrop(); editor.setOutputSize(480, 120);
  const states = [];
  for (const previous of ['crop', 'scale']) {
    editor.preview.setTool(previous); editor.preview.setTool('hand');
    assert.equal($('crop-overlay').hidden, true);
    assert.equal($('inspector').hidden, true);
    assert.equal($('crop-fields').hidden, true); assert.equal($('scale-fields').hidden, true);
    assert.equal($('scale-reference').hidden, true);
    assert.equal(editor.preview.cropSelected, false);
    editor.preview.selectCrop(true); assert.equal($('inspector').hidden, true);
    states.push({ clip: editor.video.style.clipPath, geometry: { ...editor.preview.geometry }, classes: $('preview-viewport').className });
  }
  assert.deepEqual(states[0], states[1]); assert.match(states[0].clip, /^inset/);
  editor.preview.setTool('scale'); assert.equal($('crop-overlay').hidden, false); assert.equal($('inspector').hidden, false);
  assert.equal($('scale-fields').hidden, false);
  editor.preview.setTool('crop'); assert.equal(editor.video.style.clipPath, ''); assert.equal($('crop-fields').hidden, false);
});

test('Scale reference retains original resolution while output stretches and follows viewing zoom', () => {
  reset(); editor.preview.zoom(1); editor.preview.setTool('scale');
  editor.crop = { x: 40, y: 20, width: 320, height: 240 }; editor.renderCrop();
  const reference = $('scale-reference');
  for (const size of [[160, 120], [960, 600]]) {
    editor.setOutputSize(...size);
    assert.equal(reference.hidden, false);
    assert.equal(parseFloat(reference.style.width), source.width);
    assert.equal(parseFloat(reference.style.height), source.height);
    const g = editor.preview.geometry;
    assert.equal(parseFloat(reference.style.left), g.left + editor.crop.x * g.scaleX);
    assert.equal(parseFloat(reference.style.top), g.top + editor.crop.y * g.scaleY);
  }
  editor.preview.zoom(2);
  assert.equal(parseFloat(reference.style.width), source.width * 2);
  assert.equal(parseFloat(reference.style.height), source.height * 2);
  for (const tool of ['hand', 'crop']) { editor.preview.setTool(tool); assert.equal(reference.hidden, true); }
});
