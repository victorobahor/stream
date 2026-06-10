import { describe, it, expect } from 'vitest';
import { resolveMatchesEndpoint } from './api';

describe('resolveMatchesEndpoint', () => {
  it('should return live endpoint for live category with all sports', () => {
    const result = resolveMatchesEndpoint('live', 'all');
    expect(result.endpoint).toBe('/api/matches/live');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return all-today endpoint for today category', () => {
    const result = resolveMatchesEndpoint('today', 'all');
    expect(result.endpoint).toBe('/api/matches/all-today');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return popular endpoint for popular category with all sports', () => {
    const result = resolveMatchesEndpoint('popular', 'all');
    expect(result.endpoint).toBe('/api/matches/all/popular');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return all endpoint for all category', () => {
    const result = resolveMatchesEndpoint('all', 'all');
    expect(result.endpoint).toBe('/api/matches/all');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return sport-specific popular endpoint', () => {
    const result = resolveMatchesEndpoint('popular', 'football');
    expect(result.endpoint).toBe('/api/matches/football/popular');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return sport-specific all endpoint', () => {
    const result = resolveMatchesEndpoint('all', 'basketball');
    expect(result.endpoint).toBe('/api/matches/basketball');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return live endpoint with client sport filter for live + specific sport', () => {
    const result = resolveMatchesEndpoint('live', 'tennis');
    expect(result.endpoint).toBe('/api/matches/live');
    expect(result.clientSportFilter).toBe(true);
  });

  it('should return all-today endpoint with client sport filter for today + specific sport', () => {
    const result = resolveMatchesEndpoint('today', 'football');
    expect(result.endpoint).toBe('/api/matches/all-today');
    expect(result.clientSportFilter).toBe(true);
  });
});
