import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdits, segmentsFromPoints, dragCrop, fitRatio, parseTime, timecode, zoomScrollPosition, previewGeometry, timelineGeometry, moveSegment, zoomPreviewAt, cropControlsPosition } from '../../web/edits.js';
import { plan, command, metadata } from '../../web/compressor.js';
const source = { duration: 20, width: 1920, height: 1080, audio: true };
test('kept ranges are sorted and overlaps merged; removed ranges are inverted', () => {
  const segments = [{ start: 8, end: 12 }, { start: 2, end: 5 }, { start: 4, end: 6 }];
  assert.deepEqual(normalizeEdits({ segments }, source).segments, [{ start: 2, end: 6 }, { start: 8, end: 12 }]);
  const removed = normalizeEdits({ segments, mode: 'remove' }, source);
  assert.deepEqual(removed.segments, [{ start: 0, end: 2 }, { start: 6, end: 8 }, { start: 12, end: 20 }]);
  assert.equal(removed.duration, 12);
  assert.equal(normalizeEdits({ segments: [] }, source).duration, 20);
  assert.throws(() => normalizeEdits({ segments: [{ start: 0, end: 20 }], mode: 'remove' }, source), /entire/);
  for (const s of [{ start: -1, end: 5 }, { start: 3, end: 2 }, { start: 2, end: 21 }, { start: 1, end: NaN }]) assert.throws(() => normalizeEdits({ segments: [s] }, source));
});
test('crop accepts precise odd positions, rejects missing/outside/fractional coordinates', () => {
  assert.equal(normalizeEdits({ crop: { x: 11, y: 13, width: 100, height: 80 } }, source).crop.x, 11);
  for (const crop of [{}, { x: -1, y: 0, width: 100, height: 80 }, { x: 1900, y: 0, width: 100, height: 80 }, { x: 1.5, y: 0, width: 100, height: 80 }]) assert.throws(() => normalizeEdits({ crop }, source));
});
test('dragging respects source bounds for all handles and locked ratios', () => {
  const original = { x: 100, y: 100, width: 640, height: 360 };
  assert.deepEqual(dragCrop(original, 'move', -500, 2000, source), { ...original, x: 0, y: 720 });
  for (const handle of ['nw','n','ne','e','se','s','sw','w']) {
    for (const delta of [-10000, -10, 0, 10, 10000]) for (const ratio of [0, 16/9, 1, 9/16]) {
      const crop = dragCrop(original, handle, delta, delta, source, ratio);
      assert.doesNotThrow(() => normalizeEdits({ crop }, source), `${handle} ${delta} ${ratio}`);
      if (ratio && crop.width > 4 && crop.height > 4) assert.ok(Math.abs(crop.width - crop.height * ratio) <= 2);
    }
  }
  assert.deepEqual(fitRatio(source, 1), { x: 420, y: 0, width: 1080, height: 1080 });
});
test('precise timecodes round trip; invalid timestamps rejected', () => {
  assert.equal(parseTime('01:02:03.456'), 3723.456);
  assert.equal(parseTime('2.5'), 2.5); assert.equal(timecode(59.9999), '00:01:00.000');
  for (const s of ['1:60', '-1', '1:2:3:4', 'NaN', '1e5']) assert.throws(() => parseTime(s));
});
test('trim duration budgets bitrate and complex graph applies crop after joining', () => {
  const values = { target: '10', width: '320', height: '240', fps: '30', speed: '2', audioKbps: '128', audio: true, codec: 'libx264', preset: 'fast', tune: '' };
  const job = plan(values, source, { segments: [{ start: 2, end: 6 }, { start: 10, end: 14 }], crop: { x: 11, y: 13, width: 640, height: 480 } });
  assert.equal(job.duration, 4);
  const args = command(job, '/video.mp4'), graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /concat=n=2:v=1:a=1/); assert.match(graph, /atrim=start=10:end=14/);
  assert.match(graph, /crop=640:480:11:13:exact=1,scale=320:240/);
  assert.ok(!args.includes('-vf')); assert.ok(!args.includes('-af'));
  const muted = command({ ...job, audio: false }, '/video.mp4');
  assert.ok(!muted.join(' ').includes('asplit')); assert.ok(muted.includes('-an'));
});
test('rotated source metadata uses the orientation seen by browser and FFmpeg', () => {
  const info = metadata({ format: { duration: '2' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1', side_data_list: [{ rotation: -90 }] }] }, 100);
  assert.equal(info.width, 1080); assert.equal(info.height, 1920);
});

test('timeline zoom anchors the requested time and clamps at either edge', () => {
  assert.equal(zoomScrollPosition(2, 640, 10, 2.5, 160), 128);
  assert.equal(zoomScrollPosition(4, 640, 10, 5), 832);
  assert.equal(zoomScrollPosition(4, 640, 10, 0), 0);
  assert.equal(zoomScrollPosition(4, 640, 10, 10), 1920);
  assert.equal(zoomScrollPosition(1, 640, 10, 5), 0);
});
test('timeline begins at zero, fits at minimum zoom and retains a small trailing area', () => {
  for (const zoom of [1, 64, 4096]) {
    const g = timelineGeometry(10, 640, zoom);
    assert.equal(g.padding, 0);
    assert.equal(g.width, 640 * zoom);
    assert.ok(Math.abs(g.clipWidth / g.pixelsPerSecond - 10) < 1e-8);
    assert.ok(g.width > g.clipWidth);
  }
});
test('moving a whole segment clamps against adjacent segments and source bounds', () => {
  const ranges = [{ start: 1, end: 2 }, { start: 4, end: 6 }, { start: 8, end: 9 }];
  for (const delta of [-100, -2, -1, 0, 1, 2, 100]) {
    const result = moveSegment(ranges, 1, delta, 10);
    assert.equal(result.end - result.start, 2);
    assert.ok(result.start >= 2 && result.end <= 8);
  }
  assert.deepEqual(moveSegment(ranges, 0, -100, 10), { start: 0, end: 1 });
  assert.deepEqual(moveSegment(ranges, 2, 100, 10), { start: 9, end: 10 });
});
test('preview fit respects portrait and landscape bounds; zoom anchors the source pixel under the cursor', () => {
  for (const source of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const fit = previewGeometry(source, 640, 480);
    assert.ok(fit.left >= 20 && fit.top >= 20);
    assert.ok(fit.left + fit.width <= 620 && fit.top + fit.height <= 460);
    const cursor = { x: fit.left + fit.width * .35, y: fit.top + fit.height * .6 };
    const center = zoomPreviewAt(fit, cursor, { width: 640, height: 480 }, 4);
    const zoom = previewGeometry(source, 640, 480, 4, center);
    assert.ok(Math.abs((cursor.x - fit.left) / fit.scale - (cursor.x - zoom.left) / zoom.scale) < 1e-8);
    assert.ok(Math.abs((cursor.y - fit.top) / fit.scale - (cursor.y - zoom.top) / zoom.scale) < 1e-8);
  }
});

test('In/Out points pair by source time, with implied start/end, in every insertion order', () => {
  const points = [{ id: 1, type: 'out', time: 50 }, { id: 2, type: 'in', time: 100 }, { id: 3, type: 'out', time: 150 }, { id: 4, type: 'in', time: 200 }];
  const expected = [{ start: 0, end: 50, startId: null, endId: 1 }, { start: 100, end: 150, startId: 2, endId: 3 }, { start: 200, end: 250, startId: 4, endId: null }];
  function permutations(items) { return items.length ? items.flatMap((p, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [p, ...rest])) : [[]]; }
  for (const order of permutations(points)) assert.deepEqual(segmentsFromPoints(order, 250), expected);
  assert.deepEqual(segmentsFromPoints([], 250), []);
});
test('unpaired points remain available for later marks; coincident Out/In points split a segment', () => {
  const points = [{ id: 1, type: 'out', time: 50 }, { id: 2, type: 'out', time: 150 }];
  assert.deepEqual(segmentsFromPoints(points, 250).map(({ start, end }) => [start, end]), [[0, 50]]);
  points.push({ id: 3, type: 'in', time: 100 });
  assert.deepEqual(segmentsFromPoints(points, 250).map(({ start, end }) => [start, end]), [[0, 50], [100, 150]]);
  points.push({ id: 4, type: 'in', time: 50 });
  assert.deepEqual(segmentsFromPoints(points, 250).map(({ start, end }) => [start, end]), [[0, 50], [100, 150]]);
  const split = [{ id: 1, type: 'in', time: 0 }, { id: 2, type: 'out', time: 100 }, { id: 3, type: 'in', time: 100 }];
  assert.deepEqual(segmentsFromPoints(split, 250).map(({ start, end }) => [start, end]), [[0, 100], [100, 250]]);
});

test('preview pan stays within video edges and zooming below fit centers every aspect ratio', () => {
  for (const source of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 640, height: 480 }]) {
    for (const center of [{ x: -10000, y: 10000 }, { x: 10000, y: -10000 }]) {
      const zoom = previewGeometry(source, 640, 480, 4, center);
      assert.ok(zoom.left <= 20 + 1e-8 && zoom.left + zoom.width >= 620 - 1e-8);
      assert.ok(zoom.top <= 20 + 1e-8 && zoom.top + zoom.height >= 460 - 1e-8);
      const fit = previewGeometry(source, 640, 480, .001, center);
      assert.equal(fit.scale, fit.fitScale);
      assert.ok(Math.abs(fit.left + fit.width / 2 - 320) < 1e-8);
      assert.ok(Math.abs(fit.top + fit.height / 2 - 240) < 1e-8);
    }
  }
});

test('fitted preview reserves clear space for the horizontal crop strip on desktop and mobile', () => {
  for (const source of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 360, height: 240 }]) {
      const controls = { width: Math.min(560, viewport.width - 16), height: 50 };
      const geometry = previewGeometry(source, viewport.width, viewport.height, null, null, controls.height);
      for (const crop of [{ x: 0, y: 0 }, { x: source.width / 2, y: source.height / 2 }]) {
        const pos = cropControlsPosition(geometry, crop, viewport, controls);
        assert.ok(pos.top >= 8 && pos.left >= 8);
        assert.ok(pos.left + controls.width <= viewport.width - 8);
        assert.ok(pos.top + controls.height <= geometry.top + crop.y * geometry.scale - 16 + 1e-8);
        assert.ok(Math.abs(geometry.top + geometry.height / 2 - viewport.height / 2) < 1e-8);
      }
    }
  }
});
test('zoomed crop strip follows the top-left crop corner and stays inside the viewport', () => {
  const geometry = { left: -100, top: -100, scale: 2 };
  const controls = { width: 300, height: 40 }, viewport = { width: 800, height: 600 };
  assert.deepEqual(cropControlsPosition(geometry, { x: 200, y: 200 }, viewport, controls), { left: 300, top: 244 });
  for (const crop of [{ x: -100, y: -100 }, { x: 1000, y: 1000 }]) {
    const pos = cropControlsPosition(geometry, crop, viewport, controls);
    assert.ok(pos.left >= 8 && pos.left + controls.width <= 792);
    assert.ok(pos.top >= 8 && pos.top + controls.height <= 592);
  }
});
