import { describe, it, expect } from 'vitest';
import {
  nativeHlsConfig,
  preferHighestLevel,
  shouldRetryHlsOpen,
  withHlsOpenSlot,
  shouldStartMuted,
} from './hlsPlayer';

describe('nativeHlsConfig', () => {
  it('should disable low-latency mode for standard Streamed HLS', () => {
    const cfg = nativeHlsConfig();
    expect(cfg.lowLatencyMode).toBe(false);
    expect(cfg.abrEwmaDefaultEstimate).toBeGreaterThan(1_000_000);
  });

  it('should use a shorter buffer and lower ABR start for compact multiview', () => {
    const main = nativeHlsConfig();
    const mv = nativeHlsConfig({ compact: true });
    expect(mv.lowLatencyMode).toBe(false);
    expect(Number(mv.maxBufferLength)).toBeLessThan(Number(main.maxBufferLength));
    expect(Number(mv.maxMaxBufferLength)).toBeLessThan(Number(main.maxMaxBufferLength));
    expect(Number(mv.abrEwmaDefaultEstimate)).toBeLessThan(Number(main.abrEwmaDefaultEstimate));
    expect(Number(mv.abrEwmaDefaultEstimate)).toBeLessThanOrEqual(1_000_000);
    expect(mv.capLevelToPlayerSize).toBe(true);
    expect(main.capLevelToPlayerSize).toBe(false);
  });
});

describe('shouldStartMuted', () => {
  it('should keep multiview panes muted so four can autoplay together', () => {
    expect(shouldStartMuted('mv-0')).toBe(true);
    expect(shouldStartMuted('mv-3')).toBe(true);
    expect(shouldStartMuted('main')).toBe(false);
  });
});

describe('shouldRetryHlsOpen', () => {
  it('should retry transient Playwright capacity and crash responses', () => {
    expect(shouldRetryHlsOpen(429)).toBe(true);
    expect(shouldRetryHlsOpen(503)).toBe(true);
    expect(shouldRetryHlsOpen(400)).toBe(false);
    expect(shouldRetryHlsOpen(200)).toBe(false);
  });
});

describe('withHlsOpenSlot', () => {
  it('should mint at most two native sessions at a time', async () => {
    let current = 0;
    let peak = 0;
    const run = () =>
      withHlsOpenSlot(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise(r => setTimeout(r, 40));
        current -= 1;
      });
    await Promise.all([run(), run(), run(), run()]);
    expect(peak).toBeLessThanOrEqual(2);
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
