import { FFmpeg } from '@ffmpeg/ffmpeg';
import { metadata, command, decoderOptions, preparedJob } from './compressor.js';
export class BrowserCompressor {
  constructor(onLog, onProgress) { this.onLog = onLog; this.onProgress = onProgress; this.ffmpeg = null; this.cancelled = false; this.progressOffset = 0; this.progressScale = 1; }
  cancel() { this.cancelled = true; this.ffmpeg?.terminate(); this.ffmpeg = null; }
  checkCancelled() { if (this.cancelled) throw new Error('Cancelled.'); }
  async load(codec = 'libx264') {
    this.checkCancelled();
    const av1 = codec === 'libaom-av1', threaded = codec === 'libx265';
    if (threaded && !globalThis.crossOriginIsolated) throw new Error('HEVC requires browser isolation. Reload this page over HTTPS with service workers enabled, or choose H.264 or AV1.');
    const ffmpeg = new FFmpeg(); this.ffmpeg = ffmpeg;
    ffmpeg.on('log', ({ message }) => this.onLog(message));
    ffmpeg.on('progress', ({ time }) => this.onProgress(this.progressOffset + this.progressScale * time / 1000000));
    const base = new URL(`${import.meta.env.BASE_URL}${av1 ? 'av1' : threaded ? 'engine-mt' : 'engine'}/`, document.baseURI);
    let timer;
    try { await Promise.race([ffmpeg.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL: new URL('ffmpeg-core.wasm', base).href, ...(threaded ? { workerURL: new URL('ffmpeg-core.worker.js', base).href } : {}) }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Engine loading timed out. Please retry.')), 60000); })]); }
    catch (error) { if (this.cancelled) throw error; throw new Error(`Could not load the ${av1 ? 'AV1 ' : ''}compression engine. Check your connection and retry. ${error.message || ''}`); }
    finally { clearTimeout(timer); }
    return ffmpeg;
  }
  async mount(ffmpeg, file) {
    await ffmpeg.createDir('/input');
    // WORKERFS reads the selected File on demand, without copying it into WASM memory.
    if (!await ffmpeg.mount('WORKERFS', { files: [file] }, '/input')) throw new Error('Could not read the selected file.');
    return `/input/${file.name}`;
  }
  async probe(file) {
    try {
      const f = await this.load(); const input = await this.mount(f, file);
      const code = await f.ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input, '-o', '/probe.json'], 30000);
      if (code !== 0) throw new Error('Could not read this video. It may be damaged, unsupported, or too large for the browser.');
      return metadata(JSON.parse(await f.readFile('/probe.json', 'utf8')), file.size);
    } finally { this.ffmpeg?.terminate(); this.ffmpeg = null; }
  }
  async preview(file, source) {
    try {
      const width = Math.max(2, Math.floor(Math.min(640, source.width) / 2) * 2);
      const prepared = await this.prepareInput(file, { inputCodec: source.videoCodec, codec: 'libx264', width, height: Math.max(2, Math.round(source.height * width / source.width / 2) * 2), fps: Math.min(30, source.fps), speed: 1, audio: source.audio, duration: source.duration });
      const f = await this.load(); const input = await this.mount(f, prepared.file);
      const code = await f.exec(['-y', '-threads', '1', '-filter_threads', '1', ...decoderOptions(prepared.job.inputCodec), '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=${width}:-2,fps=${Math.min(30, source.fps)}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96000', '-movflags', '+faststart', 'preview.mp4']);
      if (code !== 0) throw new Error('Could not create a preview for this source format. See processing details.');
      return new Blob([await f.readFile('preview.mp4')], { type: 'video/mp4' });
    } finally { this.ffmpeg?.terminate(); this.ffmpeg = null; }
  }
  async prepareInput(file, job) {
    if (job.inputCodec !== 'av1' || job.codec === 'libaom-av1') return { file, job };
    this.checkCancelled();
    this.onLog('AV1 source: decoding locally with libaom before encoding. Applying edits to a temporary lossless video.');
    this.progressScale = .5;
    let decoded;
    try {
      const f = await this.load('libaom-av1'), input = await this.mount(f, file);
      const code = await f.exec(command(job, input, 'decoded.mkv', { intermediate: true }));
      this.checkCancelled();
      if (code !== 0) throw new Error('The software decoder could not process this source.');
      const bytes = await f.readFile('decoded.mkv');
      this.checkCancelled();
      if (!bytes.length) throw new Error('AV1 decoding produced an empty video.');
      decoded = new File([bytes], 'decoded.mkv', { type: 'video/x-matroska' });
    } catch (error) {
      if (this.cancelled) throw error;
      throw new Error(`Could not decode the AV1 source. ${error.message || ''} See processing details. For large videos, try a smaller output resolution to reduce browser memory use.`);
    } finally { this.ffmpeg?.terminate(); this.ffmpeg = null; }
    this.checkCancelled();
    this.progressOffset = job.duration / 2;
    this.onLog('AV1 decoding complete. Encoding the requested output format.');
    return { file: decoded, job: preparedJob(job) };
  }
  async compress(file, job) {
    try {
      if (job.codec === 'libx265' && !globalThis.crossOriginIsolated) throw new Error('HEVC requires browser isolation. Reload this page over HTTPS with service workers enabled, or choose H.264 or AV1.');
      const prepared = await this.prepareInput(file, job);
      const f = await this.load(job.codec); const input = await this.mount(f, prepared.file);
      const code = await f.exec(command(prepared.job, input));
      if (code !== 0) throw new Error('Compression failed. Try a smaller resolution or a faster preset. See processing details for the encoder error.');
      const bytes = await f.readFile('output.mp4');
      if (!bytes.length) throw new Error('The encoder produced an empty file.');
      return new Blob([bytes], { type: 'video/mp4' });
    } finally { this.ffmpeg?.terminate(); this.ffmpeg = null; }
  }
}
