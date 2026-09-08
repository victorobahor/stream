// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playNativeHls, stopNativeHls, getActiveHlsSessionId } from './hlsPlayer';

const mock = vi.hoisted(() => ({ players: [] as MockHls[] }));
type Handler = (event: string, data?: object) => void;
interface MockHls {
  handlers: Map<string, Handler>;
  emit: (event: string, data?: object) => void;
  loadSource: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
vi.mock('hls.js', () => ({
  default: class {
    static isSupported = () => true;
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', BUFFER_APPENDED: 'buffered' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    handlers = new Map<string, Handler>();
    constructor() { mock.players.push(this); }
    on(event: string, handler: Handler) { this.handlers.set(event, handler); }
    emit(event: string, data?: object) { this.handlers.get(event)?.(event, data); }
    loadSource = vi.fn();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    destroy = vi.fn();
    attachMedia() { this.emit('manifest'); this.emit('buffered'); }
  },
}));

const url = 'https://embed.st/embed/admin/test/1';
const response = (id: string) => new Response(JSON.stringify({ sessionId: id, masterUrl: `/api/hls/${id}/master.m3u8` }));
const video = () => document.createElement('video');
beforeEach(() => {
  mock.players.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, 'buffered', 'get').mockReturnValue({ length: 1, start: () => 0, end: () => 12 });
});
afterEach(() => { stopNativeHls(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native playback lifecycle', () => {
  it('waits for a startup buffer before requesting video playback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('abc1')));
    vi.mocked(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'buffered')!.get!)
      .mockReturnValue({ length: 1, start: () => 0, end: () => 2 });
    const playing = playNativeHls(url, { video: video(), key: 'mv-0' });
    await vi.waitFor(() => expect(mock.players).toHaveLength(1));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    vi.mocked(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'buffered')!.get!)
      .mockReturnValue({ length: 1, start: () => 0, end: () => 12 });
    mock.players[0].emit('buffered');
    await expect(playing).resolves.toBe(true);
  });
  it('closes a session whose open finishes after its slot was cleared', async () => {
    let finish: (r: Response) => void = () => {};
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const playing = playNativeHls(url, { video: video(), key: 'mv-0' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    stopNativeHls('mv-0');
    await expect(playing).resolves.toBe(false);
    finish(response('abc123'));
    await vi.waitFor(() => expect(navigator.sendBeacon).toHaveBeenCalledWith('/api/hls/abc123/close'));
    expect(getActiveHlsSessionId('mv-0')).toBeNull();
    expect(mock.players).toHaveLength(0);
  });
  it('reopens an expired session after playback began and closes the old one', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response('abc1')).mockResolvedValueOnce(response('abc2'));
    vi.stubGlobal('fetch', fetch);
    const onError = vi.fn();
    await expect(playNativeHls(url, { video: video(), key: 'mv-1', onError })).resolves.toBe(true);
    mock.players[0].emit('error', { fatal: true, type: 'network', details: '404' });
    await vi.waitFor(() => expect(getActiveHlsSessionId('mv-1')).toBe('abc2'));
    expect(navigator.sendBeacon).toHaveBeenCalledWith('/api/hls/abc1/close');
    expect(mock.players[0].loadSource).toHaveBeenLastCalledWith('/api/hls/abc2/master.m3u8');
    expect(fetch.mock.calls[1][0]).toContain('&refresh=1');
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports exhausted recovery to the owning slot without stopping its sibling', async () => {
    let id = 0;
    vi.stubGlobal('fetch', vi.fn(async () => response(`abc${++id}`)));
    const onError = vi.fn();
    await playNativeHls(url, { video: video(), key: 'mv-0', onError });
    await playNativeHls(url, { video: video(), key: 'mv-1' });
    const sibling = getActiveHlsSessionId('mv-1');
    for (let i = 0; i < 3; i++) {
      mock.players[0].emit('error', { fatal: true, type: 'network' });
      await new Promise(r => setTimeout(r, 0));
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(getActiveHlsSessionId('mv-0')).toBeNull();
    expect(getActiveHlsSessionId('mv-1')).toBe(sibling);
  });
  it('passes SportSRC wrappers to the server and never opens an iframe', async () => {
    const fetch = vi.fn(async (_url: string) => response('abc1'));
    vi.stubGlobal('fetch', fetch);
    await playNativeHls('https://embed.streamapi.cc/sport/game/', { video: video(), key: 'main' });
    expect(String(fetch.mock.calls[0][0])).toContain(encodeURIComponent('https://embed.streamapi.cc/sport/game/'));
    expect(document.querySelector('iframe')).toBeNull();
  });
});
