import { describe, it, expect } from 'vitest';
import { resolveMatchesEndpoint } from './api';
import type { Category } from './types';

describe('resolveMatchesEndpoint', () => {
  describe('when sport is not "all"', () => {
    const sport = 'football';

    it('should handle "popular" category', () => {
      const result = resolveMatchesEndpoint('popular', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/football/popular',
        clientSportFilter: false,
      });
    });

    it('should handle "all" category', () => {
      const result = resolveMatchesEndpoint('all', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/football',
        clientSportFilter: false,
      });
    });

    it('should handle "live" category', () => {
      const result = resolveMatchesEndpoint('live', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/live',
        clientSportFilter: true,
      });
    });

    it('should handle "today" category', () => {
      const result = resolveMatchesEndpoint('today', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/all-today',
        clientSportFilter: true,
      });
    });
  });

  describe('when sport is "all"', () => {
    const sport = 'all';

    it('should handle "live" category', () => {
      const result = resolveMatchesEndpoint('live', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/live',
        clientSportFilter: false,
      });
    });

    it('should handle "today" category', () => {
      const result = resolveMatchesEndpoint('today', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/all-today',
        clientSportFilter: false,
      });
    });

    it('should handle "popular" category', () => {
      const result = resolveMatchesEndpoint('popular', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/all/popular',
        clientSportFilter: false,
      });
    });

    it('should handle "all" category', () => {
      const result = resolveMatchesEndpoint('all', sport);
      expect(result).toEqual({
        endpoint: '/api/matches/all',
        clientSportFilter: false,
      });
    });
  });
});
