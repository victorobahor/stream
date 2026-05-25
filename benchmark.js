const { performance } = require('perf_hooks');

// Extract the original isEPLMatch logic
function originalIsEPLMatch(match) {
  if ((match.category || '').toLowerCase() !== 'football') return false;
  const title = (match.title || '').toLowerCase();
  if (title.includes('premier league') || title.includes('epl')) return true;
  const eplTeams = [
    'arsenal', 'aston villa', 'brentford', 'brighton', 'bournemouth', 'chelsea',
    'crystal palace', 'everton', 'fulham', 'ipswich', 'leicester', 'liverpool',
    'manchester city', 'man city', 'manchester united', 'man united', 'man utd',
    'newcastle', 'nottingham forest', 'southampton', 'tottenham', 'spurs',
    'west ham', 'wolves', 'wolverhampton', 'luton', 'burnley', 'sheffield united'
  ];
  const home = (match.teams?.home?.name || '').toLowerCase();
  const away = (match.teams?.away?.name || '').toLowerCase();
  return eplTeams.some(t => home.includes(t) || away.includes(t));
}

// Extract the optimized isEPLMatch logic
function optimizedIsEPLMatch(match) {
  if (match.isEPL !== undefined) return match.isEPL;
  if ((match.category || '').toLowerCase() !== 'football') {
    match.isEPL = false;
    return false;
  }
  const title = (match.title || '').toLowerCase();
  if (title.includes('premier league') || title.includes('epl')) {
    match.isEPL = true;
    return true;
  }
  const eplTeams = [
    'arsenal', 'aston villa', 'brentford', 'brighton', 'bournemouth', 'chelsea',
    'crystal palace', 'everton', 'fulham', 'ipswich', 'leicester', 'liverpool',
    'manchester city', 'man city', 'manchester united', 'man united', 'man utd',
    'newcastle', 'nottingham forest', 'southampton', 'tottenham', 'spurs',
    'west ham', 'wolves', 'wolverhampton', 'luton', 'burnley', 'sheffield united'
  ];
  const home = (match.teams?.home?.name || '').toLowerCase();
  const away = (match.teams?.away?.name || '').toLowerCase();
  match.isEPL = eplTeams.some(t => home.includes(t) || away.includes(t));
  return match.isEPL;
}

// Generate some fake match data
const matches1 = [];
const matches2 = [];
for (let i = 0; i < 5000; i++) {
  const m = {
    category: i % 2 === 0 ? 'football' : 'basketball',
    title: `Match ${i}`,
    teams: {
      home: { name: i % 10 === 0 ? 'Arsenal' : `Team A ${i}` },
      away: { name: `Team B ${i}` }
    }
  };
  matches1.push({...m});
  matches2.push({...m});
}

// Benchmark Original
const startOriginal = performance.now();
for (let i = 0; i < 100; i++) {
  const matchesCopy = [...matches1];
  matchesCopy.sort((a, b) => {
    const aEpl = originalIsEPLMatch(a);
    const bEpl = originalIsEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });
}
const endOriginal = performance.now();
console.log(`Original time: ${(endOriginal - startOriginal).toFixed(2)}ms`);

// Benchmark Optimized
const startOptimized = performance.now();
for (let i = 0; i < 100; i++) {
  const matchesCopy = [...matches2];
  matchesCopy.sort((a, b) => {
    const aEpl = optimizedIsEPLMatch(a);
    const bEpl = optimizedIsEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });
}
const endOptimized = performance.now();
console.log(`Optimized time: ${(endOptimized - startOptimized).toFixed(2)}ms`);
