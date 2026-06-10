import { describe, it, expect, afterEach } from 'vitest';
import { capitalize, isEPLMatch, getSportEmoji, isMatchLive, formatDate } from './format';
import { state } from './state';
import type { APIMatch } from './types';

describe('capitalize', () => {
  it('should capitalize first letter', () => {
    expect(capitalize('football')).toBe('Football');
  });

  it('should handle empty string', () => {
    expect(capitalize('')).toBe('');
  });

  it('should handle already capitalized', () => {
    expect(capitalize('Football')).toBe('Football');
  });
});

describe('isEPLMatch', () => {
  it('should identify EPL matches by title', () => {
    const match: APIMatch = {
      id: '1',
      title: 'Premier League: Arsenal vs Chelsea',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
    };
    expect(isEPLMatch(match)).toBe(true);
  });

  it('should identify EPL matches by team names', () => {
    const match: APIMatch = {
      id: '1',
      title: 'Match',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
      teams: {
        home: { name: 'Arsenal', badge: 'ars' },
        away: { name: 'Chelsea', badge: 'che' },
      },
    };
    expect(isEPLMatch(match)).toBe(true);
  });

  it('should return false for non-football matches', () => {
    const match: APIMatch = {
      id: '1',
      title: 'Lakers vs Celtics',
      category: 'basketball',
      date: Date.now(),
      popular: false,
      sources: [],
    };
    expect(isEPLMatch(match)).toBe(false);
  });

  it('should return false for non-EPL football matches', () => {
    const match: APIMatch = {
      id: '1',
      title: 'Barcelona vs Real Madrid',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
    };
    expect(isEPLMatch(match)).toBe(false);
  });
});

describe('getSportEmoji', () => {
  it('should return correct emoji for known sports', () => {
    expect(getSportEmoji('football')).toBe('⚽');
    expect(getSportEmoji('basketball')).toBe('🏀');
    expect(getSportEmoji('tennis')).toBe('🎾');
  });

  it('should return default emoji for unknown sports', () => {
    expect(getSportEmoji('unknown')).toBe('🏆');
  });

  it('should handle empty string', () => {
    expect(getSportEmoji('')).toBe('🏆');
  });

  it('should be case insensitive', () => {
    expect(getSportEmoji('Football')).toBe('⚽');
    expect(getSportEmoji('FOOTBALL')).toBe('⚽');
  });
});

describe('isMatchLive', () => {
  afterEach(() => {
    state.liveMatchIds.clear();
  });

  it('should return true if match ID is in liveMatchIds', () => {
    state.liveMatchIds.add('match-1');
    const match: APIMatch = { id: 'match-1', title: 'T', category: 'c', date: 0, popular: false, sources: [] };
    expect(isMatchLive(match)).toBe(true);
  });

  it('should return true if match started less than 45 minutes ago', () => {
    const match: APIMatch = {
      id: 'm1', title: 'T', category: 'c', date: Date.now() - 1_800_000, popular: false, sources: [],
    };
    expect(isMatchLive(match)).toBe(true);
  });

  it('should return false if match started more than 45 minutes ago', () => {
    const match: APIMatch = {
      id: 'm1', title: 'T', category: 'c', date: Date.now() - 3_000_000, popular: false, sources: [],
    };
    expect(isMatchLive(match)).toBe(false);
  });

  it('should return false if match has no date', () => {
    const match: APIMatch = { id: 'm1', title: 'T', category: 'c', date: 0, popular: false, sources: [] };
    match.date = 0;
    expect(isMatchLive(match)).toBe(false);
  });

  it('should return false for future matches', () => {
    const match: APIMatch = {
      id: 'm1', title: 'T', category: 'c', date: Date.now() + 3_600_000, popular: false, sources: [],
    };
    expect(isMatchLive(match)).toBe(false);
  });
});

describe('formatDate', () => {
  it('should return "Live now" for matches within 5 hours in the past', () => {
    const ts = Date.now() - 1_000_000;
    expect(formatDate(ts)).toBe('🔴 Live now');
  });

  it('should return relative time for matches within 1 hour in the future', () => {
    const ts = Date.now() + 1_800_000; // 30 minutes
    const result = formatDate(ts);
    expect(result).toMatch(/^In \d+m$/);
  });

  it('should return time-only for matches today', () => {
    const now = new Date();
    const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30).getTime();
    const result = formatDate(ts);
    expect(result).toMatch(/\d+:\d+ [AP]M/);
  });

  it('should return date+time for matches on a different day', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    future.setHours(14, 30, 0, 0);
    const result = formatDate(future.getTime());
    expect(result).toMatch(/\w+ \d+.*\d+:\d+ [AP]M/);
  });
});
