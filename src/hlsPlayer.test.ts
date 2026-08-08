import { describe, it, expect } from 'vitest';
import { nativeHlsConfig, preferHighestLevel } from './hlsPlayer';

describe('nativeHlsConfig', () => {
  it('should disable low-latency mode for standard Streamed HLS', () => {
    const cfg = nativeHlsConfig();
    expect(cfg.lowLatencyMode).toBe(false);
    expect(cfg.abrEwmaDefaultEstimate).toBeGreaterThan(1_000_000);
  });
});

describe('preferHighestLevel', () => {
  it('should pick the tallest / highest-bitrate rung (1080 over 540)', () => {
    const hls: {
      startLevel?: number;
      nextLevel?: number;
    } = {};
    const levels = [
      { height: 540, bitrate: 700_000 },
      { height: 1080, bitrate: 8_000_000 },
    ];
    expect(preferHighestLevel(hls, levels)).toBe(1);
    expect(hls.startLevel).toBe(1);
    expect(hls.nextLevel).toBe(1);
  });

  it('should return -1 when there are no levels', () => {
    expect(preferHighestLevel({}, [])).toBe(-1);
  });
});
