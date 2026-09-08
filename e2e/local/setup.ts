import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup() {
  const dir = resolve('test-results/hls-fixture');
  mkdirSync(dir, { recursive: true });
  // Locally generated video; tests exercise real decoding without depending on a broadcaster.
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '100', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-g', '30', '-sc_threshold', '0', '-b:v', '350k', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
    '-hls_segment_filename', `${dir}/segment-%03d.ts`, `${dir}/master.m3u8`,
  ], { timeout: 30_000 });
}
