import { describe, it, expect, vi, beforeEach } from 'vitest';
import { capitalize, isEPLMatch, getSportEmoji } from './format';
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
