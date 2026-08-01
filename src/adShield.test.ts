/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installAdShield, mountPlayGate } from './adShield';

describe('mountPlayGate', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('should append a gate button over the host', () => {
    mountPlayGate(host);
    const gate = host.querySelector('.player-gate');
    expect(gate).toBeTruthy();
    expect(gate?.textContent).toContain('Click to start');
  });

  it('should remove the gate on pointerdown', () => {
    mountPlayGate(host, { message: 'Go' });
    const gate = host.querySelector('.player-gate') as HTMLButtonElement;
    gate.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(host.querySelector('.player-gate')).toBeNull();
  });

  it('should replace an existing gate when mounted again', () => {
    mountPlayGate(host);
    mountPlayGate(host);
    expect(host.querySelectorAll('.player-gate')).toHaveLength(1);
  });
});

describe('installAdShield', () => {
  afterEach(() => {
    // listeners stay; safe to call install again (idempotent)
  });

  it('should be idempotent', () => {
    expect(() => {
      installAdShield();
      installAdShield();
    }).not.toThrow();
  });
});
