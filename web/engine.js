import { FFmpeg } from '@ffmpeg/ffmpeg';
import { metadata, command } from './compressor.js';
export class BrowserCompressor {
  constructor(onLog, onProgress) { this.onLog = onLog; this.onProgress = onProgress; this.ffmpeg = null; this.cancelled = false; }
  cancel() { this.cancelled = true; this.ffmpeg?.terminate(); this.ffmpeg = null; }
  async load(codec = 'libx264') {
    const av1 = codec === 'libaom-av1', threaded = codec === 'libx265';
    if (threaded && !globalThis.crossOriginIsolated) throw new Error('HEVC requires browser isolation. Reload this page over HTTPS with service workers enabled, or choose H.264 or AV1.');
    const ffmpeg = new FFmpeg(); this.ffmpeg = ffmpeg;
    ffmpeg.on('log', ({ message }) => this.onLog(message));
    ffmpeg.on('progress', ({ time }) => this.onProgress(time / 1000000));
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
  async compress(file, job) {
    try {
      const f = await this.load(job.codec); const input = await this.mount(f, file);
      const code = await f.exec(command(job, input));
      if (code !== 0) throw new Error('Compression failed. Try a smaller resolution or a faster preset. See processing details for the encoder error.');
      const bytes = await f.readFile('output.mp4');
      if (!bytes.length) throw new Error('The encoder produced an empty file.');
      return new Blob([bytes], { type: 'video/mp4' });
    } finally { this.ffmpeg?.terminate(); this.ffmpeg = null; }
  }
}
