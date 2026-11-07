import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
for (const [source, target] of [['node_modules/@ffmpeg/core/dist/esm', 'public/engine'], ['vendor/av1', 'public/av1'], ['node_modules/@ffmpeg/core-mt/dist/esm', 'public/engine-mt']]) {
  await mkdir(target, { recursive: true });
  await copyFile(`${source}/ffmpeg-core.wasm`, `${target}/ffmpeg-core.wasm`);
  // Upstream's binding discards ffprobe's normal return value, leaving ret=-1
  // on successful probes. Preserve it; exit_program still sets ret on errors.
  const original = await readFile(`${source}/ffmpeg-core.js`, 'utf8');
  const needle = 'try{Module["_ffprobe"](args.length,stringsToPtr(args))}';
  if (!original.includes(needle)) throw new Error('FFprobe binding changed; review the return-value patch.');
  await writeFile(`${target}/ffmpeg-core.js`, original.replace(needle, 'try{Module["ret"]=Module["_ffprobe"](args.length,stringsToPtr(args))}'));
}

await copyFile('node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js', 'public/engine-mt/ffmpeg-core.worker.js');
