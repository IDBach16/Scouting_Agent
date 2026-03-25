/* ============================================
   APP.JS — Data processing, routing, chat, autocomplete
   Moeller Game Prep Agent V3
   ============================================ */

let rawData = [];
let filteredData = [];
let seasonFilter = 'all';
let appMode = 'dugout'; // 'dugout' or 'full'
let stats = { opponentPitchers:{}, moellerHitters:{}, moellerPitchers:{}, opponentTeams:{}, opponentBatters:{}, teamList:[], moellerPitcherList:[], moellerHitterList:[] };
window.appStats = stats; // expose for charts.js
let isLoading = false;
let sessionId = 'session_' + Date.now();
let allNames = []; // for autocomplete

// GCL Conference player IDs — links to https://gcls.gclsports.com/bsPlayerStats.aspx?player={ID}
const GCL_BASE = 'https://gcls.gclsports.com/';
const GCL_PLAYERS = {
  // Moeller
  "Reggie Watson": "884406", "Kayde Ridley": "880249", "Teagan Cumberland": "880255",
  "Gunnar Voellmecke": "884407", "Adam Holstein": "880251", "Adam Maybury": "880252",
  "Ronnie Allen": "884408", "Matt Ponatoski": "880247", "Zac Wittenauer": "884409",
  "Graham Cohen": "884410", "Seth Maybury": "884411", "Rudy Glotfelty": "884412",
  "Ricky Maschinot": "884413", "Maddox Nelson": "884414", "Cooper Homoelle": "884415",
  "Donovan Glosser": "880250", "Nathan McDowell": "880256", "Ryan Szitanko": "884416",
  "Carson Fuhrer": "884417", "Sawyer Barhorst": "884418", "Connor Maupin": "884419",
  "Jake Gaerke": "880254", "Jack Ujvagi": "884420", "Conner Cuozzo": "880248",
  "Michael Weber": "884421", "Kendon Wilson": "884422",
  // Elder
  "Mason Chumbley": "882336", "Ryan Smith": "882333", "Luke Roell": "882332",
  "Kyle Bien": "882339", "Brady Andriacco": "885353", "Charlie Schroeder": "885352",
  "Jack Rosenacker": "882334", "Bradley Kammer": "882337", "Roger Waddell": "882335",
  "Matthew Nguyen": "884593", "Justin Massa": "882329", "Carson Smith": "882331",
  "Dylan Wullenweber": "882328", "Aidan Porzell": "884594", "Noah Gruen": "884595",
  "Caleb McComas": "882326", "Jared Lammers": "882330", "Sam Theissen": "882338",
  "Tucker Veldhaus": "882327", "Brandon Schapker": "884596",
  // St. Xavier
  "Dillon Brus": "884074", "Cullen O'Brien": "884066", "Griffin Doxsey": "884060",
  "Sam Sprengard": "884077", "Logan Von Holle": "884075", "Graham Uran": "884078",
  "Ryan Krause": "884070", "Dominick Dials": "884061", "Braden Bricking": "884058",
  "Sam Vovak": "884079", "Jackson Sherrard": "884059", "Thomas George": "884063",
  "Jack Ryan": "884068", "Eric Nienaber": "884062", "Matthew Schafer": "884076",
  "Charlie Johnston": "884071", "Liam McGeady": "884069", "Will Holekamp": "884073",
  "Cameron Kline": "884065", "Griffin Lyons": "884072", "William Sweeney": "884064",
};

const GCL_TEAMS = {
  "Moeller": { id: 17, name: "Moeller" },
  "Elder": { id: 14, name: "Elder" },
  "Elder High School": { id: 14, name: "Elder" },
  "La Salle": { id: 15, name: "La Salle" },
  "La Salle High School": { id: 15, name: "La Salle" },
  "St. Xavier": { id: 20, name: "St. Xavier" },
  "St. Xavier High School": { id: 20, name: "St. Xavier" },
};

function injectGCLLinks(html) {
  // Inject clickable GCL links for player names found in the output
  // Sort by name length descending to avoid partial replacements
  const names = Object.keys(GCL_PLAYERS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const id = GCL_PLAYERS[name];
    const url = GCL_BASE + 'bsPlayerStats.aspx?player=' + id;
    // Only replace names NOT already inside an <a> tag
    const regex = new RegExp('(?<!<a[^>]*>)\\b(' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b(?![^<]*<\\/a>)', 'g');
    html = html.replace(regex, `<a href="${url}" target="_blank" style="color:#4a90d9; text-decoration:underline; cursor:pointer;" title="View ${name} on GCL">$1</a>`);
  }
  // Also inject team links
  for (const [teamName, info] of Object.entries(GCL_TEAMS)) {
    if (teamName === 'Moeller') continue; // skip linking Moeller itself
    const url = GCL_BASE + 'bsTeamStats.aspx?sat=21&schoolid=' + info.id + '&year=2025';
    const regex = new RegExp('(?<!<a[^>]*>)\\b(' + teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b(?![^<]*<\\/a>)', 'g');
    html = html.replace(regex, `<a href="${url}" target="_blank" style="color:#4a90d9; text-decoration:underline;" title="View ${info.name} on GCL">$1</a>`);
  }
  return html;
}

// ── GCL Stats Integration ──────────────────────────────────────
const _gclCache = {};

async function fetchGCLStats(teamName, year = 2025) {
  const key = `${teamName.toLowerCase()}_${year}`;
  if (_gclCache[key]) return _gclCache[key];
  // Find matching GCL team
  const match = Object.entries(GCL_TEAMS).find(([k]) => k.toLowerCase() === teamName.toLowerCase());
  if (!match) return null;
  const school = match[1].name;
  try {
    const resp = await fetch(`/api/gcl/team?school=${encodeURIComponent(school)}&year=${year}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) return null;
    _gclCache[key] = data;
    return data;
  } catch (e) { return null; }
}

function buildGCLStatsCard(gclData, showType = 'both') {
  // showType: 'hitting', 'pitching', or 'both'
  const card = document.createElement('div');
  card.className = 'quick-look-card';
  card.style.borderLeft = '3px solid #4a90d9';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="ql-name">📊 GCL Season Stats — ${gclData.school} ${gclData.year}</span>
    <span class="ql-meta"><a href="${gclData.url}" target="_blank" style="color:#4a90d9;">View on GCL →</a></span>`;
  card.appendChild(header);

  if ((showType === 'hitting' || showType === 'both') && gclData.hitting?.players?.length) {
    const section = document.createElement('div');
    section.className = 'ql-relay-section';
    section.innerHTML = '<div class="ql-relay-title">HITTING</div>';

    const table = document.createElement('div');
    table.className = 'ql-pitch-table';
    table.innerHTML = `<div class="ql-pitch-header">
      <span class="ql-pitch-val" style="flex:2;text-align:left">PLAYER</span>
      <span class="ql-pitch-val">G</span>
      <span class="ql-pitch-val">AB</span>
      <span class="ql-pitch-val">AVG</span>
      <span class="ql-pitch-val">OBP</span>
      <span class="ql-pitch-val">HR</span>
      <span class="ql-pitch-val">RBI</span>
      <span class="ql-pitch-val">SB</span>
    </div>`;

    // Sort by AB descending (regulars first)
    const hitters = [...gclData.hitting.players].sort((a, b) => b.AB - a.AB);
    hitters.forEach(p => {
      if (p.AB === 0) return; // skip 0 AB
      const gclId = p.player_id ? `<a href="${GCL_BASE}bsPlayerStats.aspx?player=${p.player_id}" target="_blank" style="color:#4a90d9;">${p.name}</a>` : p.name;
      const cls = p.class ? ` <span style="color:#888;font-size:0.8em">(${p.class})</span>` : '';
      table.innerHTML += `<div class="ql-pitch-row">
        <span class="ql-pitch-val" style="flex:2;text-align:left">${gclId}${cls}</span>
        <span class="ql-pitch-val">${p.G}</span>
        <span class="ql-pitch-val">${p.AB}</span>
        <span class="ql-pitch-val" style="font-weight:bold;color:${p.AVG >= 0.300 ? '#2ECC71' : p.AVG >= 0.250 ? '#F1C40F' : '#ccc'}">${p.AVG != null ? p.AVG.toFixed(3) : '-'}</span>
        <span class="ql-pitch-val">${p.OBP != null ? p.OBP.toFixed(3) : '-'}</span>
        <span class="ql-pitch-val">${p.HR}</span>
        <span class="ql-pitch-val">${p.RBI}</span>
        <span class="ql-pitch-val">${p.SB}</span>
      </div>`;
    });
    section.appendChild(table);
    card.appendChild(section);
  }

  if ((showType === 'pitching' || showType === 'both') && gclData.pitching?.players?.length) {
    const section = document.createElement('div');
    section.className = 'ql-relay-section';
    section.innerHTML = '<div class="ql-relay-title">PITCHING</div>';

    const table = document.createElement('div');
    table.className = 'ql-pitch-table';
    table.innerHTML = `<div class="ql-pitch-header">
      <span class="ql-pitch-val" style="flex:2;text-align:left">PLAYER</span>
      <span class="ql-pitch-val">G</span>
      <span class="ql-pitch-val">IP</span>
      <span class="ql-pitch-val">W-L</span>
      <span class="ql-pitch-val">ERA</span>
      <span class="ql-pitch-val">WHIP</span>
      <span class="ql-pitch-val">K</span>
      <span class="ql-pitch-val">SV</span>
    </div>`;

    // Sort by IP descending
    const pitchers = [...gclData.pitching.players].sort((a, b) => (b.IP || 0) - (a.IP || 0));
    pitchers.forEach(p => {
      if (!p.IP || p.IP === 0) return;
      const gclId = p.player_id ? `<a href="${GCL_BASE}bsPlayerStats.aspx?player=${p.player_id}" target="_blank" style="color:#4a90d9;">${p.name}</a>` : p.name;
      const cls = p.class ? ` <span style="color:#888;font-size:0.8em">(${p.class})</span>` : '';
      table.innerHTML += `<div class="ql-pitch-row">
        <span class="ql-pitch-val" style="flex:2;text-align:left">${gclId}${cls}</span>
        <span class="ql-pitch-val">${p.G}</span>
        <span class="ql-pitch-val">${p.IP}</span>
        <span class="ql-pitch-val">${p.W}-${p.L}</span>
        <span class="ql-pitch-val" style="font-weight:bold;color:${p.ERA != null && p.ERA <= 2.5 ? '#2ECC71' : p.ERA <= 4.0 ? '#F1C40F' : '#E63946'}">${p.ERA != null ? p.ERA.toFixed(2) : '-'}</span>
        <span class="ql-pitch-val">${p.WHIP != null ? p.WHIP.toFixed(2) : '-'}</span>
        <span class="ql-pitch-val">${p.K}</span>
        <span class="ql-pitch-val">${p.SV}</span>
      </div>`;
    });
    section.appendChild(table);
    card.appendChild(section);
  }

  return card;
}

function tryInjectGCLStats(container, teamName, showType = 'both') {
  // Check if this is a GCL team and async-inject stats card
  const match = Object.entries(GCL_TEAMS).find(([k]) => k.toLowerCase() === teamName.toLowerCase());
  if (!match) return;
  fetchGCLStats(teamName).then(data => {
    if (!data) return;
    const gclCard = buildGCLStatsCard(data, showType);
    // Insert as the first child (before charting data cards)
    if (container.firstChild) {
      container.insertBefore(gclCard, container.firstChild);
    } else {
      container.appendChild(gclCard);
    }
  });
}

const chatArea = document.getElementById('chat-area');
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const dataStatus = document.getElementById('data-status');
const statusText = dataStatus.querySelector('.status-text');
const acList = document.getElementById('autocomplete-list');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadCSV();
  bindEvents();
  initMenu();
});

function bindEvents() {
  sendBtn.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape') hideAC();
  });
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
    showAutocomplete();
  });
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => { userInput.value = btn.dataset.q; sendMessage(); });
  });
  document.querySelectorAll('.season-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      seasonFilter = btn.dataset.season;
      reprocessData();
    });
  });
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appMode = btn.dataset.mode;
      updateModeUI();
    });
  });
  // Git push button
  const gitBtn = document.getElementById('git-push-btn');
  if (gitBtn) {
    gitBtn.addEventListener('click', async () => {
      gitBtn.disabled = true;
      gitBtn.textContent = 'Pushing...';
      try {
        const res = await fetch('/api/git-push', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          gitBtn.textContent = 'Pushed!';
          gitBtn.style.background = '#4caf50';
        } else {
          gitBtn.textContent = 'Failed';
          gitBtn.style.background = '#e53935';
          console.error('Git push failed:', data.message);
        }
      } catch (err) {
        gitBtn.textContent = 'Error';
        gitBtn.style.background = '#e53935';
        console.error('Git push error:', err);
      }
      setTimeout(() => {
        gitBtn.disabled = false;
        gitBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z"/></svg> Push';
        gitBtn.style.background = '';
      }, 3000);
    });
  }

  // Init mode on load
  updateModeUI();
  document.addEventListener('click', e => { if (!e.target.closest('#input-area')) hideAC(); });
}

// ===== CSV =====
function loadCSV() {
  updateStatus('loading', 'Loading...');
  Papa.parse('data.csv', {
    download: true, header: true, skipEmptyLines: true,
    complete: r => {
      rawData = r.data;
      reprocessData();
    },
    error: () => {
      updateStatus('error', 'CSV failed');
      showError('Could not load data.csv.');
    },
  });
}

function reprocessData() {
  // Reset
  stats.opponentPitchers = {}; stats.moellerHitters = {}; stats.moellerPitchers = {};
  stats.opponentTeams = {}; stats.opponentBatters = {}; stats.teamList = []; stats.moellerPitcherList = [];
  stats.moellerHitterList = [];

  filteredData = seasonFilter === 'all' ? rawData : rawData.filter(r => {
    const d = (r.Date || '');
    // Support both "3/23/2024" and "2024-03-23" date formats
    return d.includes('/' + seasonFilter) || d.startsWith(seasonFilter + '-');
  });

  preprocessData(filteredData);
  const tCount = stats.teamList.length;
  const pCount = stats.moellerPitcherList.length;
  const hCount = stats.moellerHitterList.length;
  updateStatus('ready', `${filteredData.length.toLocaleString()} pitches | ${tCount} teams | ${pCount} pitchers | ${hCount} hitters`);

  // Build autocomplete list
  allNames = [];
  stats.teamList.forEach(t => allNames.push({ name: t, type: 'team' }));
  stats.moellerPitcherList.forEach(p => allNames.push({ name: p, type: 'pitcher' }));
  stats.moellerHitterList.forEach(h => allNames.push({ name: h, type: 'hitter' }));
  Object.keys(stats.opponentPitchers).forEach(p => allNames.push({ name: p, type: 'opp pitcher' }));

  // Compute dataset averages for tendency comparisons
  computeDatasetAverages();
}

function updateStatus(state, text) {
  dataStatus.className = 'status-badge ' + state;
  statusText.textContent = text;
}

// ===== PREPROCESSING =====
function preprocessData(data) {
  data.forEach(row => {
    const pTeam = (row.PitcherTeam||'').trim();
    const bTeam = (row.BatterTeam||'').trim();
    const pitcher = (row.Pitcher||'').trim();
    const batter = (row.Batter||'').trim();
    const isMoeP = /moeller/i.test(pTeam);
    const isMoeB = /moeller/i.test(bTeam);

    if (!isMoeP && pitcher) {
      if (!stats.opponentPitchers[pitcher]) stats.opponentPitchers[pitcher] = { team: pTeam, hand: row.PitcherHand, pitches: [] };
      stats.opponentPitchers[pitcher].pitches.push(row);
    }
    if (isMoeB && batter) {
      if (!stats.moellerHitters[batter]) stats.moellerHitters[batter] = { hand: row['Batter Hand'], pitches: [] };
      stats.moellerHitters[batter].pitches.push(row);
    }
    if (!isMoeB && batter) {
      if (!stats.opponentBatters[batter]) stats.opponentBatters[batter] = { team: bTeam, hand: row['Batter Hand'], pitches: [] };
      stats.opponentBatters[batter].pitches.push(row);
    }
    if (isMoeP && pitcher) {
      if (!stats.moellerPitchers[pitcher]) stats.moellerPitchers[pitcher] = { hand: row.PitcherHand, pitches: [] };
      stats.moellerPitchers[pitcher].pitches.push(row);
    }
    const oppTeam = isMoeP ? bTeam : (isMoeB ? pTeam : null);
    if (oppTeam && !/moeller/i.test(oppTeam)) {
      if (!stats.opponentTeams[oppTeam]) stats.opponentTeams[oppTeam] = { pitches: [] };
      stats.opponentTeams[oppTeam].pitches.push(row);
    }
  });
  stats.teamList = Object.keys(stats.opponentTeams).sort();
  stats.moellerPitcherList = Object.keys(stats.moellerPitchers).sort();
  stats.moellerHitterList = Object.keys(stats.moellerHitters).sort();
  window.appStats = stats;
}

// ===== NORMALIZE PITCH TYPE (global for charts.js too) =====
function normalizePitchType(pt) {
  const t = (pt||'').trim().toLowerCase();
  if (t.includes('two seam') || t === '2 seam fast ball') return 'Two Seam';
  if (t.includes('cut')) return 'Cutter';
  if (t === 'fast ball' || t === 'fastball') return 'Fastball';
  if (t === 'slider') return 'Slider';
  if (t === 'curveball' || t === 'curve') return 'Curveball';
  if (t === 'breaking ball') return 'Breaking Ball';
  if (t === 'change up' || t === 'changeup') return 'Changeup';
  if (t === 'splitter') return 'Splitter';
  return pt || 'Unknown';
}

// ===== STAT COMPUTATION =====
function pct(n, d) { return (!d || d === 0) ? 'N/A' : ((n/d)*100).toFixed(1)+'%'; }
function avg(a) { return a.length === 0 ? null : (a.reduce((s,v)=>s+v,0)/a.length).toFixed(1); }

function computePitcherProfile(pitches, name, hand, team) {
  const total = pitches.length;
  if (!total) return null;
  const pitchTypes={}, pitchTypeByCount={first_pitch:{},ahead:{},behind:{},even:{},two_strikes:{}};
  const veloByType={}, whiffByType={}, swingsByType={};
  let zones={Heart:0,Shadow:0,Chase:0,Waste:0};
  let totalPA=0, ks=0, bbs=0, hrs=0, hits=0, firstPitchStrikes=0, firstPitches=0, totalStrikes=0, totalBalls=0;
  const vsRHH={pitches:0,ks:0,bbs:0,hits:0,hrs:0,abs:0};
  const vsLHH={pitches:0,ks:0,bbs:0,hits:0,hrs:0,abs:0};
  const seenPA = new Set();

  pitches.forEach(row => {
    const pt = normalizePitchType(row.PitchType);
    const result = (row.PitchResult||'').trim();
    const abResult = (row.AtBatResult||'').trim();
    const zone = (row.AttackZone||'').trim();
    const velo = parseFloat(row.PitchVelo);
    const bHand = (row['Batter Hand']||'').trim().toUpperCase();
    const b = parseInt(row.Balls)||0, s = parseInt(row.Strikes)||0;
    const labels = [];
    if (b===0&&s===0) labels.push('first_pitch');
    if (s===2) labels.push('two_strikes');
    if (s>b) labels.push('ahead'); else if (b>s) labels.push('behind'); else labels.push('even');

    pitchTypes[pt] = (pitchTypes[pt]||0)+1;
    labels.forEach(l => { if (pitchTypeByCount[l]) pitchTypeByCount[l][pt] = (pitchTypeByCount[l][pt]||0)+1; });
    if (!isNaN(velo)&&velo>0) { if (!veloByType[pt]) veloByType[pt]=[]; veloByType[pt].push(velo); }
    if (zones.hasOwnProperty(zone)) zones[zone]++;
    const isSwing = result.includes('Swing')||result.includes('Foul')||result.includes('In Play');
    const isStrike = result.includes('Strike')||result.includes('Foul')||result.includes('In Play');
    const isBall = result==='Ball'||result.includes('Ball');
    if (isStrike) totalStrikes++;
    if (isBall) totalBalls++;
    if (isSwing) swingsByType[pt] = (swingsByType[pt]||0)+1;
    if (result.includes('Swing and Miss')) whiffByType[pt] = (whiffByType[pt]||0)+1;
    if (b===0&&s===0) { firstPitches++; if (isStrike) firstPitchStrikes++; }

    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Batter}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey); totalPA++;
      const isHit = ['1B','2B','3B','HR'].includes(abResult);
      const isAB = !['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
      if (abResult==='Strike Out') ks++;
      if (['BB','HBP','IBB'].includes(abResult)) bbs++;
      if (abResult==='HR') hrs++;
      if (isHit) hits++;
      const sp = bHand==='R' ? vsRHH : vsLHH;
      sp.pitches++; if (abResult==='Strike Out') sp.ks++;
      if (['BB','HBP','IBB'].includes(abResult)) sp.bbs++;
      if (isHit) sp.hits++; if (abResult==='HR') sp.hrs++; if (isAB) sp.abs++;
    }
  });

  const pitchMix = {};
  Object.keys(pitchTypes).sort((a,b)=>pitchTypes[b]-pitchTypes[a]).forEach(pt => {
    pitchMix[pt] = { count:pitchTypes[pt], pct:pct(pitchTypes[pt],total), avgVelo:veloByType[pt]?avg(veloByType[pt]):null, veloMin:veloByType[pt]?Math.min(...veloByType[pt]).toFixed(0):null, veloMax:veloByType[pt]?Math.max(...veloByType[pt]).toFixed(0):null, whiffRate:pct(whiffByType[pt]||0,swingsByType[pt]||0) };
  });
  const pitchMixByCount = {};
  Object.keys(pitchTypeByCount).forEach(cl => {
    const cp = pitchTypeByCount[cl];
    const ct = Object.values(cp).reduce((a,b)=>a+b,0);
    if (ct>0) { pitchMixByCount[cl]={}; Object.keys(cp).forEach(pt => { pitchMixByCount[cl][pt]=pct(cp[pt],ct); }); }
  });
  const zoneTotal = zones.Heart+zones.Shadow+zones.Chase+zones.Waste;
  const fmtSplit = s => ({ PA:s.pitches, AVG:s.abs>0?(s.hits/s.abs).toFixed(3):'N/A', K_rate:pct(s.ks,s.pitches), BB_rate:pct(s.bbs,s.pitches), HR:s.hrs });

  return {
    name, team:team||'', hand:hand||'', totalPitches:total, totalPA, pitchMix, pitchMixByCount,
    zoneProfile: { 'Zone% (Heart+Shadow)':pct(zones.Heart+zones.Shadow,zoneTotal), 'Heart%':pct(zones.Heart,zoneTotal), 'Shadow%':pct(zones.Shadow,zoneTotal), 'Chase%':pct(zones.Chase,zoneTotal), 'Waste%':pct(zones.Waste,zoneTotal) },
    K_rate:pct(ks,totalPA), BB_rate:pct(bbs,totalPA), HR_rate:pct(hrs,totalPA),
    Strike_pct:pct(totalStrikes,total), Ball_pct:pct(totalBalls,total),
    firstPitchStrike:pct(firstPitchStrikes,firstPitches),
    vsRHH:fmtSplit(vsRHH), vsLHH:fmtSplit(vsLHH),
    sampleSizeWarning: total<30 ? `Small sample: only ${total} pitches` : null,
  };
}

function computeHitterProfile(pitches, name, hand) {
  const total = pitches.length;
  if (!total) return null;
  const byPitchType={};
  let chaseSwings=0, chasePitches=0;
  const vsRHP={pa:0,abs:0,hits:0,ks:0}, vsLHP={pa:0,abs:0,hits:0,ks:0};
  const byCount={first_pitch:{pa:0,abs:0,hits:0,ks:0},ahead:{pa:0,abs:0,hits:0,ks:0},behind:{pa:0,abs:0,hits:0,ks:0},even:{pa:0,abs:0,hits:0,ks:0},two_strikes:{pa:0,abs:0,hits:0,ks:0}};
  let totalPA=0, totalHits=0, totalAB=0, totalKs=0, totalBBs=0;
  const seenPA=new Set();
  const chasePitchesByType={}, chaseSwingsByType={};

  pitches.forEach(row => {
    const pt=normalizePitchType(row.PitchType);
    const result=(row.PitchResult||'').trim();
    const abResult=(row.AtBatResult||'').trim();
    const zone=(row.AttackZone||'').trim();
    const pH=(row.PitcherHand||'').trim().toUpperCase();
    const b=parseInt(row.Balls)||0, s=parseInt(row.Strikes)||0;
    if (!byPitchType[pt]) byPitchType[pt]={pitches:0,swings:0,whiffs:0,hits:0,abs:0};
    byPitchType[pt].pitches++;
    const isSwing=result.includes('Swing')||result.includes('Foul')||result.includes('In Play');
    if (isSwing) byPitchType[pt].swings++;
    if (result.includes('Swing and Miss')) byPitchType[pt].whiffs++;
    if (zone==='Chase'||zone==='Waste') {
      chasePitches++;
      if (isSwing) chaseSwings++;
      chasePitchesByType[pt]=(chasePitchesByType[pt]||0)+1;
      if (isSwing) chaseSwingsByType[pt]=(chaseSwingsByType[pt]||0)+1;
    }
    const paKey=`${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Pitcher}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey); totalPA++;
      const isHit=['1B','2B','3B','HR'].includes(abResult);
      const isAB=!['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
      if (isHit) totalHits++; if (isAB) totalAB++;
      if (abResult==='Strike Out') totalKs++;
      if (['BB','HBP','IBB'].includes(abResult)) totalBBs++;
      if (isAB) byPitchType[pt].abs++; if (isHit) byPitchType[pt].hits++;
      const sp=pH==='R'?vsRHP:vsLHP;
      sp.pa++; if (isAB) sp.abs++; if (isHit) sp.hits++; if (abResult==='Strike Out') sp.ks++;
      const cats=[];
      if (b===0 && s===0) cats.push('first_pitch');
      if (s===2) cats.push('two_strikes');
      if (b>s) cats.push('ahead');
      else if (s>b) cats.push('behind');
      else cats.push('even');
      cats.forEach(cc=>{ if (byCount[cc]) { byCount[cc].pa++; if (isAB) byCount[cc].abs++; if (isHit) byCount[cc].hits++; if (abResult==='Strike Out') byCount[cc].ks++; } });
    }
  });

  const resultsByPitchType={};
  Object.keys(byPitchType).forEach(pt => {
    const d=byPitchType[pt];
    resultsByPitchType[pt]={ pitchesSeen:d.pitches, AVG:d.abs>0?(d.hits/d.abs).toFixed(3):'N/A', whiffRate:pct(d.whiffs,d.swings), chaseRate:pct(chaseSwingsByType[pt]||0,chasePitchesByType[pt]||0) };
  });
  const fmtCount=c=>({AVG:c.abs>0?(c.hits/c.abs).toFixed(3):'N/A', K_rate:c.pa>0?pct(c.ks,c.pa):'N/A'});

  return {
    name, hand:hand||'', totalPitchesSeen:total, totalPA,
    AVG:totalAB>0?(totalHits/totalAB).toFixed(3):'N/A',
    K_rate:pct(totalKs,totalPA), BB_rate:pct(totalBBs,totalPA),
    overallChaseRate:pct(chaseSwings,chasePitches),
    resultsByPitchType,
    vsRHP:{AVG:vsRHP.abs>0?(vsRHP.hits/vsRHP.abs).toFixed(3):'N/A',K_rate:vsRHP.pa>0?pct(vsRHP.ks,vsRHP.pa):'N/A'},
    vsLHP:{AVG:vsLHP.abs>0?(vsLHP.hits/vsLHP.abs).toFixed(3):'N/A',K_rate:vsLHP.pa>0?pct(vsLHP.ks,vsLHP.pa):'N/A'},
    byCount:{first_pitch:fmtCount(byCount.first_pitch),ahead:fmtCount(byCount.ahead),behind:fmtCount(byCount.behind),even:fmtCount(byCount.even),two_strikes:fmtCount(byCount.two_strikes)},
    sampleSizeWarning:total<30?`Small sample: only ${total} pitches`:'',
  };
}

function computeTeamSummary(teamName) {
  const tp=stats.opponentTeams[teamName]?.pitches||[];
  if (!tp.length) return null;
  const pitchersForTeam={};
  tp.forEach(row => {
    const p=(row.Pitcher||'').trim();
    const pt=(row.PitcherTeam||'').trim();
    if (pt.toLowerCase()===teamName.toLowerCase()&&p) {
      if (!pitchersForTeam[p]) pitchersForTeam[p]={hand:row.PitcherHand,pitches:0,innings:new Set()};
      pitchersForTeam[p].pitches++; pitchersForTeam[p].innings.add(`${row.Date}-${row.Inning}`);
    }
  });
  const teamPitchMix={};let totalTP=0;
  tp.forEach(row => {
    if (!/moeller/i.test(row.PitcherTeam)) {
      const pt=(row.PitchType||'').trim();
      if (pt) { teamPitchMix[pt]=(teamPitchMix[pt]||0)+1; totalTP++; }
    }
  });
  const ps={};
  Object.keys(pitchersForTeam).forEach(p => { ps[p]={hand:pitchersForTeam[p].hand,totalPitches:pitchersForTeam[p].pitches,estInnings:pitchersForTeam[p].innings.size}; });
  const tm={};
  Object.keys(teamPitchMix).sort((a,b)=>teamPitchMix[b]-teamPitchMix[a]).forEach(pt => { tm[pt]=pct(teamPitchMix[pt],totalTP); });
  return {team:teamName,totalPitchesInData:tp.length,pitchers:ps,teamPitchMix:tm};
}

// ===== TENDENCY HELPERS =====
function getTeamOffensePitches(teamName) {
  // Pitches where this team is batting
  const isM = /moeller/i.test(teamName);
  if (isM) {
    const all = [];
    Object.values(stats.moellerHitters).forEach(h => all.push(...h.pitches));
    return all;
  }
  return filteredData.filter(row => {
    const bTeam = (row.BatterTeam || '').trim();
    return bTeam.toLowerCase() === teamName.toLowerCase();
  });
}

function getTeamPitchingPitches(teamName) {
  // Pitches where this team is pitching
  const isM = /moeller/i.test(teamName);
  if (isM) {
    const all = [];
    Object.values(stats.moellerPitchers).forEach(p => all.push(...p.pitches));
    return all;
  }
  return filteredData.filter(row => {
    const pTeam = (row.PitcherTeam || '').trim();
    return pTeam.toLowerCase() === teamName.toLowerCase();
  });
}

function pitchGroup(pt) {
  const n = normalizePitchType(pt);
  if (['Fastball', 'Two Seam', 'Cutter'].includes(n)) return 'Fastball';
  if (['Slider', 'Curveball', 'Breaking Ball'].includes(n)) return 'Breaking';
  if (['Changeup', 'Splitter'].includes(n)) return 'Offspeed';
  return 'Other';
}

function computeDatasetAverages() {
  // Called at end of reprocessData
  let chaseSwings = 0, chasePitches = 0;
  let fpSwings = 0, fpTotal = 0;
  let tsKs = 0, tsPAs = 0;
  let sacCount = 0, totalPAs = 0;
  let zonePitches = 0, zoneTotal = 0;
  const seenPA = new Set();

  filteredData.forEach(row => {
    const result = (row.PitchResult || '').trim();
    const abResult = (row.AtBatResult || '').trim();
    const zone = (row.AttackZone || '').trim();
    const b = parseInt(row.Balls) || 0, s = parseInt(row.Strikes) || 0;
    const isSwing = result.includes('Swing') || result.includes('Foul') || result.includes('In Play');

    // Chase
    if (zone === 'Chase' || zone === 'Waste') {
      chasePitches++;
      if (isSwing) chaseSwings++;
    }
    // First pitch
    if (b === 0 && s === 0) {
      fpTotal++;
      if (isSwing) fpSwings++;
    }
    // Zone rate
    if (zone === 'Heart' || zone === 'Shadow') zonePitches++;
    if (zone === 'Heart' || zone === 'Shadow' || zone === 'Chase' || zone === 'Waste') zoneTotal++;

    // PA-level
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Batter}-${row.Pitcher}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey);
      totalPAs++;
      if (s === 2 && abResult === 'Strike Out') tsKs++;
      if (s === 2) tsPAs++;
      if (abResult === 'Sacrifice') sacCount++;
    }
  });

  stats.datasetAverages = {
    chaseRate: chasePitches > 0 ? (chaseSwings / chasePitches * 100) : 0,
    firstPitchSwingRate: fpTotal > 0 ? (fpSwings / fpTotal * 100) : 0,
    twoStrikeKRate: tsPAs > 0 ? (tsKs / tsPAs * 100) : 0,
    sacRate: totalPAs > 0 ? (sacCount / totalPAs * 100) : 0,
    zoneRate: zoneTotal > 0 ? (zonePitches / zoneTotal * 100) : 0,
  };
}

// ===== 8 TENDENCY COMPUTE FUNCTIONS =====
function computeBuntTendency(teamName) {
  const pitches = getTeamOffensePitches(teamName);
  if (!pitches.length) return null;
  const seenPA = new Set();
  let sacCount = 0, totalPA = 0;
  const byBatter = {}, byInning = {}, byOuts = { 0: 0, 1: 0, 2: 0 };
  let sacTotal = 0;

  pitches.forEach(row => {
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const inning = parseInt(row.Inning) || 0;
    const outs = parseInt(row.Outs) || 0;
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${batter}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey);
      totalPA++;
      if (abResult === 'Sacrifice') {
        sacCount++;
        sacTotal++;
        if (!byBatter[batter]) byBatter[batter] = 0;
        byBatter[batter]++;
        const ig = inning <= 3 ? 'Early (1-3)' : inning <= 6 ? 'Mid (4-6)' : 'Late (7+)';
        byInning[ig] = (byInning[ig] || 0) + 1;
        if (byOuts.hasOwnProperty(outs)) byOuts[outs]++;
      }
    }
  });

  const sacRate = totalPA > 0 ? (sacCount / totalPA * 100) : 0;
  const batterList = Object.entries(byBatter).sort((a, b) => b[1] - a[1]);
  const dsAvg = stats.datasetAverages?.sacRate || 0;

  return { teamName, sacRate, sacCount, totalPA, byBatter: batterList, byInning, byOuts, dsAvg, totalPitches: pitches.length };
}

function computeFirstPitchApproach(teamName) {
  const pitches = getTeamOffensePitches(teamName);
  if (!pitches.length) return null;
  let fpTotal = 0, fpSwings = 0, fpInPlay = 0, fpHits = 0, fpAB = 0;
  const byBatter = {};

  pitches.forEach(row => {
    const b = parseInt(row.Balls) || 0, s = parseInt(row.Strikes) || 0;
    if (b !== 0 || s !== 0) return;
    fpTotal++;
    const result = (row.PitchResult || '').trim();
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const isSwing = result.includes('Swing') || result.includes('Foul') || result.includes('In Play');
    if (isSwing) fpSwings++;
    if (result.includes('In Play')) {
      fpInPlay++;
      const isHit = ['1B', '2B', '3B', 'HR'].includes(abResult);
      const isAB = !['BB', 'HBP', 'IBB', 'Sacrifice', 'Catchers Interference'].includes(abResult);
      if (isAB) fpAB++;
      if (isHit) fpHits++;
    }
    if (!byBatter[batter]) byBatter[batter] = { total: 0, swings: 0 };
    byBatter[batter].total++;
    if (isSwing) byBatter[batter].swings++;
  });

  const swingRate = fpTotal > 0 ? (fpSwings / fpTotal * 100) : 0;
  const hitRate = fpAB > 0 ? (fpHits / fpAB * 100) : 0;
  const inPlayRate = fpTotal > 0 ? (fpInPlay / fpTotal * 100) : 0;
  const batterList = Object.entries(byBatter)
    .map(([name, d]) => ({ name, total: d.total, swings: d.swings, rate: d.total > 0 ? (d.swings / d.total * 100) : 0 }))
    .filter(b => b.total >= 3)
    .sort((a, b) => b.rate - a.rate);
  const dsAvg = stats.datasetAverages?.firstPitchSwingRate || 0;

  return { teamName, swingRate, hitRate, inPlayRate, fpTotal, fpSwings, fpInPlay, fpHits, fpAB, byBatter: batterList, dsAvg };
}

function computeChaseAndDiscipline(teamName) {
  const pitches = getTeamOffensePitches(teamName);
  if (!pitches.length) return null;
  let chasePitches = 0, chaseSwings = 0;
  const byBatter = {}, byCount = {};

  pitches.forEach(row => {
    const zone = (row.AttackZone || '').trim();
    if (zone !== 'Chase' && zone !== 'Waste') return;
    chasePitches++;
    const result = (row.PitchResult || '').trim();
    const batter = (row.Batter || '').trim();
    const b = parseInt(row.Balls) || 0, s = parseInt(row.Strikes) || 0;
    const countKey = `${b}-${s}`;
    const isSwing = result.includes('Swing') || result.includes('Foul') || result.includes('In Play');
    if (isSwing) chaseSwings++;
    if (!byBatter[batter]) byBatter[batter] = { total: 0, swings: 0 };
    byBatter[batter].total++;
    if (isSwing) byBatter[batter].swings++;
    if (!byCount[countKey]) byCount[countKey] = { total: 0, swings: 0 };
    byCount[countKey].total++;
    if (isSwing) byCount[countKey].swings++;
  });

  const chaseRate = chasePitches > 0 ? (chaseSwings / chasePitches * 100) : 0;
  const batterList = Object.entries(byBatter)
    .map(([name, d]) => ({ name, total: d.total, swings: d.swings, rate: d.total > 0 ? (d.swings / d.total * 100) : 0 }))
    .filter(b => b.total >= 3)
    .sort((a, b) => b.rate - a.rate);
  const countList = Object.entries(byCount)
    .map(([count, d]) => ({ count, total: d.total, swings: d.swings, rate: d.total > 0 ? (d.swings / d.total * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate);
  const dsAvg = stats.datasetAverages?.chaseRate || 0;

  return { teamName, chaseRate, chasePitches, chaseSwings, byBatter: batterList, byCount: countList, dsAvg };
}

function computeTwoStrikeApproach(teamName) {
  const pitches = getTeamOffensePitches(teamName);
  if (!pitches.length) return null;
  let tsTotal = 0, tsSwings = 0, tsWhiffs = 0, tsFouls = 0;
  const byBatter = {};
  const seenPA = new Set();
  let tsPA = 0, tsKs = 0;

  pitches.forEach(row => {
    const s = parseInt(row.Strikes) || 0;
    if (s !== 2) return;
    tsTotal++;
    const result = (row.PitchResult || '').trim();
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const isSwing = result.includes('Swing') || result.includes('Foul') || result.includes('In Play');
    if (isSwing) tsSwings++;
    if (result.includes('Swing and Miss')) tsWhiffs++;
    if (result.includes('Foul')) tsFouls++;

    if (!byBatter[batter]) byBatter[batter] = { pitches: 0, ks: 0, pa: 0 };
    byBatter[batter].pitches++;

    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${batter}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey);
      tsPA++;
      byBatter[batter].pa++;
      if (abResult === 'Strike Out') {
        tsKs++;
        byBatter[batter].ks++;
      }
    }
  });

  const kRate = tsPA > 0 ? (tsKs / tsPA * 100) : 0;
  const whiffRate = tsSwings > 0 ? (tsWhiffs / tsSwings * 100) : 0;
  const foulRate = tsTotal > 0 ? (tsFouls / tsTotal * 100) : 0;
  const chaseZone = pitches.filter(r => {
    const s = parseInt(r.Strikes) || 0;
    if (s !== 2) return false;
    const z = (r.AttackZone || '').trim();
    return z === 'Chase' || z === 'Waste';
  });
  let tsChaseSwings = 0;
  chaseZone.forEach(r => {
    const res = (r.PitchResult || '').trim();
    if (res.includes('Swing') || res.includes('Foul') || res.includes('In Play')) tsChaseSwings++;
  });
  const tsChaseRate = chaseZone.length > 0 ? (tsChaseSwings / chaseZone.length * 100) : 0;

  const batterList = Object.entries(byBatter)
    .map(([name, d]) => ({ name, pitches: d.pitches, pa: d.pa, ks: d.ks, kRate: d.pa > 0 ? (d.ks / d.pa * 100) : 0 }))
    .filter(b => b.pa >= 2)
    .sort((a, b) => b.kRate - a.kRate);
  const dsAvg = stats.datasetAverages?.twoStrikeKRate || 0;

  return { teamName, kRate, whiffRate, foulRate, tsChaseRate, tsTotal, tsPA, tsKs, byBatter: batterList, dsAvg };
}

function computePitchMixTendency(teamName) {
  const pitches = getTeamPitchingPitches(teamName);
  if (!pitches.length) return null;
  const overallMix = {};
  const byCount = { first_pitch: {}, ahead: {}, behind: {}, even: {}, two_strikes: {} };
  const byBatterHand = { R: {}, L: {} };
  let total = 0;

  pitches.forEach(row => {
    const pt = normalizePitchType(row.PitchType);
    const b = parseInt(row.Balls) || 0, s = parseInt(row.Strikes) || 0;
    const bHand = (row['Batter Hand'] || '').trim().toUpperCase();
    total++;
    overallMix[pt] = (overallMix[pt] || 0) + 1;

    const labels = [];
    if (b === 0 && s === 0) labels.push('first_pitch');
    if (s === 2) labels.push('two_strikes');
    if (s > b) labels.push('ahead');
    else if (b > s) labels.push('behind');
    else labels.push('even');
    labels.forEach(l => { if (byCount[l]) byCount[l][pt] = (byCount[l][pt] || 0) + 1; });

    if (bHand === 'R' || bHand === 'L') {
      byBatterHand[bHand][pt] = (byBatterHand[bHand][pt] || 0) + 1;
    }
  });

  // Put-away pitch: most used pitch type with 2 strikes
  const tsMix = byCount.two_strikes;
  const tsTotal = Object.values(tsMix).reduce((a, b) => a + b, 0);
  const putAwayPitch = Object.keys(tsMix).sort((a, b) => tsMix[b] - tsMix[a])[0] || null;

  // Group by FB/BRK/OS
  let fbCount = 0, brkCount = 0, osCount = 0;
  Object.entries(overallMix).forEach(([pt, cnt]) => {
    const g = pitchGroup(pt);
    if (g === 'Fastball') fbCount += cnt;
    else if (g === 'Breaking') brkCount += cnt;
    else if (g === 'Offspeed') osCount += cnt;
  });

  const mixList = Object.entries(overallMix).sort((a, b) => b[1] - a[1])
    .map(([pt, cnt]) => ({ pitch: pt, count: cnt, pct: (cnt / total * 100) }));

  return {
    teamName, total, overallMix: mixList, byCount, byBatterHand, putAwayPitch,
    fbPct: total > 0 ? (fbCount / total * 100) : 0,
    brkPct: total > 0 ? (brkCount / total * 100) : 0,
    osPct: total > 0 ? (osCount / total * 100) : 0,
  };
}

function computeZoneUsageTendency(teamName) {
  const pitches = getTeamPitchingPitches(teamName);
  if (!pitches.length) return null;
  const zones = { Heart: 0, Shadow: 0, Chase: 0, Waste: 0 };
  const byCount = {};
  const countKeys = ['first_pitch', 'ahead', 'behind', 'even', 'two_strikes'];
  countKeys.forEach(k => byCount[k] = { Heart: 0, Shadow: 0, Chase: 0, Waste: 0 });
  let total = 0;

  pitches.forEach(row => {
    const zone = (row.AttackZone || '').trim();
    if (!zones.hasOwnProperty(zone)) return;
    zones[zone]++;
    total++;
    const b = parseInt(row.Balls) || 0, s = parseInt(row.Strikes) || 0;
    const labels = [];
    if (b === 0 && s === 0) labels.push('first_pitch');
    if (s === 2) labels.push('two_strikes');
    if (s > b) labels.push('ahead');
    else if (b > s) labels.push('behind');
    else labels.push('even');
    labels.forEach(l => { if (byCount[l]) byCount[l][zone]++; });
  });

  const zoneRate = total > 0 ? ((zones.Heart + zones.Shadow) / total * 100) : 0;
  const heartPct = total > 0 ? (zones.Heart / total * 100) : 0;
  const shadowPct = total > 0 ? (zones.Shadow / total * 100) : 0;
  const chasePct = total > 0 ? (zones.Chase / total * 100) : 0;
  const dsAvg = stats.datasetAverages?.zoneRate || 0;

  return { teamName, zones, total, zoneRate, heartPct, shadowPct, chasePct, byCount, dsAvg };
}

function computeSituationalTendency(teamName) {
  const offPitches = getTeamOffensePitches(teamName);
  if (!offPitches.length) return null;
  const seenPA = new Set();
  const inningGroups = { 'Early (1-3)': { pa: 0, hits: 0, abs: 0 }, 'Mid (4-6)': { pa: 0, hits: 0, abs: 0 }, 'Late (7+)': { pa: 0, hits: 0, abs: 0 } };
  let twoOutPA = 0, twoOutHits = 0, twoOutAB = 0;
  const scoringByInning = {};

  offPitches.forEach(row => {
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const inning = parseInt(row.Inning) || 0;
    const outs = parseInt(row.Outs) || 0;
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${batter}-${row.PAofInning}`;
    if (!abResult || seenPA.has(paKey)) return;
    seenPA.add(paKey);

    const isHit = ['1B', '2B', '3B', 'HR'].includes(abResult);
    const isAB = !['BB', 'HBP', 'IBB', 'Sacrifice', 'Catchers Interference'].includes(abResult);
    const ig = inning <= 3 ? 'Early (1-3)' : inning <= 6 ? 'Mid (4-6)' : 'Late (7+)';
    if (inningGroups[ig]) {
      inningGroups[ig].pa++;
      if (isAB) inningGroups[ig].abs++;
      if (isHit) inningGroups[ig].hits++;
    }
    if (outs === 2) {
      twoOutPA++;
      if (isAB) twoOutAB++;
      if (isHit) twoOutHits++;
    }
    // Scoring by inning = hits + walks (simplification)
    if (isHit || ['BB', 'HBP'].includes(abResult)) {
      const iKey = `Inning ${inning}`;
      scoringByInning[iKey] = (scoringByInning[iKey] || 0) + 1;
    }
  });

  const earlyAVG = inningGroups['Early (1-3)'].abs > 0 ? (inningGroups['Early (1-3)'].hits / inningGroups['Early (1-3)'].abs) : 0;
  const midAVG = inningGroups['Mid (4-6)'].abs > 0 ? (inningGroups['Mid (4-6)'].hits / inningGroups['Mid (4-6)'].abs) : 0;
  const lateAVG = inningGroups['Late (7+)'].abs > 0 ? (inningGroups['Late (7+)'].hits / inningGroups['Late (7+)'].abs) : 0;
  const twoOutAVG = twoOutAB > 0 ? (twoOutHits / twoOutAB) : 0;

  return { teamName, inningGroups, earlyAVG, midAVG, lateAVG, twoOutAVG, twoOutPA, twoOutHits, twoOutAB, scoringByInning };
}

function computePlatoonTendency(teamName) {
  const offPitches = getTeamOffensePitches(teamName);
  const defPitches = getTeamPitchingPitches(teamName);
  const seenOff = new Set(), seenDef = new Set();
  const offVsR = { abs: 0, hits: 0, ks: 0 }, offVsL = { abs: 0, hits: 0, ks: 0 };
  const defVsR = { abs: 0, hits: 0, ks: 0 }, defVsL = { abs: 0, hits: 0, ks: 0 };
  const offBatterSplits = {};

  offPitches.forEach(row => {
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const pH = (row.PitcherHand || '').trim().toUpperCase();
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${batter}-${row.PAofInning}`;
    if (!abResult || seenOff.has(paKey)) return;
    seenOff.add(paKey);
    const isHit = ['1B', '2B', '3B', 'HR'].includes(abResult);
    const isAB = !['BB', 'HBP', 'IBB', 'Sacrifice', 'Catchers Interference'].includes(abResult);
    const sp = pH === 'R' ? offVsR : offVsL;
    if (isAB) sp.abs++;
    if (isHit) sp.hits++;
    if (abResult === 'Strike Out') sp.ks++;

    if (!offBatterSplits[batter]) offBatterSplits[batter] = { vsR: { abs: 0, hits: 0 }, vsL: { abs: 0, hits: 0 } };
    const bs = pH === 'R' ? offBatterSplits[batter].vsR : offBatterSplits[batter].vsL;
    if (isAB) bs.abs++;
    if (isHit) bs.hits++;
  });

  defPitches.forEach(row => {
    const abResult = (row.AtBatResult || '').trim();
    const batter = (row.Batter || '').trim();
    const bH = (row['Batter Hand'] || '').trim().toUpperCase();
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${batter}-${row.PAofInning}`;
    if (!abResult || seenDef.has(paKey)) return;
    seenDef.add(paKey);
    const isHit = ['1B', '2B', '3B', 'HR'].includes(abResult);
    const isAB = !['BB', 'HBP', 'IBB', 'Sacrifice', 'Catchers Interference'].includes(abResult);
    const sp = bH === 'R' ? defVsR : defVsL;
    if (isAB) sp.abs++;
    if (isHit) sp.hits++;
    if (abResult === 'Strike Out') sp.ks++;
  });

  const fmtSplit = s => ({
    avg: s.abs > 0 ? (s.hits / s.abs).toFixed(3) : 'N/A',
    kRate: s.abs > 0 ? (s.ks / s.abs * 100).toFixed(1) + '%' : 'N/A',
    abs: s.abs, hits: s.hits
  });

  // Biggest split for batters
  const batterSplitList = Object.entries(offBatterSplits)
    .map(([name, d]) => {
      const rAvg = d.vsR.abs > 0 ? d.vsR.hits / d.vsR.abs : 0;
      const lAvg = d.vsL.abs > 0 ? d.vsL.hits / d.vsL.abs : 0;
      return { name, vsR: d.vsR, vsL: d.vsL, rAvg, lAvg, split: Math.abs(rAvg - lAvg) };
    })
    .filter(b => b.vsR.abs >= 3 || b.vsL.abs >= 3)
    .sort((a, b) => b.split - a.split);

  return {
    teamName,
    offenseVsRHP: fmtSplit(offVsR), offenseVsLHP: fmtSplit(offVsL),
    pitchingVsRHH: fmtSplit(defVsR), pitchingVsLHH: fmtSplit(defVsL),
    batterSplits: batterSplitList,
    hasOffense: offPitches.length > 0, hasPitching: defPitches.length > 0
  };
}

function computeTendencyData(category, teamName) {
  switch (category) {
    case 'bunt_sacrifice': return computeBuntTendency(teamName);
    case 'first_pitch_off': return computeFirstPitchApproach(teamName);
    case 'chase_discipline': return computeChaseAndDiscipline(teamName);
    case 'two_strike_off': return computeTwoStrikeApproach(teamName);
    case 'pitch_mix_seq': return computePitchMixTendency(teamName);
    case 'zone_usage': return computeZoneUsageTendency(teamName);
    case 'situational': return computeSituationalTendency(teamName);
    case 'platoon': return computePlatoonTendency(teamName);
    default: return null;
  }
}

// ===== QUESTION ROUTING =====
function findBestMatch(query, candidates, excludeWords) {
  let best=null, bestScore=0;
  const excl = (excludeWords||[]).map(w=>w.toLowerCase());
  // Normalize: "St.Xavier" -> "st. xavier", collapse spaces
  const normQ = query.replace(/\bst\./gi, 'st. ').replace(/\s+/g, ' ');
  for (const name of candidates) {
    const lower=name.toLowerCase();
    const normName = lower.replace(/\bst\./gi, 'st. ').replace(/\s+/g, ' ');
    // Full name match — strongest (score=4)
    if ((normQ.includes(normName)||normQ.includes(lower))&&4>bestScore) { best=name; bestScore=4; }
    // Candidate contained in query after stripping common suffixes like "High School" (score=3)
    if (bestScore<3) {
      const stripped = normName.replace(/\s*(high school|hs|h\.s\.)$/i, '').trim();
      if (stripped.length>3 && normQ.includes(stripped)) { best=name; bestScore=3; }
    }
    // Significant word matching (score=2-2.5)
    if (bestScore<2) {
      const significantWords = normName.split(/\s+/).filter(w => w.length > 3 && !['high','school'].includes(w));
      const matchCount = significantWords.filter(w => {
        const wRegex = new RegExp('\\b'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b');
        return wRegex.test(normQ);
      }).length;
      if (matchCount > 0 && significantWords.length > 0) {
        const s = 2 + (matchCount / significantWords.length) * 0.5;
        if (s > bestScore) { best=name; bestScore=s; }
      }
    }
    const parts=name.split(/\s+/);
    // Last name match — word boundary (score=1.5)
    if (parts.length>1&&bestScore<1.5) {
      const ln=parts[parts.length-1].toLowerCase();
      if (ln.length>2 && !['school','high'].includes(ln)) {
        const lnRegex = new RegExp('\\b'+ln.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b');
        if (lnRegex.test(normQ)) { best=name; bestScore=1.5; }
      }
    }
    // First name match — weakest, word boundary required (score=1)
    if (parts.length>0&&bestScore<1) {
      const fn=parts[0].toLowerCase();
      if (fn.length>3&&!excl.includes(fn)) {
        const fnRegex = new RegExp('\\b'+fn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b');
        if (fnRegex.test(normQ)) { best=name; bestScore=1; }
      }
    }
  }
  return { name: best, score: bestScore };
}

// Wrapper for backward compat — returns just the name
function findBestMatchName(query, candidates, excludeWords) {
  return findBestMatch(query, candidates, excludeWords).name;
}

function getTeamPitcherProfiles(teamName) {
  const p={};
  Object.keys(stats.opponentPitchers).forEach(n => {
    if (stats.opponentPitchers[n].team.toLowerCase()===teamName.toLowerCase())
      p[n]=computePitcherProfile(stats.opponentPitchers[n].pitches,n,stats.opponentPitchers[n].hand,stats.opponentPitchers[n].team);
  });
  return p;
}
function getAllMoellerHitterProfiles() {
  const p={}; Object.keys(stats.moellerHitters).forEach(n => { p[n]=computeHitterProfile(stats.moellerHitters[n].pitches,n,stats.moellerHitters[n].hand); }); return p;
}
function getTeamBatterProfiles(teamName) {
  const p={};
  Object.keys(stats.opponentBatters).forEach(n => {
    if (stats.opponentBatters[n].team.toLowerCase()===teamName.toLowerCase())
      p[n]=computeHitterProfile(stats.opponentBatters[n].pitches,n,stats.opponentBatters[n].hand);
  });
  return p;
}
function getAllMoellerPitcherProfiles() {
  const p={}; Object.keys(stats.moellerPitchers).forEach(n => { p[n]=computePitcherProfile(stats.moellerPitchers[n].pitches,n,stats.moellerPitchers[n].hand,'Moeller'); }); return p;
}

// Common team abbreviations/nicknames -> full names in the dataset
const TEAM_ALIASES = {
  'st.x': 'st. xavier', 'st x': 'st. xavier', 'stx': 'st. xavier', 'saint x': 'st. xavier', 'saint xavier': 'st. xavier',
  'elder': 'elder', 'la salle': 'la salle', 'lasalle': 'la salle',
  'colerain': 'colerain', 'mason': 'mason', 'lakota west': 'lakota west',
  'lakota east': 'lakota east', 'fairfield': 'fairfield', 'princeton': 'princeton',
  'sycamore': 'sycamore', 'milford': 'milford', 'anderson': 'anderson',
};

function expandTeamAliases(query) {
  let q = query;
  for (const [alias, full] of Object.entries(TEAM_ALIASES)) {
    const regex = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    if (regex.test(q)) { q = q.replace(regex, full); }
  }
  return q;
}

function routeQuestion(question) {
  const q=expandTeamAliases(question.toLowerCase());
  const ctx={type:'',data:{}};
  // Collect all player first names so team matching ignores them (e.g. "Conner" Cuozzo vs "Conner" High)
  const allPlayerFirstNames = [
    ...Object.keys(stats.opponentPitchers), ...Object.keys(stats.opponentBatters),
    ...stats.moellerPitcherList, ...stats.moellerHitterList
  ].map(n => n.split(/\s+/)[0].toLowerCase()).filter(n => n.length > 3);
  // Collect all team name words so player first-name matching ignores them
  const allTeamWords = stats.teamList.flatMap(t => t.toLowerCase().split(/\s+/)).filter(w => w.length > 3);
  const oppPMatch=findBestMatch(q,Object.keys(stats.opponentPitchers), allTeamWords);
  const oppBMatch=findBestMatch(q,Object.keys(stats.opponentBatters), allTeamWords);
  const moePMatch=findBestMatch(q,stats.moellerPitcherList, allTeamWords);
  const moeHMatch=findBestMatch(q,stats.moellerHitterList, allTeamWords);
  const teamMatch=findBestMatch(q,stats.teamList, allPlayerFirstNames);

  // When a Moeller player has an equal or better match score than ANY opponent match, prefer Moeller
  // This handles cross-role cases (e.g. Moeller hitter "Adam Maybury" vs opponent pitcher "Adam Zinser")
  const bestMoeScore = Math.max(moePMatch.score, moeHMatch.score);
  const bestOppScore = Math.max(oppPMatch.score, oppBMatch.score);

  let oppP, oppB, moeP, moeH;
  if (bestMoeScore >= bestOppScore && bestMoeScore > 0) {
    // Moeller match wins — suppress all opponent matches
    oppP = null;
    oppB = null;
    moeP = moePMatch.score >= moeHMatch.score ? moePMatch.name : null;
    moeH = moeHMatch.score >= moePMatch.score ? moeHMatch.name : null;
  } else if (bestOppScore > 0) {
    // Opponent match wins — suppress Moeller matches only if weaker
    oppP = oppPMatch.score >= oppBMatch.score ? oppPMatch.name : null;
    oppB = oppBMatch.score > oppPMatch.score ? oppBMatch.name : null;
    moeP = (moePMatch.score > oppPMatch.score) ? moePMatch.name : null;
    moeH = (moeHMatch.score > oppBMatch.score) ? moeHMatch.name : null;
  } else {
    oppP = oppPMatch.name;
    oppB = oppBMatch.name;
    moeP = moePMatch.name;
    moeH = moeHMatch.name;
  }
  const team=teamMatch.name;

  // "pitching coach" + team = they want to pitch AGAINST that team's hitters
  if ((q.includes('pitching coach')||q.includes('pitch against')||q.includes('how to pitch'))&&team) {
    ctx.type='opponent_batters'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentBatters=getTeamBatterProfiles(team); ctx.data.moellerPitchers=getAllMoellerPitcherProfiles(); return ctx;
  }
  if ((q.includes('game plan')||q.includes('scouting report')||q.includes('prepare for')||q.includes('prep for')||q.includes('facing')||q.includes('playing'))&&team) {
    ctx.type='game_plan'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentPitchers=getTeamPitcherProfiles(team); ctx.data.opponentBatters=getTeamBatterProfiles(team); ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  if ((q.includes('batter')||q.includes('hitter')||q.includes('lineup')||q.includes('hitting')||q.includes('consistenc'))&&team) {
    ctx.type='opponent_batters'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentBatters=getTeamBatterProfiles(team); return ctx;
  }
  if (team&&!oppP&&!oppB&&!moeP&&!moeH) {
    ctx.type='opponent_team'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentPitchers=getTeamPitcherProfiles(team); ctx.data.opponentBatters=getTeamBatterProfiles(team); ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  if (oppP) {
    ctx.type='opponent_pitcher'; const p=stats.opponentPitchers[oppP];
    ctx.data.pitcher=computePitcherProfile(p.pitches,oppP,p.hand,p.team); ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  if (oppB) {
    ctx.type='opponent_batter'; const b=stats.opponentBatters[oppB];
    ctx.data.batter=computeHitterProfile(b.pitches,oppB,b.hand);
    ctx.data.batter.team=b.team;
    ctx.data.moellerPitchers=getAllMoellerPitcherProfiles(); return ctx;
  }
  if (moeP) {
    ctx.type='moeller_pitcher'; const p=stats.moellerPitchers[moeP];
    ctx.data.pitcher=computePitcherProfile(p.pitches,moeP,p.hand,'Moeller'); return ctx;
  }
  if (moeH) {
    ctx.type='moeller_hitter';
    ctx.data.hitter=computeHitterProfile(stats.moellerHitters[moeH].pitches,moeH,stats.moellerHitters[moeH].hand); return ctx;
  }
  if (q.includes('our pitch')||q.includes('moeller pitch')||q.includes('our staff')||q.includes('our arm')) {
    ctx.type='moeller_pitching_staff'; ctx.data.moellerPitchers=getAllMoellerPitcherProfiles(); return ctx;
  }
  if (q.includes('our hitter')||q.includes('our batter')||q.includes('our lineup')||q.includes('our team')||
      q.includes('moeller hitter')||q.includes('chase rate')||q.includes('weakness')||q.includes('our lefties')||
      q.includes('our righties')||q.includes('our guys')||q.includes('breaking ball')) {
    ctx.type='moeller_hitters'; ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  if (team) {
    ctx.type='opponent_team'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentPitchers=getTeamPitcherProfiles(team); ctx.data.opponentBatters=getTeamBatterProfiles(team); ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  ctx.type='general'; ctx.data.availableTeams=stats.teamList; ctx.data.moellerHitters=stats.moellerHitterList;
  ctx.data.moellerPitchers=stats.moellerPitcherList;
  ctx.data.teamSummaries={}; stats.teamList.forEach(t=>{ctx.data.teamSummaries[t]=computeTeamSummary(t);});
  ctx.data.moellerHitterProfiles=getAllMoellerHitterProfiles();
  return ctx;
}

// ===== MODE UI =====
function updateModeUI() {
  const title = document.getElementById('welcome-title');
  const subtitle = document.getElementById('welcome-subtitle');
  if (appMode === 'dugout') {
    document.body.classList.add('dugout-mode');
    if (title) title.textContent = 'Dugout Mode';
    if (subtitle) subtitle.textContent = 'Quick scout cards for in-game use. Type a pitcher or team name.';
    userInput.placeholder = 'Pitcher name, team name, or quick question...';
  } else {
    document.body.classList.remove('dugout-mode');
    if (title) title.textContent = 'Ready to Scout';
    if (subtitle) subtitle.textContent = 'Ask a question about opponents, hitters, pitchers, or game strategy.';
    userInput.placeholder = 'Ask about an opponent, a hitter, a pitcher, or game strategy...';
  }
}

// ===== GUIDED MENU FLOW =====
let selectedReportType = null;
let matchupState = { pitcher: null, hitter: null, step: 0 };
let tendencyState = { team: null, category: null, step: 0 };
const TENDENCY_CATEGORIES = [
  { key: 'bunt_sacrifice',   title: 'Bunt & Sacrifice',       desc: 'When, who, and how they bunt' },
  { key: 'first_pitch_off',  title: 'First-Pitch Approach',   desc: 'Swing rate on 0-0, by batter, results' },
  { key: 'chase_discipline', title: 'Chase & Discipline',     desc: 'Chase rate by count and batter' },
  { key: 'two_strike_off',   title: 'Two-Strike Approach',    desc: 'K rate, foul rate, whiff rate with 2 strikes' },
  { key: 'pitch_mix_seq',    title: 'Pitch Mix & Sequencing', desc: 'Mix by count, first pitch, put-away' },
  { key: 'zone_usage',       title: 'Zone Usage',             desc: 'AttackZone distribution by count' },
  { key: 'situational',      title: 'Situational / Game-State', desc: 'Early vs late, 2-out, scoring by inning' },
  { key: 'platoon',          title: 'Platoon Tendencies',     desc: 'vs LHP/RHP batting, vs LHH/RHH pitching' },
];

function initMenu() {
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedReportType = card.dataset.type;
      if (selectedReportType === 'direct') {
        // Switch to full analysis mode for free-form questions
        if (appMode !== 'full') {
          document.querySelectorAll('.mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === 'full');
          });
          appMode = 'full';
          updateModeUI();
        }
        showPrompts();
        return;
      }
      if (selectedReportType === 'matchup') {
        matchupState = { pitcher: null, hitter: null, step: 1 };
        showMatchupStep(1);
        return;
      }
      if (selectedReportType === 'tendencies') {
        tendencyState = { team: null, category: null, step: 1 };
        showStep2('tendencies');
        return;
      }
      showStep2(selectedReportType);
    });
  });

  document.getElementById('menu-back').addEventListener('click', () => {
    // Matchup-aware back button
    if (selectedReportType === 'matchup' && matchupState.step === 2) {
      matchupState.hitter = null;
      matchupState.step = 1;
      showMatchupStep(1);
      return;
    }
    document.getElementById('menu-step2').classList.add('hidden');
    if (window._promptPickerActive) {
      window._promptPickerActive = false;
      showPrompts();
    } else {
      document.getElementById('menu-step1').classList.remove('hidden');
      document.getElementById('welcome-title').textContent = 'What do you need?';
      document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
      selectedReportType = null;
      matchupState = { pitcher: null, hitter: null, step: 0 };
      tendencyState = { team: null, category: null, step: 0 };
    }
  });

  // Tendency category back button
  document.getElementById('tendency-cats-back').addEventListener('click', () => {
    document.getElementById('menu-tendency-cats').classList.add('hidden');
    tendencyState.category = null;
    tendencyState.step = 1;
    showStep2('tendencies');
  });

  // Step 3 back button
  document.getElementById('step3-back').addEventListener('click', () => {
    document.getElementById('menu-step3').classList.add('hidden');
    matchupState.hitter = null;
    matchupState.step = 2;
    showMatchupStep(2);
  });

  // Step 3 perspective cards
  document.querySelectorAll('.step3-card').forEach(card => {
    card.addEventListener('click', () => {
      const perspective = card.dataset.perspective;
      executeMatchupReport(perspective);
    });
  });

  document.getElementById('prompts-back').addEventListener('click', () => {
    document.getElementById('menu-step1').classList.remove('hidden');
    document.getElementById('menu-prompts').classList.add('hidden');
    document.getElementById('welcome-title').textContent = 'What do you need?';
    document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
    selectedReportType = null;
  });

  const searchInput = document.getElementById('step2-input');
  searchInput.addEventListener('input', () => {
    filterStep2List(searchInput.value.trim().toLowerCase());
  });
}

function showStep2(type) {
  document.getElementById('menu-step1').classList.add('hidden');
  document.getElementById('menu-step2').classList.remove('hidden');

  const titleEl = document.getElementById('step2-title');
  const inputEl = document.getElementById('step2-input');
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  inputEl.value = '';

  let items = [];
  if (type === 'hitter_report') {
    titleEl.textContent = 'Which hitter?';
    inputEl.placeholder = 'Search hitters...';
    // Show all hitters: Moeller + opponent
    stats.moellerHitterList.forEach(n => items.push({ name: n, meta: 'Moeller', source: 'moeller_hitter' }));
    Object.keys(stats.opponentBatters).forEach(n => items.push({ name: n, meta: stats.opponentBatters[n].team, source: 'opponent_batter' }));
  } else if (type === 'pitcher_report') {
    titleEl.textContent = 'Which pitcher?';
    inputEl.placeholder = 'Search pitchers...';
    stats.moellerPitcherList.forEach(n => items.push({ name: n, meta: 'Moeller', source: 'moeller_pitcher' }));
    Object.keys(stats.opponentPitchers).forEach(n => items.push({ name: n, meta: stats.opponentPitchers[n].team, source: 'opponent_pitcher' }));
  } else if (type === 'team_hitters') {
    titleEl.textContent = 'Which team\'s lineup?';
    inputEl.placeholder = 'Search teams...';
    stats.teamList.forEach(t => items.push({ name: t, meta: '', source: 'team' }));
    items.push({ name: 'Moeller', meta: 'Our team', source: 'moeller_team' });
  } else if (type === 'team_pitchers') {
    titleEl.textContent = 'Which team\'s pitching staff?';
    inputEl.placeholder = 'Search teams...';
    stats.teamList.forEach(t => items.push({ name: t, meta: '', source: 'team' }));
    items.push({ name: 'Moeller', meta: 'Our team', source: 'moeller_team' });
  } else if (type === 'tendencies') {
    titleEl.textContent = "Which team's tendencies?";
    inputEl.placeholder = 'Search teams...';
    document.getElementById('welcome-title').textContent = 'Coaching Tendencies';
    document.getElementById('welcome-subtitle').textContent = 'Step 1: Choose a team';
    stats.teamList.forEach(t => items.push({ name: t, meta: '', source: 'team' }));
    items.push({ name: 'Moeller', meta: 'Our team', source: 'moeller_team' });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  window._menuItems = items;
  renderStep2List(items);
  inputEl.focus();
}

function renderStep2List(items) {
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'step2-item';
    el.innerHTML = `<span class="step2-item-name">${item.name}</span><span class="step2-item-meta">${item.meta}</span>`;
    el.addEventListener('click', () => {
      executeMenuReport(selectedReportType, item);
    });
    listEl.appendChild(el);
  });
}

function filterStep2List(query) {
  if (!window._menuItems) return;
  const filtered = !query ? window._menuItems : window._menuItems.filter(i => i.name.toLowerCase().includes(query));
  if (selectedReportType === 'matchup') {
    renderMatchupList(filtered);
  } else if (window._promptPickerActive && window._promptTemplate) {
    renderPromptTeamList(filtered, window._promptTemplate, window._promptDugoutAction);
  } else {
    renderStep2List(filtered);
  }
}

function showPrompts() {
  document.getElementById('menu-step1').classList.add('hidden');
  document.getElementById('menu-prompts').classList.remove('hidden');
  document.getElementById('welcome-title').textContent = 'Ask a Question';
  document.getElementById('welcome-subtitle').textContent = 'Tap a question or type your own below';

  const grid = document.getElementById('prompts-grid');
  grid.innerHTML = '';

  // pick: 'team' = show team picker first
  // dugout: 'our_hitters' | 'our_pitchers' | 'team_pitchers' | 'team_hitters' = direct dugout card
  const prompts = [
    // Game plan & strategy
    { cat: 'Game Plan', q: `What's the game plan for facing {TEAM}?`, pick: 'team', dugout: 'team_pitchers' },
    { cat: 'Game Plan', q: `How should we prepare for {TEAM}?`, pick: 'team', dugout: 'team_pitchers' },
    { cat: 'Game Plan', q: `What's our best lineup against a lefty starter?`, dugout: 'our_hitters' },

    // Opponent pitching
    { cat: 'Opp Pitching', q: `Who is {TEAM}'s best pitcher and what does he throw?`, pick: 'team', dugout: 'team_pitchers' },
    { cat: 'Opp Pitching', q: `What does {TEAM}'s staff throw first pitch?`, pick: 'team', dugout: 'team_pitchers' },
    { cat: 'Opp Pitching', q: `Which {TEAM} pitcher has the best put-away pitch?`, pick: 'team', dugout: 'team_pitchers' },

    // Our hitters
    { cat: 'Our Hitters', q: `Which of our hitters struggle with breaking balls?`, dugout: 'our_hitters' },
    { cat: 'Our Hitters', q: `Who on our team has the best chase rate?`, dugout: 'our_hitters' },
    { cat: 'Our Hitters', q: `Which of our guys hit lefties the best?`, dugout: 'our_hitters' },
    { cat: 'Our Hitters', q: `Who's our best hitter with 2 strikes?`, dugout: 'our_hitters' },
    { cat: 'Our Hitters', q: `Which Moeller hitters are most aggressive early in counts?`, dugout: 'our_hitters' },

    // Our pitchers
    { cat: 'Our Pitchers', q: `Compare our pitching staff's strikeout rates`, dugout: 'our_pitchers' },
    { cat: 'Our Pitchers', q: `Which of our pitchers has the best first pitch strike rate?`, dugout: 'our_pitchers' },
    { cat: 'Our Pitchers', q: `Who on our staff is best against left-handed hitters?`, dugout: 'our_pitchers' },

    // Matchups & splits
    { cat: 'Matchups', q: `How does our lineup stack up against right-handed pitching?`, dugout: 'our_hitters' },
    { cat: 'Matchups', q: `Who should we pinch hit vs a lefty reliever?`, dugout: 'our_hitters' },
    { cat: 'Matchups', q: `Which of our hitters have the best wOBA?`, dugout: 'our_hitters' },

    // Opponent hitters
    { cat: 'Opp Hitters', q: `What are {TEAM}'s lineup weaknesses?`, pick: 'team', dugout: 'team_hitters' },
    { cat: 'Opp Hitters', q: `Which {TEAM} hitters chase the most?`, pick: 'team', dugout: 'team_hitters' },
    { cat: 'Opp Hitters', q: `How should we pitch to {TEAM}'s lefties?`, pick: 'team', dugout: 'team_hitters' },

    // Tendencies
    { cat: 'Tendencies', q: `What does {TEAM} throw when they're behind in the count?`, pick: 'team', dugout: 'team_pitchers' },
    { cat: 'Tendencies', q: `Which teams throw the most off-speed?`, dugout: 'our_hitters' },
    { cat: 'Tendencies', q: `Who on our team gets behind in counts the most?`, dugout: 'our_hitters' },
  ];

  prompts.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'prompt-btn';
    const displayText = p.q.replace(/\{TEAM\}/g, '___');
    btn.innerHTML = `<span class="prompt-cat">${p.cat}</span><span class="prompt-text">${displayText}</span>`;
    btn.addEventListener('click', () => {
      if (p.pick === 'team') {
        showPromptTeamPicker(p.q, p.dugout);
      } else {
        document.getElementById('menu-prompts').classList.add('hidden');
        if (appMode === 'dugout' && p.dugout) {
          executePromptDugout(p.q, p.dugout);
        } else {
          userInput.value = p.q;
          welcomeEl.classList.add('hidden');
          sendMessage();
        }
      }
    });
    grid.appendChild(btn);
  });

  userInput.focus();
}

function executePromptDugout(question, dugoutAction, teamName) {
  welcomeEl.classList.add('hidden');
  const displayQ = teamName ? question.replace(/\{TEAM\}/g, teamName) : question;
  appendMessage('user', displayQ);
  let card = null;
  if (dugoutAction === 'our_hitters') {
    card = buildTeamHittersQuickLook('Moeller');
  } else if (dugoutAction === 'our_pitchers') {
    const container = document.createElement('div');
    const moePitcherData = {};
    stats.moellerPitcherList.forEach(n => { moePitcherData[n] = stats.moellerPitchers[n]; });
    const summary = buildTeamPitchersSummaryCard('Moeller', moePitcherData);
    if (summary) container.appendChild(summary);
    stats.moellerPitcherList.forEach(n => {
      const p = stats.moellerPitchers[n];
      const c = buildQuickLookCard(computePitcherProfile(p.pitches, n, p.hand, 'Moeller'), p.pitches);
      if (c) container.appendChild(c);
    });
    card = container.children.length > 0 ? container : null;
  } else if (dugoutAction === 'team_pitchers' && teamName) {
    card = buildTeamQuickLook(teamName);
  } else if (dugoutAction === 'team_hitters' && teamName) {
    card = buildTeamHittersQuickLook(teamName);
  }
  if (card) {
    appendQuickLook(card);
  } else {
    appendMessage('assistant', 'No data available for this query. Try searching for a specific player or team.');
  }
}

function showPromptTeamPicker(template, dugoutAction) {
  document.getElementById('menu-prompts').classList.add('hidden');
  document.getElementById('menu-step2').classList.remove('hidden');
  window._promptPickerActive = true;
  window._promptTemplate = template;
  window._promptDugoutAction = dugoutAction || null;

  const titleEl = document.getElementById('step2-title');
  const inputEl = document.getElementById('step2-input');
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  inputEl.value = '';

  titleEl.textContent = 'Which team?';
  inputEl.placeholder = 'Search teams...';

  const items = [];
  stats.teamList.forEach(t => items.push({ name: t, meta: '', source: 'team' }));
  items.sort((a, b) => a.name.localeCompare(b.name));
  window._menuItems = items;

  renderPromptTeamList(items, template, dugoutAction);
  inputEl.focus();
}

function renderPromptTeamList(items, template, dugoutAction) {
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'step2-item';
    el.innerHTML = `<span class="step2-item-name">${item.name}</span><span class="step2-item-meta">${item.meta}</span>`;
    el.addEventListener('click', () => {
      window._promptPickerActive = false;
      document.getElementById('menu-step2').classList.add('hidden');
      if (appMode === 'dugout' && dugoutAction) {
        executePromptDugout(template, dugoutAction, item.name);
      } else {
        const finalQ = template.replace(/\{TEAM\}/g, item.name);
        userInput.value = finalQ;
        welcomeEl.classList.add('hidden');
        sendMessage();
      }
    });
    listEl.appendChild(el);
  });
}

function executeMenuReport(type, item) {
  // Tendencies branch — route to category picker instead of generating report
  if (type === 'tendencies') {
    tendencyState.team = item.name;
    tendencyState.step = 2;
    showTendencyCategoryPicker();
    return;
  }

  welcomeEl.classList.add('hidden');

  // In dugout mode, try to build Quick Look cards directly (zero tokens)
  if (appMode === 'dugout') {
    let card = null;
    if (type === 'hitter_report') {
      const src = stats.moellerHitters[item.name] || stats.opponentBatters[item.name];
      if (src) card = buildHitterQuickLookCard(computeHitterProfile(src.pitches, item.name, src.hand), src.pitches);
    } else if (type === 'pitcher_report') {
      const src = stats.moellerPitchers[item.name] || stats.opponentPitchers[item.name];
      if (src) {
        const team = stats.opponentPitchers[item.name]?.team || 'Moeller';
        card = buildQuickLookCard(computePitcherProfile(src.pitches, item.name, src.hand, team), src.pitches);
      }
    } else if (type === 'team_hitters') {
      card = buildTeamHittersQuickLook(item.name);
    } else if (type === 'team_pitchers') {
      if (/moeller/i.test(item.name)) {
        const container = document.createElement('div');
        const moePitcherData = {};
        stats.moellerPitcherList.forEach(n => { moePitcherData[n] = stats.moellerPitchers[n]; });
        const summary = buildTeamPitchersSummaryCard('Moeller', moePitcherData);
        if (summary) container.appendChild(summary);
        stats.moellerPitcherList.forEach(n => {
          const p = stats.moellerPitchers[n];
          const c = buildQuickLookCard(computePitcherProfile(p.pitches, n, p.hand, 'Moeller'), p.pitches);
          if (c) container.appendChild(c);
        });
        card = container.children.length > 0 ? container : null;
      } else {
        card = buildTeamQuickLook(item.name);
      }
    }
    if (card) {
      appendMessage('user', `${type.replace('_',' ')} — ${item.name}`);
      appendQuickLook(card, type === 'hitter_report' ? item.name : null, type === 'pitcher_report' ? item.name : null);
      return;
    }
  }

  // Full mode or no card available — use API
  // Reset session to avoid context overflow from previous queries
  sessionId = 'session_' + Date.now();
  let query = '';
  if (type === 'hitter_report') query = `Give me a full scouting report on ${item.name} as a hitter`;
  else if (type === 'pitcher_report') query = `Give me a full scouting report on ${item.name} as a pitcher`;
  else if (type === 'team_hitters') query = item.name === 'Moeller' ? 'Give me a scouting report on all Moeller hitters in the lineup' : `Give me a scouting report on ${item.name}'s hitters and lineup`;
  else if (type === 'team_pitchers') query = item.name === 'Moeller' ? 'Give me a scouting report on our Moeller pitching staff' : `Give me a scouting report on ${item.name}'s pitching staff`;
  userInput.value = query;
  sendMessage();
}

// ===== MATCHUP FLOW =====
function showMatchupStep(step) {
  document.getElementById('menu-step1').classList.add('hidden');
  document.getElementById('menu-step3').classList.add('hidden');
  document.getElementById('menu-step2').classList.remove('hidden');

  const titleEl = document.getElementById('step2-title');
  const inputEl = document.getElementById('step2-input');
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  inputEl.value = '';

  let items = [];
  if (step === 1) {
    titleEl.textContent = 'Select a Pitcher';
    inputEl.placeholder = 'Search pitchers...';
    document.getElementById('welcome-title').textContent = 'Pitcher vs Hitter';
    document.getElementById('welcome-subtitle').textContent = 'Step 1: Choose a pitcher';
    // All pitchers: Moeller + opponent
    stats.moellerPitcherList.forEach(n => items.push({ name: n, meta: 'Moeller', source: 'moeller_pitcher' }));
    Object.keys(stats.opponentPitchers).forEach(n => items.push({ name: n, meta: stats.opponentPitchers[n].team, source: 'opponent_pitcher' }));
  } else if (step === 2) {
    titleEl.textContent = 'Select a Hitter';
    inputEl.placeholder = 'Search hitters...';
    document.getElementById('welcome-title').textContent = 'Pitcher vs Hitter';
    document.getElementById('welcome-subtitle').textContent = `Step 2: Choose a hitter (vs ${matchupState.pitcher})`;
    // All hitters: Moeller + opponent
    stats.moellerHitterList.forEach(n => items.push({ name: n, meta: 'Moeller', source: 'moeller_hitter' }));
    Object.keys(stats.opponentBatters).forEach(n => items.push({ name: n, meta: stats.opponentBatters[n].team, source: 'opponent_batter' }));
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  window._menuItems = items;
  renderMatchupList(items);
  inputEl.focus();
}

function renderMatchupList(items) {
  const listEl = document.getElementById('step2-list');
  listEl.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'step2-item';
    el.innerHTML = `<span class="step2-item-name">${item.name}</span><span class="step2-item-meta">${item.meta}</span>`;
    el.addEventListener('click', () => {
      if (matchupState.step === 1) {
        matchupState.pitcher = item.name;
        matchupState.step = 2;
        showMatchupStep(2);
      } else if (matchupState.step === 2) {
        matchupState.hitter = item.name;
        matchupState.step = 3;
        showMatchupPerspective();
      }
    });
    listEl.appendChild(el);
  });
}

function showMatchupPerspective() {
  document.getElementById('menu-step2').classList.add('hidden');
  document.getElementById('menu-step3').classList.remove('hidden');
  document.getElementById('welcome-title').textContent = 'Pitcher vs Hitter';

  // Build subtitle like "RHP vs LHH"
  const pSrc = stats.opponentPitchers[matchupState.pitcher] || stats.moellerPitchers[matchupState.pitcher];
  const hSrc = stats.moellerHitters[matchupState.hitter] || stats.opponentBatters[matchupState.hitter];
  const pHand = (pSrc?.hand || '').toUpperCase();
  const hHand = (hSrc?.hand || '').toUpperCase();
  const pLabel = pHand === 'R' ? 'RHP' : pHand === 'L' ? 'LHP' : 'P';
  const hLabel = hHand === 'R' ? 'RHH' : hHand === 'L' ? 'LHH' : 'H';
  const subtitle = `${matchupState.pitcher} (${pLabel}) vs ${matchupState.hitter} (${hLabel})`;
  document.getElementById('step3-subtitle').textContent = subtitle;
  document.getElementById('welcome-subtitle').textContent = 'Step 3: Choose a perspective';
}

function computeMatchupProfile(pitcherName, hitterName) {
  // Find pitcher and hitter data sources
  const pSrc = stats.opponentPitchers[pitcherName] || stats.moellerPitchers[pitcherName];
  const hSrc = stats.moellerHitters[hitterName] || stats.opponentBatters[hitterName];
  if (!pSrc || !hSrc) return null;

  // Filter for H2H pitches: same pitcher AND same hitter
  const h2hPitches = filteredData.filter(row => {
    const pitcher = (row.Pitcher || '').trim();
    const batter = (row.Batter || '').trim();
    return pitcher === pitcherName && batter === hitterName;
  });

  // Compute individual profiles (always available as fallback)
  const pTeam = stats.opponentPitchers[pitcherName]?.team || 'Moeller';
  const pitcherProfile = computePitcherProfile(pSrc.pitches, pitcherName, pSrc.hand, pTeam);
  const hitterProfile = computeHitterProfile(hSrc.pitches, hitterName, hSrc.hand);

  // Compute H2H stats if we have data
  let h2h = null;
  if (h2hPitches.length > 0) {
    const byPitchType = {};
    let totalSwings = 0, totalWhiffs = 0, totalHits = 0, totalAB = 0, totalKs = 0, totalBBs = 0, totalPA = 0;
    const seenPA = new Set();

    h2hPitches.forEach(row => {
      const pt = normalizePitchType(row.PitchType);
      const result = (row.PitchResult || '').trim();
      const abResult = (row.AtBatResult || '').trim();

      if (!byPitchType[pt]) byPitchType[pt] = { pitches: 0, swings: 0, whiffs: 0, hits: 0, abs: 0 };
      byPitchType[pt].pitches++;

      const isSwing = result.includes('Swing') || result.includes('Foul') || result.includes('In Play');
      if (isSwing) { byPitchType[pt].swings++; totalSwings++; }
      if (result.includes('Swing and Miss')) { byPitchType[pt].whiffs++; totalWhiffs++; }

      const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Batter}-${row.PAofInning}`;
      if (abResult && !seenPA.has(paKey)) {
        seenPA.add(paKey);
        totalPA++;
        const isHit = ['1B', '2B', '3B', 'HR'].includes(abResult);
        const isAB = !['BB', 'HBP', 'IBB', 'Sacrifice', 'Catchers Interference'].includes(abResult);
        if (isHit) { totalHits++; byPitchType[pt].hits++; }
        if (isAB) { totalAB++; byPitchType[pt].abs++; }
        if (abResult === 'Strike Out') totalKs++;
        if (['BB', 'HBP', 'IBB'].includes(abResult)) totalBBs++;
      }
    });

    const pitchMix = {};
    Object.keys(byPitchType).sort((a, b) => byPitchType[b].pitches - byPitchType[a].pitches).forEach(pt => {
      const d = byPitchType[pt];
      pitchMix[pt] = {
        count: d.pitches,
        pct: pct(d.pitches, h2hPitches.length),
        whiffRate: pct(d.whiffs, d.swings),
        AVG: d.abs > 0 ? (d.hits / d.abs).toFixed(3) : 'N/A',
      };
    });

    h2h = {
      totalPitches: h2hPitches.length,
      totalPA,
      AVG: totalAB > 0 ? (totalHits / totalAB).toFixed(3) : 'N/A',
      K_rate: pct(totalKs, totalPA),
      BB_rate: pct(totalBBs, totalPA),
      whiffRate: pct(totalWhiffs, totalSwings),
      pitchMix,
    };
  }

  return {
    pitcherName,
    hitterName,
    pitcherHand: pSrc.hand,
    hitterHand: hSrc.hand,
    pitcherProfile,
    hitterProfile,
    h2h,
    hasH2H: h2hPitches.length > 0,
    h2hPitches: h2hPitches.length,
  };
}

function buildHitterAttacksBullets(list, data) {
  const pp = data.pitcherProfile;
  const h2h = data.h2h;
  const mix = pp?.pitchMix || {};
  const byCount = pp?.pitchMixByCount || {};
  const types = Object.keys(mix);

  // Use H2H data when available, fall back to pitcher profile
  const useMix = h2h ? h2h.pitchMix : null;

  // 1. First pitch approach
  const fpMix = byCount.first_pitch;
  if (fpMix) {
    const fpTypes = Object.keys(fpMix).sort((a, b) => parseFloat(fpMix[b]) - parseFloat(fpMix[a]));
    if (fpTypes.length > 0) {
      list.innerHTML += `<li>Sit <strong>${fpTypes[0]}</strong> first pitch — he throws it <strong>${fpMix[fpTypes[0]]}</strong> of the time</li>`;
    }
  }

  // 2. Most hittable pitch (lowest whiff rate)
  const src = useMix || mix;
  const hittable = Object.keys(src).filter(t => src[t]?.whiffRate && src[t].whiffRate !== 'N/A')
    .sort((a, b) => parseFloat(src[a].whiffRate) - parseFloat(src[b].whiffRate));
  if (hittable.length > 0) {
    const easiest = hittable[0];
    const whiff = src[easiest].whiffRate;
    const h2hNote = useMix ? ' (H2H)' : '';
    list.innerHTML += `<li>Most hittable: <strong>${easiest}</strong> — only <strong>${whiff} whiff rate</strong>${h2hNote}</li>`;
  }

  // 3. Pitch to protect against (highest whiff rate)
  if (hittable.length > 1) {
    const toughest = hittable[hittable.length - 1];
    const whiff = src[toughest].whiffRate;
    list.innerHTML += `<li>Protect against the <strong>${toughest}</strong> — <strong>${whiff} whiff rate</strong>, shorten up</li>`;
  }

  // 4. When pitcher is behind
  const behindMix = byCount.behind;
  if (behindMix) {
    const behTypes = Object.keys(behindMix).sort((a, b) => parseFloat(behindMix[b]) - parseFloat(behindMix[a]));
    if (behTypes.length > 0) {
      list.innerHTML += `<li>When he's behind, expect <strong>${behTypes[0]}</strong> (<strong>${behindMix[behTypes[0]]}</strong>) — be aggressive</li>`;
    }
  }

  // 5. Two-strike approach
  const tsMix = byCount.two_strikes;
  if (tsMix) {
    const tsTypes = Object.keys(tsMix).sort((a, b) => parseFloat(tsMix[b]) - parseFloat(tsMix[a]));
    if (tsTypes.length > 0) {
      const putaway = tsTypes[0];
      const whiff = mix[putaway]?.whiffRate || '?';
      list.innerHTML += `<li>With 2 strikes, guard the <strong>${putaway}</strong> (${tsMix[putaway]}) — <strong>${whiff} whiff</strong></li>`;
    }
  }
}

function buildPitcherAttacksBullets(list, data) {
  const hp = data.hitterProfile;
  const h2h = data.h2h;
  const rbt = hp?.resultsByPitchType || {};

  // Use H2H when available
  const useMix = h2h ? h2h.pitchMix : null;

  // 1. Best pitch to attack with (highest whiff in H2H or hitter's worst pitch)
  const src = useMix || rbt;
  const byWhiff = Object.keys(src).filter(t => {
    const w = src[t]?.whiffRate;
    return w && w !== 'N/A';
  }).sort((a, b) => parseFloat(src[b].whiffRate) - parseFloat(src[a].whiffRate));
  if (byWhiff.length > 0) {
    const best = byWhiff[0];
    const whiff = src[best].whiffRate;
    const h2hNote = useMix ? ' (H2H)' : '';
    list.innerHTML += `<li>Attack with <strong>${best}</strong> — <strong>${whiff} whiff rate</strong>${h2hNote}</li>`;
  }

  // 2. Pitch to be careful with (hitter's best AVG by pitch)
  const pitchAVG = useMix || rbt;
  const byAVG = Object.keys(pitchAVG).filter(t => pitchAVG[t]?.AVG && pitchAVG[t].AVG !== 'N/A')
    .sort((a, b) => parseFloat(pitchAVG[b].AVG) - parseFloat(pitchAVG[a].AVG));
  if (byAVG.length > 0) {
    const avoid = byAVG[0];
    if (!byWhiff.length || avoid !== byWhiff[0]) {
      list.innerHTML += `<li>Be careful with <strong>${avoid}</strong> — hits <strong>${pitchAVG[avoid].AVG}</strong> against it</li>`;
    } else if (byAVG.length > 1) {
      list.innerHTML += `<li>Be careful with <strong>${byAVG[1]}</strong> — hits <strong>${pitchAVG[byAVG[1]].AVG}</strong> against it</li>`;
    }
  }

  // 3. Chase rate advice
  const chaseNum = parseFloat(hp?.overallChaseRate) || 0;
  if (chaseNum > 30) {
    list.innerHTML += `<li>Expand the zone — chases <strong>${hp.overallChaseRate}</strong> out of zone</li>`;
  } else if (chaseNum > 0 && chaseNum <= 15) {
    list.innerHTML += `<li>Stay in the zone — only chases <strong>${hp.overallChaseRate}</strong>, don't waste pitches</li>`;
  } else if (chaseNum > 15) {
    list.innerHTML += `<li>Chase rate: <strong>${hp.overallChaseRate}</strong> — mix in some chase pitches</li>`;
  }

  // 4. Location targets — cold/hot zones (from hitter profile dugout stats)
  const hSrc = stats.moellerHitters[data.hitterName] || stats.opponentBatters[data.hitterName];
  if (hSrc) {
    const dugout = computeHitterDugoutStats(hSrc.pitches);
    const zs = dugout.zoneStats;
    const zoneNames = { 1: 'up-in', 2: 'up-mid', 3: 'up-away', 4: 'mid-in', 5: 'middle', 6: 'mid-away', 7: 'low-in', 8: 'low-mid', 9: 'low-away' };
    const coldZones = [], hotZones = [];
    for (let i = 1; i <= 9; i++) {
      if (zs[i].abs >= 3) {
        const avg = zs[i].hits / zs[i].abs;
        if (avg < 0.150) coldZones.push(zoneNames[i]);
        if (avg >= 0.300) hotZones.push(zoneNames[i]);
      }
    }
    if (coldZones.length > 0) {
      list.innerHTML += `<li>Target <strong>${coldZones.join(', ')}</strong> — cold zones</li>`;
    }
    if (hotZones.length > 0) {
      list.innerHTML += `<li>Avoid <strong>${hotZones.join(', ')}</strong> — hot zones</li>`;
    }
  }

  // 5. Put-away pitch
  if (byWhiff.length > 0) {
    const putaway = byWhiff[0];
    list.innerHTML += `<li>Put-away with 2 strikes: <strong>${putaway}</strong></li>`;
  }
}

function buildMatchupCard(perspective, data) {
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  const pHand = (data.pitcherHand || '').toUpperCase();
  const hHand = (data.hitterHand || '').toUpperCase();
  const pLabel = pHand === 'R' ? 'RHP' : pHand === 'L' ? 'LHP' : 'P';
  const hLabel = hHand === 'R' ? 'RHH' : hHand === 'L' ? 'LHH' : 'H';
  const title = perspective === 'hitter' ? "Hitter's Game Plan" : "Pitcher's Game Plan";
  header.innerHTML = `<span class="quick-look-name">${title}</span>
    <span class="quick-look-meta">${data.pitcherName} (${pLabel}) vs ${data.hitterName} (${hLabel})</span>`;
  card.appendChild(header);

  // H2H stat row (if data exists)
  if (data.h2h) {
    const statRow = document.createElement('div');
    statRow.className = 'quick-look-row';
    [
      { val: data.h2h.totalPitches, lbl: 'H2H Pitches' },
      { val: data.h2h.AVG, lbl: 'H2H AVG' },
      { val: data.h2h.K_rate, lbl: 'H2H K%' },
      { val: data.h2h.whiffRate, lbl: 'H2H Whiff%' },
    ].forEach(s => {
      const el = document.createElement('div');
      el.className = 'quick-look-stat';
      el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
      statRow.appendChild(el);
    });
    card.appendChild(statRow);
  }

  // Relay section with ~5 bullets
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = `<div class="ql-relay-title">${perspective === 'hitter' ? 'HITTING PLAN' : 'PITCHING PLAN'}</div>`;
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  if (perspective === 'hitter') {
    buildHitterAttacksBullets(list, data);
  } else {
    buildPitcherAttacksBullets(list, data);
  }

  relay.appendChild(list);
  card.appendChild(relay);

  // H2H pitch mix table
  const h2hMix = data.h2h?.pitchMix;
  const displayMix = h2hMix || data.pitcherProfile?.pitchMix;
  if (displayMix) {
    const mixTypes = Object.keys(displayMix);
    if (mixTypes.length > 0) {
      const pitchTable = document.createElement('div');
      pitchTable.className = 'ql-pitch-table';
      const isH2H = !!h2hMix;
      let tableHTML = `<div class="ql-pitch-header"><span>Pitch${isH2H ? ' (H2H)' : ''}</span><span>Usage</span><span>Whiff%</span><span>AVG</span></div>`;
      mixTypes.forEach(t => {
        const m = displayMix[t];
        const avgVal = m.AVG || '-';
        tableHTML += `<div class="ql-pitch-row">
          <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t] || '#95A5A6'}"></span>${t}</span>
          <span class="ql-pitch-val">${m.pct}</span>
          <span class="ql-pitch-val">${m.whiffRate || '-'}</span>
          <span class="ql-pitch-val">${avgVal}</span>
        </div>`;
      });
      pitchTable.innerHTML = tableHTML;
      card.appendChild(pitchTable);
    }
  }

  // Warnings
  if (!data.hasH2H) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = 'No head-to-head data found — showing individual profile stats as fallback.';
    card.appendChild(warn);
  } else if (data.h2hPitches < 15) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small H2H sample: only ${data.h2hPitches} pitches. Individual stats used to supplement.`;
    card.appendChild(warn);
  }

  if (data.pitcherProfile?.sampleSizeWarning) {
    const warn = document.createElement('div');
    warn.className = 'quick-look-bullets';
    warn.innerHTML = `<li><strong>Pitcher NOTE:</strong> ${data.pitcherProfile.sampleSizeWarning} <span class="ql-tag small">small sample</span></li>`;
    card.appendChild(warn);
  }
  if (data.hitterProfile?.sampleSizeWarning) {
    const warn = document.createElement('div');
    warn.className = 'quick-look-bullets';
    warn.innerHTML = `<li><strong>Hitter NOTE:</strong> ${data.hitterProfile.sampleSizeWarning} <span class="ql-tag small">small sample</span></li>`;
    card.appendChild(warn);
  }

  return card;
}

function executeMatchupReport(perspective) {
  const data = computeMatchupProfile(matchupState.pitcher, matchupState.hitter);
  if (!data) {
    showError('Could not compute matchup — missing data for one or both players.');
    return;
  }

  if (appMode === 'dugout') {
    // Render card directly (zero tokens)
    welcomeEl.classList.add('hidden');
    const pLabel = perspective === 'hitter' ? "Hitter's Plan" : "Pitcher's Plan";
    appendMessage('user', `${pLabel}: ${matchupState.pitcher} vs ${matchupState.hitter}`);
    const card = buildMatchupCard(perspective, data);
    appendQuickLook(card);
  } else {
    // Full mode — send to API
    welcomeEl.classList.add('hidden');
    const pHand = (data.pitcherHand || '').toUpperCase();
    const hHand = (data.hitterHand || '').toUpperCase();
    const pLabel = pHand === 'R' ? 'RHP' : pHand === 'L' ? 'LHP' : 'P';
    const hLabel = hHand === 'R' ? 'RHH' : hHand === 'L' ? 'LHH' : 'H';
    const perspLabel = perspective === 'hitter' ? "hitter's attack plan" : "pitcher's attack plan";
    const query = `Give me a ${perspLabel} for ${matchupState.hitter} (${hLabel}) facing ${matchupState.pitcher} (${pLabel}).`;
    const ctx = { type: 'matchup', data: { perspective, pitcherProfile: data.pitcherProfile, hitterProfile: data.hitterProfile, h2h: data.h2h } };
    const dataPayload = JSON.stringify(ctx.data, null, 2);
    const fullMessage = `Here is the relevant data (context type: matchup, perspective: ${perspective}). Coach's question: "${query}"\n\n${dataPayload}`;

    appendMessage('user', query);
    isLoading = true;
    sendBtn.disabled = true;
    const loadingEl = showLoading();

    fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage, session_id: sessionId, mode: appMode }),
    })
      .then(res => res.json().then(d => ({ ok: res.ok, data: d })))
      .then(({ ok, data: d }) => {
        removeLoading(loadingEl);
        if (!ok) throw new Error(d.error || 'Server error');
        appendMessage('assistant', d.reply);
      })
      .catch(err => {
        removeLoading(loadingEl);
        showError(err.message);
      })
      .finally(() => {
        isLoading = false;
        sendBtn.disabled = false;
        userInput.focus();
      });
  }
}

// ===== QUICK LOOK CARDS (Dugout Mode - no API call) =====
function buildQuickLookCard(profile, pitches) {
  if (!profile) return null;
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  const hand = (profile.hand || '').toUpperCase();
  const handLabel = hand === 'R' ? 'RHP' : hand === 'L' ? 'LHP' : hand;
  header.innerHTML = `<span class="quick-look-name">${profile.name}</span>
    <span class="quick-look-meta">${handLabel} | ${profile.team || ''} | ${profile.totalPitches} pitches</span>`;
  card.appendChild(header);

  const mix = profile.pitchMix || {};
  const types = Object.keys(mix);
  const primary = types[0] || 'N/A';
  const primaryVelo = mix[primary]?.avgVelo || '?';

  // ====== RELAY SECTION (top — what a coach reads in 10 seconds) ======
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">RELAY TO HITTER</div>';
  const relayList = document.createElement('ul');
  relayList.className = 'ql-relay-bullets';

  // 1. What to sit on first pitch
  const fpMix = profile.pitchMixByCount?.first_pitch;
  if (fpMix) {
    const fpTypes = Object.keys(fpMix).sort((a,b) => parseFloat(fpMix[b]) - parseFloat(fpMix[a]));
    const top = fpTypes[0];
    const fpPct = fpMix[top];
    relayList.innerHTML += `<li>Sit <strong>${top}</strong> first pitch — throws it <strong>${fpPct}</strong> of the time</li>`;
  }

  // 2. Put-away pitch — what to protect against
  const tsMix = profile.pitchMixByCount?.two_strikes;
  if (tsMix) {
    const tsTypes = Object.keys(tsMix).sort((a,b) => parseFloat(tsMix[b]) - parseFloat(tsMix[a]));
    const putaway = tsTypes[0];
    const whiff = mix[putaway]?.whiffRate || '?';
    relayList.innerHTML += `<li>With 2 strikes, protect against the <strong>${putaway}</strong> (${tsMix[putaway]}) — <strong>${whiff} whiff rate</strong></li>`;
  }

  // 3. When he's behind — be patient or attack
  const behindMix = profile.pitchMixByCount?.behind;
  if (behindMix) {
    const behTypes = Object.keys(behindMix).sort((a,b) => parseFloat(behindMix[b]) - parseFloat(behindMix[a]));
    relayList.innerHTML += `<li>When behind in count, he goes <strong>${behTypes[0]}</strong> (${behindMix[behTypes[0]]}) — be ready to drive it</li>`;
  }

  // 4. Best pitch to attack
  const bestToHit = types.filter(t => mix[t]?.whiffRate && mix[t].whiffRate !== 'N/A')
    .sort((a,b) => parseFloat(mix[a].whiffRate) - parseFloat(mix[b].whiffRate));
  if (bestToHit.length > 0) {
    const easiest = bestToHit[0];
    relayList.innerHTML += `<li>Most hittable pitch: <strong>${easiest}</strong> (only ${mix[easiest].whiffRate} whiff rate)</li>`;
  }

  // 5. Key split
  if (profile.vsRHH && profile.vsLHH) {
    const rAvg = profile.vsRHH.AVG || '?';
    const lAvg = profile.vsLHH.AVG || '?';
    const rNum = parseFloat(rAvg) || 0;
    const lNum = parseFloat(lAvg) || 0;
    if (rNum > 0 && lNum > 0) {
      if (rNum > lNum + 0.05) relayList.innerHTML += `<li>Hitters hit <strong>${rAvg}</strong> vs him from the right side — RHH have the edge</li>`;
      else if (lNum > rNum + 0.05) relayList.innerHTML += `<li>Hitters hit <strong>${lAvg}</strong> vs him from the left side — LHH have the edge</li>`;
    }
  }

  relay.appendChild(relayList);
  card.appendChild(relay);

  // ====== STAT ROW ======
  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [{val:`${primaryVelo}`,lbl:`${primary} Velo`},{val:profile.Strike_pct||'N/A',lbl:'Strike%'},{val:profile.Ball_pct||'N/A',lbl:'Ball%'},{val:profile.firstPitchStrike||'N/A',lbl:'FP Strike%'}].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // ====== PITCH TYPE TABLE ======
  if (types.length > 0) {
    const pitchTable = document.createElement('div');
    pitchTable.className = 'ql-pitch-table';
    let tableHTML = '<div class="ql-pitch-header"><span>Pitch</span><span>Usage</span><span>Velo</span><span>Whiff%</span></div>';
    types.forEach(t => {
      const m = mix[t];
      const velo = (m.veloMin && m.veloMax) ? `${m.veloMin}\u2013${m.veloMax}` : '-';
      tableHTML += `<div class="ql-pitch-row">
        <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>
        <span class="ql-pitch-val">${m.pct}</span>
        <span class="ql-pitch-val">${velo}</span>
        <span class="ql-pitch-val">${m.whiffRate || '-'}</span>
      </div>`;
    });
    pitchTable.innerHTML = tableHTML;
    card.appendChild(pitchTable);
  }

  // ====== PITCH USAGE BY COUNT TABLE ======
  const byCount = profile.pitchMixByCount || {};
  const countKeys = ['first_pitch','ahead','even','behind','two_strikes'];
  const countLabels = ['1st Pitch','Ahead','Even','Behind','2 Strikes'];
  const availCounts = countKeys.filter(k => byCount[k]);
  if (availCounts.length > 0 && types.length > 0) {
    const countTable = document.createElement('div');
    countTable.className = 'ql-pitch-table';
    let ctHTML = '<div class="ql-count-header"><span>Count</span>';
    types.forEach(t => { ctHTML += `<span><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>`; });
    ctHTML += '</div>';
    availCounts.forEach((k, i) => {
      const label = countLabels[countKeys.indexOf(k)];
      ctHTML += `<div class="ql-count-row"><span class="ql-count-label">${label}</span>`;
      types.forEach(t => {
        const val = byCount[k]?.[t] || '-';
        ctHTML += `<span class="ql-pitch-val">${val}</span>`;
      });
      ctHTML += '</div>';
    });
    countTable.innerHTML = ctHTML;
    card.appendChild(countTable);
  }

  // Sample size warning
  if (profile.sampleSizeWarning) {
    const warn = document.createElement('div');
    warn.className = 'quick-look-bullets';
    warn.innerHTML = `<li><strong>NOTE:</strong> ${profile.sampleSizeWarning} <span class="ql-tag small">small sample</span></li>`;
    card.appendChild(warn);
  }
  return card;
}

function buildTeamQuickLook(teamName) {
  const pitcherProfiles = {};
  const pitcherData = {};
  Object.keys(stats.opponentPitchers).forEach(n => {
    if (stats.opponentPitchers[n].team.toLowerCase() === teamName.toLowerCase()) {
      pitcherProfiles[n] = computePitcherProfile(stats.opponentPitchers[n].pitches, n, stats.opponentPitchers[n].hand, stats.opponentPitchers[n].team);
      pitcherData[n] = stats.opponentPitchers[n];
    }
  });
  const names = Object.keys(pitcherProfiles).sort((a,b) => (pitcherProfiles[b]?.totalPitches||0) - (pitcherProfiles[a]?.totalPitches||0));
  if (names.length === 0) return null;
  const container = document.createElement('div');

  // Inject GCL pitching stats if available (async)
  tryInjectGCLStats(container, teamName, 'pitching');

  // Team pitching summary card first
  const summary = buildTeamPitchersSummaryCard(teamName, pitcherData);
  if (summary) container.appendChild(summary);

  // Individual cards
  names.forEach(n => {
    const card = buildQuickLookCard(pitcherProfiles[n], stats.opponentPitchers[n]?.pitches);
    if (card) container.appendChild(card);
  });
  return container;
}

// ===== HITTER QUICK LOOK CARD =====
function computeHitterDugoutStats(pitches) {
  // Outcome by count group (5 groups)
  const outcomeByGroup = {
    first_pitch:{total:0,looking:0,whiff:0,foul:0,inPlay:0,ball:0},
    ahead:{total:0,looking:0,whiff:0,foul:0,inPlay:0,ball:0},
    even:{total:0,looking:0,whiff:0,foul:0,inPlay:0,ball:0},
    behind:{total:0,looking:0,whiff:0,foul:0,inPlay:0,ball:0},
    two_strikes:{total:0,looking:0,whiff:0,foul:0,inPlay:0,ball:0}
  };
  // vs RHP / LHP detailed
  const vsRHP = {pitches:0,abs:0,hits:0,ks:0,bbs:0,hbp:0,singles:0,doubles:0,triples:0,hrs:0,outs:0};
  const vsLHP = {pitches:0,abs:0,hits:0,ks:0,bbs:0,hbp:0,singles:0,doubles:0,triples:0,hrs:0,outs:0};
  // Zone stats (1-9 for strike zone)
  const zoneStats = {};
  for (let i = 1; i <= 9; i++) zoneStats[i] = {abs:0,hits:0};
  const seenPA = new Set();

  pitches.forEach(row => {
    const result = (row.PitchResult||'').trim();
    const abResult = (row.AtBatResult||'').trim();
    const b = parseInt(row.Balls)||0, s = parseInt(row.Strikes)||0;
    const countKey = `${b}-${s}`;
    const pH = (row.PitcherHand||'').trim().toUpperCase();
    const loc = parseInt(row.Location);

    // Outcome by count group
    const groups = [];
    if (b === 0 && s === 0) groups.push('first_pitch');
    if (s === 2) groups.push('two_strikes');
    if (b > s) groups.push('ahead');
    else if (s > b) groups.push('behind');
    else groups.push('even');
    groups.forEach(g => {
      const oc = outcomeByGroup[g];
      oc.total++;
      if (result.includes('Looking')) oc.looking++;
      else if (result.includes('Swing and Miss')) oc.whiff++;
      else if (result.includes('Foul')) oc.foul++;
      else if (result.includes('In Play')) oc.inPlay++;
      else if (result === 'Ball' || result.includes('Ball')) oc.ball++;
    });

    // PA-level stats
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Pitcher}-${row.PAofInning}`;
    const sp = pH === 'R' ? vsRHP : vsLHP;
    sp.pitches++;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey);
      const isHit = ['1B','2B','3B','HR'].includes(abResult);
      const isAB = !['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
      if (isAB) sp.abs++;
      if (isHit) sp.hits++;
      if (abResult === 'Strike Out') sp.ks++;
      if (abResult === 'BB') sp.bbs++;
      if (abResult === 'HBP') sp.hbp++;
      if (abResult === '1B') sp.singles++;
      if (abResult === '2B') sp.doubles++;
      if (abResult === '3B') sp.triples++;
      if (abResult === 'HR') sp.hrs++;
      if (['Ground Out','Fly Out','Line Out','Double Play','Infield Fly','Fielders Choice'].includes(abResult) || abResult === 'Strike Out') sp.outs++;

      // Zone stats
      if (loc >= 1 && loc <= 9 && isAB) {
        zoneStats[loc].abs++;
        if (isHit) zoneStats[loc].hits++;
      }
    }
  });

  // Compute wOBA (standard weights, exclude IBB)
  function calcWOBA(s) {
    const num = (0.69*s.bbs) + (0.72*s.hbp) + (0.89*s.singles) + (1.27*s.doubles) + (1.62*s.triples) + (2.10*s.hrs);
    const den = s.abs + s.bbs + s.hbp;
    return den > 0 ? (num/den).toFixed(3) : 'N/A';
  }
  function splitPA(s) { return s.abs + s.bbs + s.hbp; }

  return {
    outcomeByGroup,
    vsRHP: { ...vsRHP, AVG: vsRHP.abs>0?(vsRHP.hits/vsRHP.abs).toFixed(3):'N/A', K_rate:pct(vsRHP.ks,splitPA(vsRHP)||1), wOBA:calcWOBA(vsRHP), XBH:vsRHP.doubles+vsRHP.triples+vsRHP.hrs, H:vsRHP.hits },
    vsLHP: { ...vsLHP, AVG: vsLHP.abs>0?(vsLHP.hits/vsLHP.abs).toFixed(3):'N/A', K_rate:pct(vsLHP.ks,splitPA(vsLHP)||1), wOBA:calcWOBA(vsLHP), XBH:vsLHP.doubles+vsLHP.triples+vsLHP.hrs, H:vsLHP.hits },
    zoneStats,
  };
}

function buildHitterQuickLookCard(profile, pitches) {
  if (!profile) return null;
  const card = document.createElement('div');
  card.className = 'quick-look-card';
  const dugout = computeHitterDugoutStats(pitches);

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  const hand = (profile.hand||'').toUpperCase();
  const handLabel = hand === 'R' ? 'RHH' : hand === 'L' ? 'LHH' : hand || '?';
  header.innerHTML = `<span class="quick-look-name">${profile.name}</span>
    <span class="quick-look-meta">${handLabel} | ${profile.totalPitchesSeen} pitches seen | ${profile.totalPA} PA</span>`;
  card.appendChild(header);

  // ====== COACH'S NOTES (top — what a coach processes in 10 seconds) ======
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">COACH\'S NOTES</div>';
  const relayList = document.createElement('ul');
  relayList.className = 'ql-relay-bullets';

  // 1 & 2. Strength + weakness — avoid contradicting the same pitch
  const rbt = profile.resultsByPitchType || {};
  const hittable = Object.keys(rbt).filter(t => rbt[t].pitchesSeen >= 5 && rbt[t].AVG !== 'N/A')
    .sort((a,b) => parseFloat(rbt[b].AVG) - parseFloat(rbt[a].AVG));
  const struggles = Object.keys(rbt).filter(t => rbt[t].pitchesSeen >= 5 && rbt[t].whiffRate && rbt[t].whiffRate !== 'N/A')
    .sort((a,b) => parseFloat(rbt[b].whiffRate) - parseFloat(rbt[a].whiffRate));
  const bestPitch = hittable.length > 0 ? hittable[0] : null;
  const worstPitch = struggles.length > 0 ? struggles[0] : null;

  if (bestPitch && worstPitch && bestPitch === worstPitch) {
    // Same pitch has high AVG and high whiff — give nuanced advice
    const avg = parseFloat(rbt[bestPitch].AVG);
    const whiff = parseFloat(rbt[bestPitch].whiffRate);
    if (avg >= .300 && whiff >= 30) {
      relayList.innerHTML += `<li>Swings and misses at <strong>${bestPitch}</strong> often (<strong>${rbt[bestPitch].whiffRate} whiff</strong>) but does damage when contact is made (<strong>${rbt[bestPitch].AVG} AVG</strong>) — shorten up to make contact</li>`;
    } else if (avg >= .300) {
      relayList.innerHTML += `<li>Hits <strong>${rbt[bestPitch].AVG}</strong> against <strong>${bestPitch}</strong> — look to attack it</li>`;
    } else {
      relayList.innerHTML += `<li>Struggles with <strong>${worstPitch}</strong> — <strong>${rbt[worstPitch].whiffRate} whiff rate</strong>, shorten up</li>`;
    }
    // Show next-best for the other note if available
    if (hittable.length > 1) {
      const next = hittable[1];
      relayList.innerHTML += `<li>Hits <strong>${rbt[next].AVG}</strong> against <strong>${next}</strong> — look to attack it</li>`;
    }
    if (struggles.length > 1) {
      const next = struggles[1];
      relayList.innerHTML += `<li>Struggles with <strong>${next}</strong> — <strong>${rbt[next].whiffRate} whiff rate</strong>, shorten up</li>`;
    }
  } else {
    if (bestPitch) {
      relayList.innerHTML += `<li>Hits <strong>${rbt[bestPitch].AVG}</strong> against <strong>${bestPitch}</strong> — look to attack it</li>`;
    }
    if (worstPitch) {
      relayList.innerHTML += `<li>Struggles with <strong>${worstPitch}</strong> — <strong>${rbt[worstPitch].whiffRate} whiff rate</strong>, shorten up</li>`;
    }
  }

  // 3. Chase rate callout
  const chaseNum = parseFloat(profile.overallChaseRate) || 0;
  if (chaseNum > 30) {
    relayList.innerHTML += `<li>Chasing <strong>${profile.overallChaseRate}</strong> of pitches out of zone — be more selective</li>`;
  } else if (chaseNum > 0 && chaseNum <= 20) {
    relayList.innerHTML += `<li>Disciplined eye — only chasing <strong>${profile.overallChaseRate}</strong> out of zone</li>`;
  }

  // 4. RHP vs LHP edge
  const rAvg = parseFloat(dugout.vsRHP.AVG) || 0;
  const lAvg = parseFloat(dugout.vsLHP.AVG) || 0;
  if (rAvg > 0 && lAvg > 0) {
    if (rAvg > lAvg + 0.05) relayList.innerHTML += `<li>Better vs RHP (<strong>${dugout.vsRHP.AVG}</strong>) than LHP (<strong>${dugout.vsLHP.AVG}</strong>)</li>`;
    else if (lAvg > rAvg + 0.05) relayList.innerHTML += `<li>Better vs LHP (<strong>${dugout.vsLHP.AVG}</strong>) than RHP (<strong>${dugout.vsRHP.AVG}</strong>)</li>`;
  }

  // 5. Hot zone callout
  const zs = dugout.zoneStats;
  const hotZones = [];
  const coldZones = [];
  const zoneNames = {1:'up-in',2:'up-mid',3:'up-away',4:'mid-in',5:'middle',6:'mid-away',7:'low-in',8:'low-mid',9:'low-away'};
  for (let i = 1; i <= 9; i++) {
    if (zs[i].abs >= 3) {
      const avg = zs[i].hits / zs[i].abs;
      if (avg >= .300) hotZones.push(zoneNames[i]);
      else if (avg < .150) coldZones.push(zoneNames[i]);
    }
  }
  if (hotZones.length > 0) relayList.innerHTML += `<li>Hot zones: <strong>${hotZones.join(', ')}</strong></li>`;
  if (coldZones.length > 0) relayList.innerHTML += `<li>Cold zones: <strong>${coldZones.join(', ')}</strong></li>`;

  relay.appendChild(relayList);
  card.appendChild(relay);

  // ====== STAT ROW ======
  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [{val:profile.AVG,lbl:'AVG'},{val:profile.K_rate,lbl:'K Rate'},{val:profile.BB_rate,lbl:'BB Rate'},{val:profile.overallChaseRate,lbl:'Chase Rate'}].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val||'N/A'}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // vs RHP / vs LHP split boxes
  const splitRow = document.createElement('div');
  splitRow.className = 'ql-splits-row';
  ['RHP','LHP'].forEach(side => {
    const d = side === 'RHP' ? dugout.vsRHP : dugout.vsLHP;
    const box = document.createElement('div');
    box.className = 'ql-split-box';
    box.innerHTML = `<div class="ql-split-title">vs ${side}</div>
      <div class="ql-split-stats">
        <span><strong>${d.AVG}</strong> AVG</span>
        <span><strong>${d.K_rate}</strong> K%</span>
        <span><strong>${d.wOBA}</strong> wOBA</span>
        <span><strong>${d.H}</strong> H</span>
        <span><strong>${d.XBH}</strong> XBH</span>
      </div>`;
    splitRow.appendChild(box);
  });
  card.appendChild(splitRow);

  // Pitch results by type table
  const rbt2 = profile.resultsByPitchType || {};
  const ptypes = Object.keys(rbt2).sort((a,b) => (rbt2[b].pitchesSeen||0) - (rbt2[a].pitchesSeen||0));
  if (ptypes.length > 0) {
    const ptTable = document.createElement('div');
    ptTable.className = 'ql-pitch-table';
    let ptHTML = '<div class="ql-pitch-header"><span>Pitch</span><span>Seen</span><span>AVG</span><span>Whiff%</span><span>Chase%</span></div>';
    ptypes.forEach(t => {
      const d = rbt2[t];
      ptHTML += `<div class="ql-pitch-row">
        <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>
        <span class="ql-pitch-val">${d.pitchesSeen}</span>
        <span class="ql-pitch-val">${d.AVG}</span>
        <span class="ql-pitch-val">${d.whiffRate||'-'}</span>
        <span class="ql-pitch-val">${d.chaseRate||'-'}</span>
      </div>`;
    });
    ptTable.innerHTML = ptHTML;
    card.appendChild(ptTable);
  }

  // Outcome by count group table
  const obg = dugout.outcomeByGroup;
  const groupKeys = ['first_pitch','ahead','even','behind','two_strikes'];
  const groupLabels = {'first_pitch':'1st Pitch','ahead':'Ahead','even':'Even','behind':'Behind','two_strikes':'2 Strikes'};
  const hasGroups = groupKeys.some(k => obg[k]?.total > 0);
  if (hasGroups) {
    const ocTable = document.createElement('div');
    ocTable.className = 'ql-pitch-table';
    let ocHTML = '<div class="ql-count-header"><span>Count</span><span>N</span><span>Look%</span><span>Whiff%</span><span>Foul%</span><span>InPlay%</span><span>Ball%</span></div>';
    groupKeys.forEach(k => {
      const d = obg[k];
      if (d.total === 0) return;
      const p = v => d.total > 0 ? ((v/d.total)*100).toFixed(0)+'%' : '-';
      ocHTML += `<div class="ql-count-row">
        <span class="ql-count-label">${groupLabels[k]}</span>
        <span class="ql-pitch-val">${d.total}</span>
        <span class="ql-pitch-val">${p(d.looking)}</span>
        <span class="ql-pitch-val">${p(d.whiff)}</span>
        <span class="ql-pitch-val">${p(d.foul)}</span>
        <span class="ql-pitch-val">${p(d.inPlay)}</span>
        <span class="ql-pitch-val">${p(d.ball)}</span>
      </div>`;
    });
    ocTable.innerHTML = ocHTML;
    card.appendChild(ocTable);
  }

  // Hot/Cold zone 3x3 grid
  const zs2 = dugout.zoneStats;
  const hasZones = Object.values(zs2).some(z => z.abs > 0);
  if (hasZones) {
    const zoneDiv = document.createElement('div');
    zoneDiv.className = 'ql-zone-section';
    zoneDiv.innerHTML = '<div class="ql-zone-title">Hot/Cold Zone — Catcher\'s View</div>';
    const grid = document.createElement('div');
    grid.className = 'ql-zone-grid';
    for (let i = 1; i <= 9; i++) {
      const cell = document.createElement('div');
      cell.className = 'ql-zone-cell';
      const z = zs2[i];
      const avg = z.abs > 0 ? z.hits / z.abs : -1;
      if (avg < 0) { cell.style.background = 'rgba(255,255,255,0.05)'; cell.textContent = '-'; cell.style.color = '#666'; }
      else if (avg >= .300) { cell.style.background = 'rgba(46,204,113,0.6)'; cell.style.color = '#fff'; }
      else if (avg >= .200) { cell.style.background = 'rgba(241,196,15,0.5)'; cell.style.color = '#fff'; }
      else { cell.style.background = 'rgba(230,57,70,0.5)'; cell.style.color = '#fff'; }
      if (avg >= 0) cell.innerHTML = `<span class="ql-zone-avg">${avg.toFixed(3)}</span><span class="ql-zone-ab">${z.abs} AB</span>`;
      grid.appendChild(cell);
    }
    zoneDiv.appendChild(grid);
    const legend = document.createElement('div');
    legend.className = 'ql-zone-legend';
    legend.innerHTML = '<span style="color:#2ECC71">Hot .300+</span> <span style="color:#F1C40F">.200-.299</span> <span style="color:#E63946">Cold &lt;.200</span>';
    zoneDiv.appendChild(legend);
    card.appendChild(zoneDiv);
  }

  // Sample size warning
  if (profile.sampleSizeWarning) {
    const warn = document.createElement('div');
    warn.className = 'quick-look-bullets';
    warn.innerHTML = `<li><strong>NOTE:</strong> ${profile.sampleSizeWarning} <span class="ql-tag small">small sample</span></li>`;
    card.appendChild(warn);
  }

  return card;
}

function buildTeamHittersSummaryCard(teamName, hitters) {
  const names = Object.keys(hitters);
  if (names.length === 0) return null;
  // Aggregate all pitches
  const allPitches = [];
  names.forEach(n => { allPitches.push(...(hitters[n].pitches || [])); });
  const totalPitches = allPitches.length;

  // Aggregate PA-level stats
  let totalPA=0, totalAB=0, totalHits=0, totalKs=0, totalBBs=0, totalXBH=0;
  let chaseSwings=0, chasePitches=0;
  const vsRHP={abs:0,hits:0,ks:0,bbs:0,hbp:0,singles:0,doubles:0,triples:0,hrs:0,outs:0};
  const vsLHP={abs:0,hits:0,ks:0,bbs:0,hbp:0,singles:0,doubles:0,triples:0,hrs:0,outs:0};
  const byPitchType={};
  const chasePitchesByType={}, chaseSwingsByType={};
  const seenPA = new Set();

  allPitches.forEach(row => {
    const pt = normalizePitchType(row.PitchType);
    const result = (row.PitchResult||'').trim();
    const abResult = (row.AtBatResult||'').trim();
    const zone = (row.AttackZone||'').trim();
    const pH = (row.PitcherHand||'').trim().toUpperCase();
    if (!byPitchType[pt]) byPitchType[pt]={pitches:0,swings:0,whiffs:0,hits:0,abs:0};
    byPitchType[pt].pitches++;
    const isSwing = result.includes('Swing')||result.includes('Foul')||result.includes('In Play');
    if (isSwing) byPitchType[pt].swings++;
    if (result.includes('Swing and Miss')) byPitchType[pt].whiffs++;
    if (zone==='Chase'||zone==='Waste') {
      chasePitches++;
      if (isSwing) chaseSwings++;
      chasePitchesByType[pt]=(chasePitchesByType[pt]||0)+1;
      if (isSwing) chaseSwingsByType[pt]=(chaseSwingsByType[pt]||0)+1;
    }
    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Batter}-${row.Pitcher}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey); totalPA++;
      const isHit = ['1B','2B','3B','HR'].includes(abResult);
      const isAB = !['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
      if (isHit) totalHits++;
      if (isAB) totalAB++;
      if (abResult==='Strike Out') totalKs++;
      if (['BB','HBP','IBB'].includes(abResult)) totalBBs++;
      if (['2B','3B','HR'].includes(abResult)) totalXBH++;
      if (isAB) byPitchType[pt].abs++;
      if (isHit) byPitchType[pt].hits++;
      const sp = pH==='R' ? vsRHP : vsLHP;
      if (isAB) sp.abs++;
      if (isHit) sp.hits++;
      if (abResult==='Strike Out') sp.ks++;
      if (abResult==='BB') sp.bbs++;
      if (abResult==='HBP') sp.hbp++;
      if (abResult==='1B') sp.singles++;
      if (abResult==='2B') sp.doubles++;
      if (abResult==='3B') sp.triples++;
      if (abResult==='HR') sp.hrs++;
      if (['Ground Out','Fly Out','Line Out','Double Play','Infield Fly','Fielders Choice','Strike Out'].includes(abResult)) sp.outs++;
    }
  });

  function calcWOBA(s) {
    const num = (0.69*s.bbs)+(0.72*s.hbp)+(0.89*s.singles)+(1.27*s.doubles)+(1.62*s.triples)+(2.10*s.hrs);
    const den = s.abs+s.bbs+s.hbp;
    return den>0?(num/den).toFixed(3):'N/A';
  }

  const teamAVG = totalAB>0?(totalHits/totalAB).toFixed(3):'N/A';
  const teamKRate = pct(totalKs,totalPA);
  const teamBBRate = pct(totalBBs,totalPA);
  const teamChase = pct(chaseSwings,chasePitches);

  // Build card
  const card = document.createElement('div');
  card.className = 'quick-look-card';
  card.style.borderColor = '#C5A55A';
  card.style.borderWidth = '3px';

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${teamName} — Team Hitting Summary</span>
    <span class="quick-look-meta">${names.length} hitters | ${totalPA} PA | ${totalPitches} pitches</span>`;
  card.appendChild(header);

  // Coach's Notes
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">TEAM OVERVIEW</div>';
  const relayList = document.createElement('ul');
  relayList.className = 'ql-relay-bullets';

  relayList.innerHTML += `<li>Team batting <strong>${teamAVG}</strong> with <strong>${totalXBH} XBH</strong> across ${totalPA} plate appearances</li>`;
  relayList.innerHTML += `<li>Strikeout rate: <strong>${teamKRate}</strong> | Walk rate: <strong>${teamBBRate}</strong></li>`;

  const chaseNum = parseFloat(teamChase)||0;
  if (chaseNum > 30) relayList.innerHTML += `<li>Team chasing <strong>${teamChase}</strong> out of zone — need more discipline</li>`;
  else if (chaseNum > 0 && chaseNum <= 22) relayList.innerHTML += `<li>Disciplined lineup — only chasing <strong>${teamChase}</strong> out of zone</li>`;
  else if (chaseNum > 0) relayList.innerHTML += `<li>Team chase rate: <strong>${teamChase}</strong></li>`;

  const rAvg = vsRHP.abs>0?(vsRHP.hits/vsRHP.abs).toFixed(3):'N/A';
  const lAvg = vsLHP.abs>0?(vsLHP.hits/vsLHP.abs).toFixed(3):'N/A';
  const rW = calcWOBA(vsRHP), lW = calcWOBA(vsLHP);
  relayList.innerHTML += `<li>vs RHP: <strong>${rAvg}</strong> AVG / <strong>${rW}</strong> wOBA | vs LHP: <strong>${lAvg}</strong> AVG / <strong>${lW}</strong> wOBA</li>`;

  // Best/worst pitch type
  const ptKeys = Object.keys(byPitchType).filter(t => byPitchType[t].abs >= 5);
  const bestPT = ptKeys.sort((a,b) => {
    const aAvg = byPitchType[a].abs>0?byPitchType[a].hits/byPitchType[a].abs:0;
    const bAvg = byPitchType[b].abs>0?byPitchType[b].hits/byPitchType[b].abs:0;
    return bAvg - aAvg;
  });
  if (bestPT.length > 0) {
    const best = bestPT[0];
    const bAvg = (byPitchType[best].hits/byPitchType[best].abs).toFixed(3);
    relayList.innerHTML += `<li>Best against <strong>${best}</strong> — hitting <strong>${bAvg}</strong></li>`;
  }
  if (bestPT.length > 1) {
    const worst = bestPT[bestPT.length-1];
    const wAvg = (byPitchType[worst].hits/byPitchType[worst].abs).toFixed(3);
    const wWhiff = byPitchType[worst].swings>0?pct(byPitchType[worst].whiffs,byPitchType[worst].swings):'?';
    relayList.innerHTML += `<li>Weakest against <strong>${worst}</strong> — hitting <strong>${wAvg}</strong> (${wWhiff} whiff)</li>`;
  }

  relay.appendChild(relayList);
  card.appendChild(relay);

  // Stat row
  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [{val:teamAVG,lbl:'Team AVG'},{val:teamKRate,lbl:'K Rate'},{val:teamBBRate,lbl:'BB Rate'},{val:teamChase,lbl:'Chase Rate'},{val:String(totalXBH),lbl:'XBH'}].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val||'N/A'}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // vs RHP / vs LHP splits
  const splitRow = document.createElement('div');
  splitRow.className = 'ql-splits-row';
  [{side:'RHP',d:vsRHP,avg:rAvg,w:rW},{side:'LHP',d:vsLHP,avg:lAvg,w:lW}].forEach(({side,d,avg:a,w}) => {
    const box = document.createElement('div');
    box.className = 'ql-split-box';
    box.innerHTML = `<div class="ql-split-title">vs ${side}</div>
      <div class="ql-split-stats">
        <span><strong>${a}</strong> AVG</span>
        <span><strong>${pct(d.ks,(d.abs+d.bbs+d.hbp)||1)}</strong> K%</span>
        <span><strong>${w}</strong> wOBA</span>
        <span><strong>${d.hits}</strong> H</span>
        <span><strong>${d.doubles+d.triples+d.hrs}</strong> XBH</span>
      </div>`;
    splitRow.appendChild(box);
  });
  card.appendChild(splitRow);

  // Pitch results by type
  const ptSorted = Object.keys(byPitchType).sort((a,b) => byPitchType[b].pitches - byPitchType[a].pitches);
  if (ptSorted.length > 0) {
    const ptTable = document.createElement('div');
    ptTable.className = 'ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Pitch</span><span>Seen</span><span>AVG</span><span>Whiff%</span><span>Chase%</span></div>';
    ptSorted.forEach(t => {
      const d = byPitchType[t];
      const a = d.abs>0?(d.hits/d.abs).toFixed(3):'N/A';
      const w = d.swings>0?pct(d.whiffs,d.swings):'-';
      const ch = chasePitchesByType[t]>0?pct(chaseSwingsByType[t]||0,chasePitchesByType[t]):'-';
      html += `<div class="ql-pitch-row">
        <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>
        <span class="ql-pitch-val">${d.pitches}</span>
        <span class="ql-pitch-val">${a}</span>
        <span class="ql-pitch-val">${w}</span>
        <span class="ql-pitch-val">${ch}</span>
      </div>`;
    });
    ptTable.innerHTML = html;
    card.appendChild(ptTable);
  }

  return card;
}

function buildTeamPitchersSummaryCard(teamName, pitcherData) {
  const names = Object.keys(pitcherData);
  if (names.length === 0) return null;
  // Aggregate all pitches
  const allPitches = [];
  names.forEach(n => { allPitches.push(...(pitcherData[n].pitches || [])); });
  const totalPitches = allPitches.length;

  let totalPA=0, ks=0, bbs=0, hrs=0, hits=0, firstPitchStrikes=0, firstPitches=0, teamStrikes=0, teamBalls=0;
  const pitchTypes={}, veloByType={}, whiffByType={}, swingsByType={};
  const vsRHH={pitches:0,abs:0,hits:0,ks:0}, vsLHH={pitches:0,abs:0,hits:0,ks:0};
  const byCount={first_pitch:{},ahead:{},behind:{},even:{},two_strikes:{}};
  const seenPA = new Set();

  allPitches.forEach(row => {
    const pt = normalizePitchType(row.PitchType);
    const result = (row.PitchResult||'').trim();
    const abResult = (row.AtBatResult||'').trim();
    const velo = parseFloat(row.PitchVelo);
    const bHand = (row['Batter Hand']||'').trim().toUpperCase();
    const b = parseInt(row.Balls)||0, s = parseInt(row.Strikes)||0;

    pitchTypes[pt] = (pitchTypes[pt]||0)+1;
    if (!isNaN(velo)&&velo>0) { if (!veloByType[pt]) veloByType[pt]=[]; veloByType[pt].push(velo); }
    const isSwing = result.includes('Swing')||result.includes('Foul')||result.includes('In Play');
    const isStrike = result.includes('Strike')||result.includes('Foul')||result.includes('In Play');
    const isBall = result==='Ball'||result.includes('Ball');
    if (isStrike) teamStrikes++;
    if (isBall) teamBalls++;
    if (isSwing) swingsByType[pt] = (swingsByType[pt]||0)+1;
    if (result.includes('Swing and Miss')) whiffByType[pt] = (whiffByType[pt]||0)+1;
    if (b===0&&s===0) { firstPitches++; if (isStrike) firstPitchStrikes++; }

    const labels = [];
    if (b===0&&s===0) labels.push('first_pitch');
    if (s===2) labels.push('two_strikes');
    if (s>b) labels.push('ahead'); else if (b>s) labels.push('behind'); else labels.push('even');
    labels.forEach(l => { if (byCount[l]) byCount[l][pt] = (byCount[l][pt]||0)+1; });

    const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Batter}-${row.Pitcher}-${row.PAofInning}`;
    if (abResult && !seenPA.has(paKey)) {
      seenPA.add(paKey); totalPA++;
      const isHit = ['1B','2B','3B','HR'].includes(abResult);
      const isAB = !['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
      if (abResult==='Strike Out') ks++;
      if (['BB','HBP','IBB'].includes(abResult)) bbs++;
      if (abResult==='HR') hrs++;
      if (isHit) hits++;
      const sp = bHand==='R' ? vsRHH : vsLHH;
      sp.pitches++;
      if (isAB) sp.abs++;
      if (isHit) sp.hits++;
      if (abResult==='Strike Out') sp.ks++;
    }
  });

  const types = Object.keys(pitchTypes).sort((a,b)=>pitchTypes[b]-pitchTypes[a]);

  // Build card
  const card = document.createElement('div');
  card.className = 'quick-look-card';
  card.style.borderColor = '#C5A55A';
  card.style.borderWidth = '3px';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${teamName} — Team Pitching Summary</span>
    <span class="quick-look-meta">${names.length} pitchers | ${totalPA} PA | ${totalPitches} pitches</span>`;
  card.appendChild(header);

  // Staff overview
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">STAFF OVERVIEW</div>';
  const relayList = document.createElement('ul');
  relayList.className = 'ql-relay-bullets';

  relayList.innerHTML += `<li>Staff Strike%: <strong>${pct(teamStrikes,totalPitches)}</strong> | Ball%: <strong>${pct(teamBalls,totalPitches)}</strong> | FP Strike%: <strong>${pct(firstPitchStrikes,firstPitches)}</strong></li>`;

  // Primary pitch
  if (types.length > 0) {
    const primary = types[0];
    const pPct = pct(pitchTypes[primary], totalPitches);
    const pVelo = veloByType[primary] ? avg(veloByType[primary]) : '?';
    relayList.innerHTML += `<li>Staff throws <strong>${primary}</strong> most (${pPct}) at avg <strong>${pVelo} mph</strong></li>`;
  }

  // vs RHH / LHH
  const rAvg = vsRHH.abs>0?(vsRHH.hits/vsRHH.abs).toFixed(3):'N/A';
  const lAvg = vsLHH.abs>0?(vsLHH.hits/vsLHH.abs).toFixed(3):'N/A';
  relayList.innerHTML += `<li>Hitters vs staff: RHH <strong>${rAvg}</strong> | LHH <strong>${lAvg}</strong></li>`;

  // Best put-away pitch (highest whiff rate)
  const putaway = types.filter(t => (swingsByType[t]||0) >= 10)
    .sort((a,b) => ((whiffByType[b]||0)/(swingsByType[b]||1)) - ((whiffByType[a]||0)/(swingsByType[a]||1)));
  if (putaway.length > 0) {
    const best = putaway[0];
    relayList.innerHTML += `<li>Best put-away pitch: <strong>${best}</strong> (${pct(whiffByType[best]||0,swingsByType[best]||0)} whiff rate)</li>`;
  }

  // Most hittable
  const hittable = types.filter(t => (swingsByType[t]||0) >= 10)
    .sort((a,b) => ((whiffByType[a]||0)/(swingsByType[a]||1)) - ((whiffByType[b]||0)/(swingsByType[b]||1)));
  if (hittable.length > 0 && hittable[0] !== (putaway.length>0?putaway[0]:'')) {
    const weak = hittable[0];
    relayList.innerHTML += `<li>Most hittable pitch: <strong>${weak}</strong> (only ${pct(whiffByType[weak]||0,swingsByType[weak]||0)} whiff rate)</li>`;
  }

  relay.appendChild(relayList);
  card.appendChild(relay);

  // Stat row
  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [{val:pct(teamStrikes,totalPitches),lbl:'Strike%'},{val:pct(teamBalls,totalPitches),lbl:'Ball%'},{val:pct(firstPitchStrikes,firstPitches),lbl:'FP Strike%'},{val:pct(whiffByType[types[0]]||0,swingsByType[types[0]]||0),lbl:'Whiff%'},{val:String(names.length),lbl:'Arms'}].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val||'N/A'}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Pitch mix table
  if (types.length > 0) {
    const pitchTable = document.createElement('div');
    pitchTable.className = 'ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Pitch</span><span>Usage</span><span>Velo</span><span>Whiff%</span></div>';
    types.forEach(t => {
      html += `<div class="ql-pitch-row">
        <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>
        <span class="ql-pitch-val">${pct(pitchTypes[t],totalPitches)}</span>
        <span class="ql-pitch-val">${veloByType[t]?Math.min(...veloByType[t]).toFixed(0)+'\u2013'+Math.max(...veloByType[t]).toFixed(0):'-'}</span>
        <span class="ql-pitch-val">${pct(whiffByType[t]||0,swingsByType[t]||0)}</span>
      </div>`;
    });
    pitchTable.innerHTML = html;
    card.appendChild(pitchTable);
  }

  // Usage by count
  const countKeys = ['first_pitch','ahead','even','behind','two_strikes'];
  const countLabels = ['1st Pitch','Ahead','Even','Behind','2 Strikes'];
  const availCounts = countKeys.filter(k => Object.keys(byCount[k]||{}).length > 0);
  if (availCounts.length > 0 && types.length > 0) {
    const countTable = document.createElement('div');
    countTable.className = 'ql-pitch-table';
    let ctHTML = '<div class="ql-count-header"><span>Count</span>';
    types.forEach(t => { ctHTML += `<span><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>`; });
    ctHTML += '</div>';
    availCounts.forEach(k => {
      const label = countLabels[countKeys.indexOf(k)];
      const ct = Object.values(byCount[k]).reduce((a,b)=>a+b,0);
      ctHTML += `<div class="ql-count-row"><span class="ql-count-label">${label}</span>`;
      types.forEach(t => {
        const val = byCount[k][t] ? pct(byCount[k][t],ct) : '-';
        ctHTML += `<span class="ql-pitch-val">${val}</span>`;
      });
      ctHTML += '</div>';
    });
    countTable.innerHTML = ctHTML;
    card.appendChild(countTable);
  }

  return card;
}

function buildTeamHittersQuickLook(teamName) {
  const isM = /moeller/i.test(teamName);
  const hitters = isM ? stats.moellerHitters : {};
  if (!isM) {
    Object.keys(stats.opponentBatters).forEach(n => {
      if (stats.opponentBatters[n].team.toLowerCase() === teamName.toLowerCase()) hitters[n] = stats.opponentBatters[n];
    });
  }
  const names = Object.keys(hitters).sort((a,b) => (hitters[b]?.pitches?.length||0) - (hitters[a]?.pitches?.length||0));
  if (names.length === 0) return null;
  const container = document.createElement('div');

  // Inject GCL hitting stats if available (async)
  tryInjectGCLStats(container, teamName, 'hitting');

  // Team summary card first
  const summary = buildTeamHittersSummaryCard(teamName, hitters);
  if (summary) container.appendChild(summary);

  // Individual cards
  names.forEach(n => {
    const h = hitters[n];
    const profile = computeHitterProfile(h.pitches, n, h.hand);
    const card = buildHitterQuickLookCard(profile, h.pitches);
    if (card) container.appendChild(card);
  });
  return container;
}

function tryQuickLook(question) {
  const q = question.toLowerCase();
  const oppPM = findBestMatch(q, Object.keys(stats.opponentPitchers));
  const moePM = findBestMatch(q, stats.moellerPitcherList);
  const moeHM = findBestMatch(q, stats.moellerHitterList);
  const oppBM = findBestMatch(q, Object.keys(stats.opponentBatters));
  const teamM = findBestMatch(q, stats.teamList);
  // Cross-role disambiguation: Moeller hitter "Adam Maybury" vs opponent pitcher "Adam Zinser"
  const bestMoeScoreQL = Math.max(moePM.score, moeHM.score);
  const bestOppScoreQL = Math.max(oppPM.score, oppBM.score);
  let oppP, oppB, moeP, moeH;
  if (bestMoeScoreQL >= bestOppScoreQL && bestMoeScoreQL > 0) {
    oppP = null; oppB = null;
    moeP = moePM.score >= moeHM.score ? moePM.name : null;
    moeH = moeHM.score >= moePM.score ? moeHM.name : null;
  } else if (bestOppScoreQL > 0) {
    oppP = oppPM.score >= oppBM.score ? oppPM.name : null;
    oppB = oppBM.score > oppPM.score ? oppBM.name : null;
    moeP = (moePM.score > oppPM.score) ? moePM.name : null;
    moeH = (moeHM.score > oppBM.score) ? moeHM.name : null;
  } else {
    oppP = oppPM.name; oppB = oppBM.name; moeP = moePM.name; moeH = moeHM.name;
  }
  const team = teamM.name;

  // Hitter lookups
  if (q.includes('hitter') || q.includes('batter') || q.includes('lineup') || q.includes('hitting')) {
    if (moeH) {
      const h = stats.moellerHitters[moeH];
      return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, moeH, h.hand), h.pitches), hitterName: moeH, pitcherName: null};
    }
    if (oppB) {
      const h = stats.opponentBatters[oppB];
      return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, oppB, h.hand), h.pitches), hitterName: oppB, pitcherName: null};
    }
    if (team) return {card: buildTeamHittersQuickLook(team), hitterName: null, pitcherName: null};
    if (q.includes('moeller') || q.includes('our')) return {card: buildTeamHittersQuickLook('Moeller'), hitterName: null, pitcherName: null};
  }

  // Pitcher lookups — check before hitters so pitcher/hitter dual players show pitcher card
  if (oppP) {
    const p = stats.opponentPitchers[oppP];
    return {card: buildQuickLookCard(computePitcherProfile(p.pitches, oppP, p.hand, p.team), p.pitches), hitterName: null, pitcherName: oppP};
  }
  if (moeP) {
    const p = stats.moellerPitchers[moeP];
    return {card: buildQuickLookCard(computePitcherProfile(p.pitches, moeP, p.hand, 'Moeller'), p.pitches), hitterName: null, pitcherName: moeP};
  }

  // Individual hitter by name
  if (moeH) {
    const h = stats.moellerHitters[moeH];
    return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, moeH, h.hand), h.pitches), hitterName: moeH, pitcherName: null};
  }
  if (oppB) {
    const h = stats.opponentBatters[oppB];
    return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, oppB, h.hand), h.pitches), hitterName: oppB, pitcherName: null};
  }
  if (team) return {card: buildTeamQuickLook(team), hitterName: null, pitcherName: null};
  return null;
}

// ===== TENDENCY CARD BUILDERS =====
function compareBadge(val, dsAvg, higherLabel, lowerLabel) {
  if (!dsAvg || dsAvg === 0) return '';
  const diff = val - dsAvg;
  if (Math.abs(diff) < 2) return `<span class="ql-compare-badge avg">~avg</span>`;
  if (diff > 0) return `<span class="ql-compare-badge above">${higherLabel || 'above avg'}</span>`;
  return `<span class="ql-compare-badge below">${lowerLabel || 'below avg'}</span>`;
}

function buildBuntTendencyCard(data) {
  if (!data) return buildNoDataCard('Bunt & Sacrifice');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Bunt & Sacrifice</span>
    <span class="quick-look-meta">${data.totalPA} PA | ${data.totalPitches} pitches</span>`;
  card.appendChild(header);

  // Relay bullets
  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  if (data.sacCount === 0) {
    list.innerHTML += `<li>No sacrifices recorded in ${data.totalPA} plate appearances</li>`;
  } else {
    list.innerHTML += `<li>Sacrifice rate: <strong>${data.sacRate.toFixed(1)}%</strong> (${data.sacCount}/${data.totalPA} PA) ${compareBadge(data.sacRate, data.dsAvg, 'above avg', 'below avg')}</li>`;
    if (data.byBatter.length > 0) {
      list.innerHTML += `<li>Top bunter: <strong>${data.byBatter[0][0]}</strong> with <strong>${data.byBatter[0][1]}</strong> sacrifice${data.byBatter[0][1] > 1 ? 's' : ''}</li>`;
    }
    const prefSit = Object.entries(data.byOuts).sort((a, b) => b[1] - a[1]);
    if (prefSit[0] && prefSit[0][1] > 0) {
      list.innerHTML += `<li>Preferred situation: <strong>${prefSit[0][0]} out${prefSit[0][0] !== '1' ? 's' : ''}</strong> (${prefSit[0][1]} of ${data.sacCount})</li>`;
    }
    const prefInning = Object.entries(data.byInning).sort((a, b) => b[1] - a[1]);
    if (prefInning[0]) {
      list.innerHTML += `<li>Most bunts in <strong>${prefInning[0][0]}</strong> innings (${prefInning[0][1]})</li>`;
    }
  }

  relay.appendChild(list);
  card.appendChild(relay);

  // Stat row
  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.sacRate.toFixed(1) + '%', lbl: 'Sac Rate' },
    { val: String(data.sacCount), lbl: 'Total' },
    { val: data.byBatter.length > 0 ? data.byBatter[0][0].split(' ').pop() : '-', lbl: 'Top Player' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Batter table
  if (data.byBatter.length > 0) {
    const table = document.createElement('div');
    table.className = 'tendency-batter-table ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Batter</span><span>Sac</span></div>';
    data.byBatter.forEach(([name, cnt]) => {
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name">${name}</span><span class="ql-pitch-val">${cnt}</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  // Takeaway
  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.sacCount === 0) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This team does not sacrifice bunt. Expect them to swing away in bunt situations — play accordingly on defense.</div>`;
  } else {
    const topBunter = data.byBatter.length > 0 ? data.byBatter[0][0] : 'their batters';
    takeaway.innerHTML += `<div class="ql-takeaway-text">Watch for <strong>${topBunter}</strong> in bunt situations. They bunt most with ${Object.entries(data.byOuts).sort((a, b) => b[1] - a[1])[0]?.[0] || '0'} out(s). Crash corners when you see it coming.</div>`;
  }
  card.appendChild(takeaway);

  if (data.totalPitches < 50) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.totalPitches} pitches for this team.`;
    card.appendChild(warn);
  }
  return card;
}

function buildFirstPitchApproachCard(data) {
  if (!data) return buildNoDataCard('First-Pitch Approach');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — First-Pitch Approach</span>
    <span class="quick-look-meta">${data.fpTotal} first pitches</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>First-pitch swing rate: <strong>${data.swingRate.toFixed(1)}%</strong> ${compareBadge(data.swingRate, data.dsAvg, 'aggressive', 'patient')}</li>`;
  if (data.byBatter.length > 0) {
    list.innerHTML += `<li>Most aggressive: <strong>${data.byBatter[0].name}</strong> — swings <strong>${data.byBatter[0].rate.toFixed(0)}%</strong> of first pitches</li>`;
  }
  if (data.byBatter.length > 1) {
    const patient = data.byBatter[data.byBatter.length - 1];
    list.innerHTML += `<li>Most patient: <strong>${patient.name}</strong> — swings <strong>${patient.rate.toFixed(0)}%</strong></li>`;
  }
  list.innerHTML += `<li>When putting first pitch in play: <strong>${data.hitRate.toFixed(0)}%</strong> hit rate on <strong>${data.fpAB}</strong> AB</li>`;

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.swingRate.toFixed(1) + '%', lbl: 'Swing%' },
    { val: data.hitRate.toFixed(0) + '%', lbl: 'Hit%' },
    { val: data.inPlayRate.toFixed(1) + '%', lbl: 'InPlay%' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Batter table
  if (data.byBatter.length > 0) {
    const table = document.createElement('div');
    table.className = 'tendency-batter-table ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Batter</span><span>1st Pitches</span><span>Swing%</span></div>';
    data.byBatter.forEach(b => {
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name">${b.name}</span><span class="ql-pitch-val">${b.total}</span><span class="ql-pitch-val">${b.rate.toFixed(0)}%</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.swingRate > 35) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Aggressive lineup — they swing early. Get ahead with a first-pitch strike and don't give them anything easy to hit. Throw off-speed first pitch to disrupt timing.</div>`;
  } else if (data.swingRate < 20) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Patient lineup — they take first pitches. Attack the zone early with fastballs for easy strike one. Free strikes available.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Average first-pitch approach. Mix your first-pitch selection to keep them guessing.</div>`;
  }
  card.appendChild(takeaway);

  if (data.fpTotal < 30) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.fpTotal} first pitches.`;
    card.appendChild(warn);
  }
  return card;
}

function buildChaseAndDisciplineCard(data) {
  if (!data) return buildNoDataCard('Chase & Discipline');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Chase & Discipline</span>
    <span class="quick-look-meta">${data.chasePitches} chase-zone pitches</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>Team chase rate: <strong>${data.chaseRate.toFixed(1)}%</strong> ${compareBadge(data.chaseRate, data.dsAvg, 'chases more', 'disciplined')}</li>`;
  if (data.byBatter.length > 0) {
    list.innerHTML += `<li>Worst chaser: <strong>${data.byBatter[0].name}</strong> — chases <strong>${data.byBatter[0].rate.toFixed(0)}%</strong></li>`;
  }
  if (data.byBatter.length > 1) {
    const best = data.byBatter[data.byBatter.length - 1];
    list.innerHTML += `<li>Best discipline: <strong>${best.name}</strong> — only <strong>${best.rate.toFixed(0)}%</strong> chase rate</li>`;
  }
  if (data.byCount.length > 0) {
    const worstCount = data.byCount[0];
    list.innerHTML += `<li>Chase most at <strong>${worstCount.count}</strong> count (${worstCount.rate.toFixed(0)}% on ${worstCount.total} pitches)</li>`;
  }

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.chaseRate.toFixed(1) + '%', lbl: 'Chase%' },
    { val: data.byBatter.length > 0 ? data.byBatter[0].name.split(' ').pop() : '-', lbl: 'Worst' },
    { val: data.byBatter.length > 1 ? data.byBatter[data.byBatter.length - 1].name.split(' ').pop() : '-', lbl: 'Best' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Batter table
  if (data.byBatter.length > 0) {
    const table = document.createElement('div');
    table.className = 'tendency-batter-table ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Batter</span><span>Chase Pitches</span><span>Chase%</span></div>';
    data.byBatter.forEach(b => {
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name">${b.name}</span><span class="ql-pitch-val">${b.total}</span><span class="ql-pitch-val">${b.rate.toFixed(0)}%</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.chaseRate > 30) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This lineup chases — expand the zone early and often. Use off-speed out of the zone to generate weak contact and whiffs. ${data.byBatter.length > 0 ? `Target <strong>${data.byBatter[0].name}</strong> especially.` : ''}</div>`;
  } else if (data.chaseRate < 20) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Disciplined lineup — stay in the zone and attack. Wasting pitches off the plate will just put you behind in counts.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Average chase discipline. Mix in chase pitches selectively, especially with 2 strikes.</div>`;
  }
  card.appendChild(takeaway);

  if (data.chasePitches < 20) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.chasePitches} chase-zone pitches.`;
    card.appendChild(warn);
  }
  return card;
}

function buildTwoStrikeApproachCard(data) {
  if (!data) return buildNoDataCard('Two-Strike Approach');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Two-Strike Approach</span>
    <span class="quick-look-meta">${data.tsTotal} pitches with 2 strikes | ${data.tsPA} PA</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>Strikeout rate with 2 strikes: <strong>${data.kRate.toFixed(1)}%</strong> ${compareBadge(data.kRate, data.dsAvg, 'high K', 'low K')}</li>`;
  list.innerHTML += `<li>Foul ball rate: <strong>${data.foulRate.toFixed(1)}%</strong> — ${data.foulRate > 25 ? 'they fight off pitches' : 'not many fouls'}</li>`;
  list.innerHTML += `<li>Whiff rate on swings: <strong>${data.whiffRate.toFixed(1)}%</strong></li>`;
  list.innerHTML += `<li>Chase rate with 2 strikes: <strong>${data.tsChaseRate.toFixed(1)}%</strong></li>`;

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.kRate.toFixed(1) + '%', lbl: 'K%' },
    { val: data.foulRate.toFixed(1) + '%', lbl: 'Foul%' },
    { val: data.whiffRate.toFixed(1) + '%', lbl: 'Whiff%' },
    { val: data.tsChaseRate.toFixed(1) + '%', lbl: 'Chase%' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Batter K-rate table
  if (data.byBatter.length > 0) {
    const table = document.createElement('div');
    table.className = 'tendency-batter-table ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Batter</span><span>2K PA</span><span>Ks</span><span>K%</span></div>';
    data.byBatter.forEach(b => {
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name">${b.name}</span><span class="ql-pitch-val">${b.pa}</span><span class="ql-pitch-val">${b.ks}</span><span class="ql-pitch-val">${b.kRate.toFixed(0)}%</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.kRate > 40) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This team is vulnerable with 2 strikes — high K rate and whiff rate. Expand the zone with breaking balls and be aggressive with the put-away pitch.</div>`;
  } else if (data.kRate < 25) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Tough to put away — they battle with 2 strikes. Need quality stuff in the zone. Don't hang breaking balls.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Average two-strike approach. Mix locations and keep the ball out of the heart of the zone with 2 strikes.</div>`;
  }
  card.appendChild(takeaway);

  if (data.tsPA < 10) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.tsPA} two-strike plate appearances.`;
    card.appendChild(warn);
  }
  return card;
}

function buildPitchMixTendencyCard(data) {
  if (!data) return buildNoDataCard('Pitch Mix & Sequencing');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Pitch Mix & Sequencing</span>
    <span class="quick-look-meta">${data.total} pitches thrown</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>Pitch group split: <strong>FB ${data.fbPct.toFixed(0)}%</strong> / <strong>BRK ${data.brkPct.toFixed(0)}%</strong> / <strong>OS ${data.osPct.toFixed(0)}%</strong></li>`;

  // First pitch preference
  const fpMix = data.byCount.first_pitch;
  const fpTotal = Object.values(fpMix).reduce((a, b) => a + b, 0);
  if (fpTotal > 0) {
    const fpTop = Object.entries(fpMix).sort((a, b) => b[1] - a[1])[0];
    list.innerHTML += `<li>First pitch: <strong>${fpTop[0]}</strong> (${(fpTop[1] / fpTotal * 100).toFixed(0)}%)</li>`;
  }

  if (data.putAwayPitch) {
    const tsMix = data.byCount.two_strikes;
    const tsTotal = Object.values(tsMix).reduce((a, b) => a + b, 0);
    list.innerHTML += `<li>Put-away pitch: <strong>${data.putAwayPitch}</strong> (${tsTotal > 0 ? (tsMix[data.putAwayPitch] / tsTotal * 100).toFixed(0) : '?'}% with 2 strikes)</li>`;
  }

  // RHH vs LHH mix difference
  const rTotal = Object.values(data.byBatterHand.R).reduce((a, b) => a + b, 0);
  const lTotal = Object.values(data.byBatterHand.L).reduce((a, b) => a + b, 0);
  if (rTotal > 10 && lTotal > 10) {
    const rTop = Object.entries(data.byBatterHand.R).sort((a, b) => b[1] - a[1])[0];
    const lTop = Object.entries(data.byBatterHand.L).sort((a, b) => b[1] - a[1])[0];
    list.innerHTML += `<li>vs RHH: mostly <strong>${rTop[0]}</strong> (${(rTop[1] / rTotal * 100).toFixed(0)}%) | vs LHH: mostly <strong>${lTop[0]}</strong> (${(lTop[1] / lTotal * 100).toFixed(0)}%)</li>`;
  }

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.fbPct.toFixed(0) + '%', lbl: 'FB%' },
    { val: data.brkPct.toFixed(0) + '%', lbl: 'BRK%' },
    { val: data.osPct.toFixed(0) + '%', lbl: 'OS%' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Overall mix table
  if (data.overallMix.length > 0) {
    const table = document.createElement('div');
    table.className = 'ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Pitch</span><span>Count</span><span>Usage</span></div>';
    data.overallMix.forEach(m => {
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[m.pitch] || '#95A5A6'}"></span>${m.pitch}</span><span class="ql-pitch-val">${m.count}</span><span class="ql-pitch-val">${m.pct.toFixed(1)}%</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  // By-count table
  const countKeys = ['first_pitch', 'ahead', 'even', 'behind', 'two_strikes'];
  const countLabels = { first_pitch: '1st Pitch', ahead: 'Ahead', even: 'Even', behind: 'Behind', two_strikes: '2 Strikes' };
  const allPitches = data.overallMix.map(m => m.pitch);
  if (allPitches.length > 0) {
    const ctTable = document.createElement('div');
    ctTable.className = 'ql-pitch-table';
    let ctHTML = '<div class="ql-count-header"><span>Count</span>';
    allPitches.forEach(pt => { ctHTML += `<span><span class="ql-pitch-dot" style="background:${PITCH_COLORS[pt] || '#95A5A6'}"></span>${pt}</span>`; });
    ctHTML += '</div>';
    countKeys.forEach(k => {
      const cm = data.byCount[k];
      const ct = Object.values(cm).reduce((a, b) => a + b, 0);
      if (ct === 0) return;
      ctHTML += `<div class="ql-count-row"><span class="ql-count-label">${countLabels[k]}</span>`;
      allPitches.forEach(pt => {
        const val = cm[pt] ? (cm[pt] / ct * 100).toFixed(0) + '%' : '-';
        ctHTML += `<span class="ql-pitch-val">${val}</span>`;
      });
      ctHTML += '</div>';
    });
    ctTable.innerHTML = ctHTML;
    card.appendChild(ctTable);
  }

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.fbPct > 65) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Fastball-heavy staff — sit fastball early, adjust to off-speed. Time the heater and make them beat you with secondary stuff.</div>`;
  } else if (data.brkPct > 35) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Breaking-ball heavy staff — be patient and recognize spin early. Don't chase breaking balls out of the zone.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Balanced pitch mix. Read the pitcher's hand and stay disciplined. Look for patterns by count.</div>`;
  }
  card.appendChild(takeaway);

  if (data.total < 50) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.total} pitches.`;
    card.appendChild(warn);
  }
  return card;
}

function buildZoneUsageTendencyCard(data) {
  if (!data) return buildNoDataCard('Zone Usage');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Zone Usage</span>
    <span class="quick-look-meta">${data.total} pitches with zone data</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>Zone rate (Heart+Shadow): <strong>${data.zoneRate.toFixed(1)}%</strong> ${compareBadge(data.zoneRate, data.dsAvg, 'in zone', 'off plate')}</li>`;
  list.innerHTML += `<li>Heart%: <strong>${data.heartPct.toFixed(1)}%</strong> | Shadow%: <strong>${data.shadowPct.toFixed(1)}%</strong> | Chase%: <strong>${data.chasePct.toFixed(1)}%</strong></li>`;

  // Check first pitch zone
  const fpZones = data.byCount.first_pitch;
  const fpTotal = fpZones.Heart + fpZones.Shadow + fpZones.Chase + fpZones.Waste;
  if (fpTotal > 0) {
    const fpZone = ((fpZones.Heart + fpZones.Shadow) / fpTotal * 100).toFixed(0);
    list.innerHTML += `<li>First-pitch zone rate: <strong>${fpZone}%</strong></li>`;
  }

  // Count shifts
  const aheadZones = data.byCount.ahead;
  const behindZones = data.byCount.behind;
  const aTotal = aheadZones.Heart + aheadZones.Shadow + aheadZones.Chase + aheadZones.Waste;
  const bTotal = behindZones.Heart + behindZones.Shadow + behindZones.Chase + behindZones.Waste;
  if (aTotal > 5 && bTotal > 5) {
    const aZone = ((aheadZones.Heart + aheadZones.Shadow) / aTotal * 100).toFixed(0);
    const bZone = ((behindZones.Heart + behindZones.Shadow) / bTotal * 100).toFixed(0);
    list.innerHTML += `<li>Ahead: <strong>${aZone}%</strong> zone | Behind: <strong>${bZone}%</strong> zone — ${parseInt(bZone) > parseInt(aZone) + 5 ? 'comes back to zone when behind' : 'expands when ahead'}</li>`;
  }

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.zoneRate.toFixed(1) + '%', lbl: 'Zone%' },
    { val: data.heartPct.toFixed(1) + '%', lbl: 'Heart%' },
    { val: data.shadowPct.toFixed(1) + '%', lbl: 'Shadow%' },
    { val: data.chasePct.toFixed(1) + '%', lbl: 'Chase%' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Zone by count table
  const countKeys = ['first_pitch', 'ahead', 'even', 'behind', 'two_strikes'];
  const countLabels = { first_pitch: '1st Pitch', ahead: 'Ahead', even: 'Even', behind: 'Behind', two_strikes: '2 Strikes' };
  const zoneKeys = ['Heart', 'Shadow', 'Chase', 'Waste'];
  const zcTable = document.createElement('div');
  zcTable.className = 'ql-pitch-table';
  let zcHTML = '<div class="ql-count-header"><span>Count</span>';
  zoneKeys.forEach(z => { zcHTML += `<span style="color:${ZONE_COLORS[z] || '#95A5A6'}">${z}</span>`; });
  zcHTML += '</div>';
  countKeys.forEach(k => {
    const zd = data.byCount[k];
    const zt = zd.Heart + zd.Shadow + zd.Chase + zd.Waste;
    if (zt === 0) return;
    zcHTML += `<div class="ql-count-row"><span class="ql-count-label">${countLabels[k]}</span>`;
    zoneKeys.forEach(z => {
      zcHTML += `<span class="ql-pitch-val">${(zd[z] / zt * 100).toFixed(0)}%</span>`;
    });
    zcHTML += '</div>';
  });
  zcTable.innerHTML = zcHTML;
  card.appendChild(zcTable);

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  if (data.zoneRate > 55) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This pitching staff lives in the zone — be aggressive early in counts. Hitters should be ready to swing at hittable pitches and not fall behind.</div>`;
  } else if (data.zoneRate < 40) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This staff works off the plate — be patient! Take pitches and work counts. The free base path to walks is open.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Average zone usage. Look for count-based patterns — they may expand differently when ahead vs behind.</div>`;
  }
  card.appendChild(takeaway);

  if (data.total < 50) {
    const warn = document.createElement('div');
    warn.className = 'matchup-warning';
    warn.textContent = `Small sample: only ${data.total} pitches with zone data.`;
    card.appendChild(warn);
  }
  return card;
}

function buildSituationalTendencyCard(data) {
  if (!data) return buildNoDataCard('Situational / Game-State');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Situational</span>
    <span class="quick-look-meta">${data.twoOutPA} two-out PA</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  list.innerHTML += `<li>Early (1-3): <strong>${data.earlyAVG.toFixed(3)}</strong> AVG | Mid (4-6): <strong>${data.midAVG.toFixed(3)}</strong> | Late (7+): <strong>${data.lateAVG.toFixed(3)}</strong></li>`;

  const best = [{ label: 'Early', avg: data.earlyAVG }, { label: 'Mid', avg: data.midAVG }, { label: 'Late', avg: data.lateAVG }]
    .filter(g => g.avg > 0).sort((a, b) => b.avg - a.avg);
  if (best.length > 0) {
    list.innerHTML += `<li>Best inning group: <strong>${best[0].label}</strong> innings (${best[0].avg.toFixed(3)})</li>`;
  }

  list.innerHTML += `<li>Two-out performance: <strong>${data.twoOutAVG.toFixed(3)}</strong> AVG (${data.twoOutHits}/${data.twoOutAB})</li>`;

  if (data.twoOutAVG > 0.300) {
    list.innerHTML += `<li>Dangerous with 2 outs — don't let up on the mound</li>`;
  } else if (data.twoOutAVG < 0.180) {
    list.innerHTML += `<li>Struggles with 2 outs — get two outs and bear down to finish innings</li>`;
  }

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.earlyAVG.toFixed(3), lbl: 'Early' },
    { val: data.midAVG.toFixed(3), lbl: 'Mid' },
    { val: data.lateAVG.toFixed(3), lbl: 'Late' },
    { val: data.twoOutAVG.toFixed(3), lbl: '2-Out AVG' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Inning group table
  const igTable = document.createElement('div');
  igTable.className = 'ql-pitch-table';
  let igHTML = '<div class="ql-pitch-header"><span>Group</span><span>PA</span><span>H</span><span>AB</span><span>AVG</span></div>';
  Object.entries(data.inningGroups).forEach(([group, d]) => {
    igHTML += `<div class="ql-pitch-row"><span class="ql-pitch-name">${group}</span><span class="ql-pitch-val">${d.pa}</span><span class="ql-pitch-val">${d.hits}</span><span class="ql-pitch-val">${d.abs}</span><span class="ql-pitch-val">${d.abs > 0 ? (d.hits / d.abs).toFixed(3) : '-'}</span></div>`;
  });
  igHTML += `<div class="ql-pitch-row" style="border-top:2px solid var(--border-strong)"><span class="ql-pitch-name" style="font-weight:800">2-Out</span><span class="ql-pitch-val">${data.twoOutPA}</span><span class="ql-pitch-val">${data.twoOutHits}</span><span class="ql-pitch-val">${data.twoOutAB}</span><span class="ql-pitch-val">${data.twoOutAVG.toFixed(3)}</span></div>`;
  igTable.innerHTML = igHTML;
  card.appendChild(igTable);

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  const earlyLate = data.earlyAVG > data.lateAVG + 0.04 ? 'better early — consider front-loading your best arms' :
    data.lateAVG > data.earlyAVG + 0.04 ? 'better late — save your closer for tight situations' : 'consistent across innings';
  takeaway.innerHTML += `<div class="ql-takeaway-text">This team hits ${earlyLate}. Two-out AVG is <strong>${data.twoOutAVG.toFixed(3)}</strong> — ${data.twoOutAVG > 0.250 ? "don't relax with 2 outs" : "finish the inning strong"}.</div>`;
  card.appendChild(takeaway);

  return card;
}

function buildPlatoonTendencyCard(data) {
  if (!data) return buildNoDataCard('Platoon Tendencies');
  const card = document.createElement('div');
  card.className = 'quick-look-card';

  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${data.teamName} — Platoon Tendencies</span>
    <span class="quick-look-meta">Offense + Pitching splits</span>`;
  card.appendChild(header);

  const relay = document.createElement('div');
  relay.className = 'ql-relay-section';
  relay.innerHTML = '<div class="ql-relay-title">KEY FINDINGS</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  if (data.hasOffense) {
    list.innerHTML += `<li>Offense vs RHP: <strong>${data.offenseVsRHP.avg}</strong> AVG (${data.offenseVsRHP.abs} AB) | vs LHP: <strong>${data.offenseVsLHP.avg}</strong> AVG (${data.offenseVsLHP.abs} AB)</li>`;
    const rAvg = parseFloat(data.offenseVsRHP.avg) || 0;
    const lAvg = parseFloat(data.offenseVsLHP.avg) || 0;
    if (rAvg > lAvg + 0.04) list.innerHTML += `<li>Better against <strong>RHP</strong> — consider starting your lefty</li>`;
    else if (lAvg > rAvg + 0.04) list.innerHTML += `<li>Better against <strong>LHP</strong> — go with right-handed pitching</li>`;
  }

  if (data.hasPitching) {
    list.innerHTML += `<li>Pitching vs RHH: <strong>${data.pitchingVsRHH.avg}</strong> AVG allowed | vs LHH: <strong>${data.pitchingVsLHH.avg}</strong> AVG allowed</li>`;
  }

  if (data.batterSplits.length > 0) {
    const biggest = data.batterSplits[0];
    const favor = biggest.rAvg > biggest.lAvg ? 'vs RHP' : 'vs LHP';
    list.innerHTML += `<li>Biggest platoon split: <strong>${biggest.name}</strong> — ${favor} (.${(Math.max(biggest.rAvg, biggest.lAvg) * 1000).toFixed(0).padStart(3, '0')} vs .${(Math.min(biggest.rAvg, biggest.lAvg) * 1000).toFixed(0).padStart(3, '0')})</li>`;
  }

  relay.appendChild(list);
  card.appendChild(relay);

  const statRow = document.createElement('div');
  statRow.className = 'quick-look-row';
  [
    { val: data.offenseVsRHP.avg, lbl: 'vs RHP AVG' },
    { val: data.offenseVsLHP.avg, lbl: 'vs LHP AVG' },
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'quick-look-stat';
    el.innerHTML = `<div class="ql-val">${s.val}</div><div class="ql-lbl">${s.lbl}</div>`;
    statRow.appendChild(el);
  });
  card.appendChild(statRow);

  // Batter splits table
  if (data.batterSplits.length > 0) {
    const table = document.createElement('div');
    table.className = 'tendency-batter-table ql-pitch-table';
    let html = '<div class="ql-pitch-header"><span>Batter</span><span>vs RHP</span><span>vs LHP</span><span>Split</span></div>';
    data.batterSplits.slice(0, 15).forEach(b => {
      const rA = b.vsR.abs > 0 ? (b.vsR.hits / b.vsR.abs).toFixed(3) : '-';
      const lA = b.vsL.abs > 0 ? (b.vsL.hits / b.vsL.abs).toFixed(3) : '-';
      html += `<div class="ql-pitch-row"><span class="ql-pitch-name">${b.name}</span><span class="ql-pitch-val">${rA}</span><span class="ql-pitch-val">${lA}</span><span class="ql-pitch-val">${(b.split * 1000).toFixed(0)} pts</span></div>`;
    });
    table.innerHTML = html;
    card.appendChild(table);
  }

  const takeaway = document.createElement('div');
  takeaway.className = 'ql-takeaway-section';
  takeaway.innerHTML = `<div class="ql-takeaway-title">COACHING TAKEAWAY</div>`;
  const rOff = parseFloat(data.offenseVsRHP.avg) || 0;
  const lOff = parseFloat(data.offenseVsLHP.avg) || 0;
  if (rOff > lOff + 0.04) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This team hits righties better. Start a LHP if available. Their lineup has clear platoon advantages worth exploiting.</div>`;
  } else if (lOff > rOff + 0.04) {
    takeaway.innerHTML += `<div class="ql-takeaway-text">This team hits lefties better. Go with RHP as your starter. Stack your lineup against their pitching handedness accordingly.</div>`;
  } else {
    takeaway.innerHTML += `<div class="ql-takeaway-text">Balanced platoon splits. Look at individual batter matchups for handedness edges rather than team-level splits.</div>`;
  }
  card.appendChild(takeaway);

  return card;
}

function buildNoDataCard(title) {
  const card = document.createElement('div');
  card.className = 'quick-look-card';
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  header.innerHTML = `<span class="quick-look-name">${title}</span>`;
  card.appendChild(header);
  const msg = document.createElement('div');
  msg.className = 'matchup-warning';
  msg.textContent = 'No data available for this team/category combination.';
  card.appendChild(msg);
  return card;
}

function buildTendencyCard(category, data) {
  switch (category) {
    case 'bunt_sacrifice': return buildBuntTendencyCard(data);
    case 'first_pitch_off': return buildFirstPitchApproachCard(data);
    case 'chase_discipline': return buildChaseAndDisciplineCard(data);
    case 'two_strike_off': return buildTwoStrikeApproachCard(data);
    case 'pitch_mix_seq': return buildPitchMixTendencyCard(data);
    case 'zone_usage': return buildZoneUsageTendencyCard(data);
    case 'situational': return buildSituationalTendencyCard(data);
    case 'platoon': return buildPlatoonTendencyCard(data);
    default: return buildNoDataCard(category);
  }
}

function showTendencyCategoryPicker() {
  document.getElementById('menu-step2').classList.add('hidden');
  document.getElementById('menu-tendency-cats').classList.remove('hidden');
  document.getElementById('welcome-title').textContent = `${tendencyState.team} Tendencies`;
  document.getElementById('welcome-subtitle').textContent = 'Choose a category to analyze';

  const grid = document.getElementById('tendency-cats-grid');
  grid.innerHTML = '';
  TENDENCY_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'tendency-cat-card';
    btn.innerHTML = `<div class="menu-card-title">${cat.title}</div><div class="menu-card-desc">${cat.desc}</div>`;
    btn.addEventListener('click', () => {
      tendencyState.category = cat.key;
      tendencyState.step = 3;
      executeTendencyReport();
    });
    grid.appendChild(btn);
  });
}

function executeTendencyReport() {
  const data = computeTendencyData(tendencyState.category, tendencyState.team);
  const catInfo = TENDENCY_CATEGORIES.find(c => c.key === tendencyState.category);
  const catTitle = catInfo ? catInfo.title : tendencyState.category;

  if (appMode === 'dugout') {
    // Render card directly (zero tokens)
    welcomeEl.classList.add('hidden');
    document.getElementById('menu-tendency-cats').classList.add('hidden');
    appendMessage('user', `Coaching Tendencies — ${tendencyState.team} — ${catTitle}`);
    const card = buildTendencyCard(tendencyState.category, data);
    appendQuickLook(card);
  } else {
    // Full mode — send to API
    welcomeEl.classList.add('hidden');
    document.getElementById('menu-tendency-cats').classList.add('hidden');
    const query = `Analyze ${tendencyState.team}'s ${catTitle} tendencies. Provide coaching insights and compare to dataset averages.`;
    const ctx = {
      type: 'coaching_tendency',
      data: {
        category: tendencyState.category,
        categoryTitle: catTitle,
        teamName: tendencyState.team,
        tendencyData: data,
        datasetAverages: stats.datasetAverages || {},
      }
    };
    const dataPayload = JSON.stringify(ctx.data, null, 2);
    const fullMessage = `Here is the relevant data (context type: coaching_tendency, category: ${catTitle}). Coach's question: "${query}"\n\n${dataPayload}`;

    appendMessage('user', `Coaching Tendencies — ${tendencyState.team} — ${catTitle}`);
    isLoading = true;
    sendBtn.disabled = true;
    const loadingEl = showLoading();

    fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage, session_id: sessionId, mode: appMode }),
    })
      .then(res => res.json().then(d => ({ ok: res.ok, data: d })))
      .then(({ ok, data: d }) => {
        removeLoading(loadingEl);
        if (!ok) throw new Error(d.error || 'Server error');
        appendMessage('assistant', d.reply);
      })
      .catch(err => {
        removeLoading(loadingEl);
        showError(err.message);
      })
      .finally(() => {
        isLoading = false;
        sendBtn.disabled = false;
        userInput.focus();
      });
  }
}

// ===== SEND MESSAGE =====
async function sendMessage() {
  const text=userInput.value.trim();
  if (!text||isLoading) return;
  hideAC();
  welcomeEl.classList.add('hidden');
  appendMessage('user',text);
  userInput.value=''; userInput.style.height='auto';

  // In dugout mode, show Quick Look card and skip API call (zero tokens)
  if (appMode === 'dugout') {
    const quickLook = tryQuickLook(text);
    if (quickLook) {
      appendQuickLook(quickLook.card, quickLook.hitterName, quickLook.pitcherName);
      userInput.focus();
      return; // No API call — card has all the data
    }
  }

  isLoading=true; sendBtn.disabled=true;
  const loadingEl=showLoading();

  try {
    const context=routeQuestion(text);
    let dataPayload=JSON.stringify(context.data,null,2);

    // Trim payload if it's too large for the API (keep under ~40K chars ≈ ~10K tokens)
    const MAX_PAYLOAD = 40000;
    if (dataPayload.length > MAX_PAYLOAD) {
      // Strip detailed per-count and per-pitch arrays to reduce size
      const trimmed = JSON.parse(JSON.stringify(context.data));
      const stripDetail = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
          if (['pitchMixByCount','countTendencies','byCount','pitches','allPitches'].includes(key)) {
            delete obj[key];
          } else if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            stripDetail(obj[key]);
          }
        }
      };
      stripDetail(trimmed);
      dataPayload = JSON.stringify(trimmed, null, 2);
      console.log(`Payload trimmed: ${dataPayload.length} chars (was over ${MAX_PAYLOAD})`);
    }

    const fullMessage=`Here is the relevant data (context type: ${context.type}). Coach's question: "${text}"\n\n${dataPayload}`;

    // Generate charts only in full mode
    let charts = [];
    if (appMode === 'full') {
      try { charts = generateCharts(text, context.type, context.data); } catch(chartErr) { console.warn('Chart generation error:', chartErr); }
    }

    const res=await fetch('/api/chat',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:fullMessage,session_id:sessionId,mode:appMode}),
    });
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); } catch(parseErr) {
      console.error('Response not JSON:', rawText.substring(0, 500));
      throw new Error('Server returned invalid response. Try again or use Dugout mode.');
    }
    if (!res.ok) throw new Error(data.error||`Server error (${res.status})`);
    removeLoading(loadingEl);
    appendMessage('assistant', data.reply, charts);
  } catch(err) {
    removeLoading(loadingEl);
    console.error('sendMessage error:', err);
    showError(err.message);
  } finally {
    isLoading=true; sendBtn.disabled=false; userInput.focus();
    isLoading=false;
  }
}

// ===== UI =====
function appendMessage(role, text, charts) {
  const msg=document.createElement('div');
  msg.className=`message ${role}`;
  const label=document.createElement('div');
  label.className='msg-label';
  label.textContent=role==='user'?'You':'Scout';
  const bubble=document.createElement('div');
  bubble.className='msg-bubble';

  if (role==='assistant') {
    bubble.innerHTML=injectGCLLinks(renderMarkdown(text));
    // Actions
    const actions=document.createElement('div');
    actions.className='msg-actions';
    const copyBtn=document.createElement('button');
    copyBtn.className='action-btn';
    copyBtn.textContent='Copy';
    copyBtn.onclick=()=>{
      navigator.clipboard.writeText(text).then(()=>{
        copyBtn.textContent='Copied!'; copyBtn.classList.add('copied');
        setTimeout(()=>{copyBtn.textContent='Copy';copyBtn.classList.remove('copied');},2000);
      });
    };
    actions.appendChild(copyBtn);
    bubble.appendChild(actions);

    // Charts
    if (charts && charts.length > 0) {
      const chartSection = buildChartSection(charts);
      if (chartSection) bubble.appendChild(chartSection);
    }
    // New Analysis button
    bubble.appendChild(buildNewAnalysisBar());
  } else {
    bubble.textContent=text;
  }

  msg.appendChild(label);
  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  scrollToBottom();
}

function buildHowToPitchCard(hitterName) {
  const src = stats.moellerHitters[hitterName] || stats.opponentBatters[hitterName];
  if (!src) return null;
  const profile = computeHitterProfile(src.pitches, hitterName, src.hand);
  const dugout = computeHitterDugoutStats(src.pitches);

  const card = document.createElement('div');
  card.className = 'quick-look-card';

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  const hand = (profile.hand||'').toUpperCase();
  const handLabel = hand === 'R' ? 'RHH' : hand === 'L' ? 'LHH' : hand || '?';
  header.innerHTML = `<span class="quick-look-name">How to Pitch: ${profile.name}</span>
    <span class="quick-look-meta">${handLabel} | ${profile.totalPA} PA</span>`;
  card.appendChild(header);

  const notes = document.createElement('div');
  notes.className = 'ql-relay-section';
  notes.innerHTML = '<div class="ql-relay-title">PITCHING PLAN</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  const rbt = profile.resultsByPitchType || {};
  const zs = dugout.zoneStats;
  const zoneNames = {1:'up-in',2:'up-mid',3:'up-away',4:'mid-in',5:'middle',6:'mid-away',7:'low-in',8:'low-mid',9:'low-away'};

  // 1. What pitch to attack him with (highest whiff rate)
  const pitchByWhiff = Object.keys(rbt).filter(t => rbt[t].pitchesSeen >= 5 && rbt[t].whiffRate && rbt[t].whiffRate !== 'N/A')
    .sort((a,b) => parseFloat(rbt[b].whiffRate) - parseFloat(rbt[a].whiffRate));
  if (pitchByWhiff.length > 0) {
    const best = pitchByWhiff[0];
    list.innerHTML += `<li>Attack with <strong>${best}</strong> — <strong>${rbt[best].whiffRate} whiff rate</strong></li>`;
  }

  // 2. What pitch to avoid (lowest whiff / highest AVG against)
  const pitchByAVG = Object.keys(rbt).filter(t => rbt[t].pitchesSeen >= 5 && rbt[t].AVG !== 'N/A')
    .sort((a,b) => parseFloat(rbt[b].AVG) - parseFloat(rbt[a].AVG));
  if (pitchByAVG.length > 0) {
    const avoid = pitchByAVG[0];
    if (!pitchByWhiff.length || avoid !== pitchByWhiff[0]) {
      list.innerHTML += `<li>Avoid <strong>${avoid}</strong> — hits <strong>${rbt[avoid].AVG}</strong> against it</li>`;
    } else if (pitchByAVG.length > 1) {
      const next = pitchByAVG[1];
      list.innerHTML += `<li>Be careful with <strong>${next}</strong> — hits <strong>${rbt[next].AVG}</strong> against it</li>`;
    }
  }

  // 3. Cold zones — where to locate
  const coldZones = [], hotZones = [];
  for (let i = 1; i <= 9; i++) {
    if (zs[i].abs >= 3) {
      const avg = zs[i].hits / zs[i].abs;
      if (avg < .150) coldZones.push(zoneNames[i]);
      if (avg >= .300) hotZones.push(zoneNames[i]);
    }
  }
  if (coldZones.length > 0) {
    list.innerHTML += `<li>Locate to <strong>${coldZones.join(', ')}</strong> — cold zones</li>`;
  }
  if (hotZones.length > 0) {
    list.innerHTML += `<li>Stay away from <strong>${hotZones.join(', ')}</strong> — hot zones</li>`;
  }

  // 4. Chase rate — can you expand?
  const chaseNum = parseFloat(profile.overallChaseRate) || 0;
  if (chaseNum > 30) {
    list.innerHTML += `<li>Expand the zone — chases <strong>${profile.overallChaseRate}</strong> out of zone</li>`;
  } else if (chaseNum > 0 && chaseNum <= 15) {
    list.innerHTML += `<li>Don't waste pitches — only chases <strong>${profile.overallChaseRate}</strong>, stay in the zone</li>`;
  }

  // 5. Two-strike approach
  if (pitchByWhiff.length > 0) {
    const putaway = pitchByWhiff[0];
    list.innerHTML += `<li>Put-away pitch: <strong>${putaway}</strong> with 2 strikes</li>`;
  }

  // 6. Platoon edge
  const rAvg = parseFloat(dugout.vsRHP.AVG) || 0;
  const lAvg = parseFloat(dugout.vsLHP.AVG) || 0;
  if (rAvg > 0 && lAvg > 0) {
    if (rAvg > lAvg + 0.05) list.innerHTML += `<li>Weaker vs LHP (<strong>${dugout.vsLHP.AVG}</strong>) — get a lefty if possible</li>`;
    else if (lAvg > rAvg + 0.05) list.innerHTML += `<li>Weaker vs RHP (<strong>${dugout.vsRHP.AVG}</strong>) — get a righty if possible</li>`;
  }

  notes.appendChild(list);
  card.appendChild(notes);
  return card;
}

function buildHowToHitCard(pitcherName) {
  const src = stats.opponentPitchers[pitcherName] || stats.moellerPitchers[pitcherName];
  if (!src) return null;
  const profile = computePitcherProfile(src.pitches, pitcherName, src.hand, src.team || 'Moeller');

  const card = document.createElement('div');
  card.className = 'quick-look-card';

  // Header
  const header = document.createElement('div');
  header.className = 'quick-look-header';
  const hand = (profile.hand||'').toUpperCase();
  const handLabel = hand === 'R' ? 'RHP' : hand === 'L' ? 'LHP' : hand || '?';
  header.innerHTML = `<span class="quick-look-name">How to Hit: ${profile.name}</span>
    <span class="quick-look-meta">${handLabel} | ${profile.totalPA} PA faced</span>`;
  card.appendChild(header);

  const notes = document.createElement('div');
  notes.className = 'ql-relay-section';
  notes.innerHTML = '<div class="ql-relay-title">HITTING PLAN</div>';
  const list = document.createElement('ul');
  list.className = 'ql-relay-bullets';

  const mix = profile.pitchMix || {};
  const types = Object.keys(mix);
  const byCount = profile.pitchMixByCount || {};

  // 1. What to sit on first pitch
  const fpMix = byCount.first_pitch;
  if (fpMix) {
    const fpTypes = Object.keys(fpMix).sort((a,b) => parseFloat(fpMix[b]) - parseFloat(fpMix[a]));
    if (fpTypes.length > 0) {
      list.innerHTML += `<li>Sit <strong>${fpTypes[0]}</strong> first pitch — throws it <strong>${fpMix[fpTypes[0]]}</strong> of the time</li>`;
    }
  }

  // 2. Most hittable pitch (lowest whiff rate)
  const byWhiff = types.filter(t => mix[t]?.whiffRate && mix[t].whiffRate !== 'N/A')
    .sort((a,b) => parseFloat(mix[a].whiffRate) - parseFloat(mix[b].whiffRate));
  if (byWhiff.length > 0) {
    const easiest = byWhiff[0];
    list.innerHTML += `<li>Most hittable: <strong>${easiest}</strong> — only <strong>${mix[easiest].whiffRate} whiff rate</strong>, look to drive it</li>`;
  }

  // 3. Pitch to lay off / protect against (highest whiff rate)
  if (byWhiff.length > 0) {
    const toughest = byWhiff[byWhiff.length - 1];
    if (toughest !== byWhiff[0]) {
      list.innerHTML += `<li>Toughest pitch: <strong>${toughest}</strong> — <strong>${mix[toughest].whiffRate} whiff rate</strong>, shorten up or lay off</li>`;
    }
  }

  // 4. When he's behind — what to expect
  const behindMix = byCount.behind;
  if (behindMix) {
    const behTypes = Object.keys(behindMix).sort((a,b) => parseFloat(behindMix[b]) - parseFloat(behindMix[a]));
    if (behTypes.length > 0) {
      list.innerHTML += `<li>When behind in count, expect <strong>${behTypes[0]}</strong> (<strong>${behindMix[behTypes[0]]}</strong>) — be ready to attack</li>`;
    }
  }

  // 5. Two-strike approach — what's coming
  const tsMix = byCount.two_strikes;
  if (tsMix) {
    const tsTypes = Object.keys(tsMix).sort((a,b) => parseFloat(tsMix[b]) - parseFloat(tsMix[a]));
    if (tsTypes.length > 0) {
      const putaway = tsTypes[0];
      list.innerHTML += `<li>With 2 strikes, protect against <strong>${putaway}</strong> (<strong>${tsMix[putaway]}</strong>) — don't get caught looking</li>`;
    }
  }

  // 6. Zone profile — expand or stay tight?
  const zp = profile.zoneProfile || {};
  const zoneRate = parseFloat(zp['Zone% (Heart+Shadow)']) || 0;
  if (zoneRate > 60) {
    list.innerHTML += `<li>Lives in the zone (<strong>${zp['Zone% (Heart+Shadow)']}</strong>) — be aggressive early</li>`;
  } else if (zoneRate > 0 && zoneRate < 45) {
    list.innerHTML += `<li>Works off the plate (<strong>${zp['Chase%']}</strong> chase zone) — be patient and take pitches</li>`;
  }

  // 7. First pitch strike rate
  const fps = parseFloat(profile.firstPitchStrike) || 0;
  if (fps > 65) {
    list.innerHTML += `<li>Gets ahead often (<strong>${profile.firstPitchStrike}</strong> first pitch strike) — be ready to swing early</li>`;
  } else if (fps > 0 && fps < 50) {
    list.innerHTML += `<li>Struggles to get ahead (<strong>${profile.firstPitchStrike}</strong> first pitch strike) — take the first pitch</li>`;
  }

  // 8. Platoon edge
  const rAvg = parseFloat(profile.vsRHH?.AVG) || 0;
  const lAvg = parseFloat(profile.vsLHH?.AVG) || 0;
  if (rAvg > 0 && lAvg > 0) {
    if (rAvg > lAvg + 0.05) list.innerHTML += `<li>Hittable from the right side — RHH hit <strong>${profile.vsRHH.AVG}</strong></li>`;
    else if (lAvg > rAvg + 0.05) list.innerHTML += `<li>Hittable from the left side — LHH hit <strong>${profile.vsLHH.AVG}</strong></li>`;
  }

  notes.appendChild(list);
  card.appendChild(notes);
  return card;
}

function resetToMenu() {
  messagesEl.innerHTML = '';
  welcomeEl.classList.remove('hidden');
  document.getElementById('menu-step1').classList.remove('hidden');
  document.getElementById('menu-step2').classList.add('hidden');
  document.getElementById('menu-step3').classList.add('hidden');
  document.getElementById('menu-prompts').classList.add('hidden');
  document.getElementById('menu-tendency-cats').classList.add('hidden');
  document.getElementById('welcome-title').textContent = 'What do you need?';
  document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
  selectedReportType = null;
  matchupState = { pitcher: null, hitter: null, step: 0 };
  tendencyState = { team: null, category: null, step: 0 };
  scrollToBottom();
}

function buildNewAnalysisBar(hitterName, pitcherName) {
  const bar = document.createElement('div');
  bar.className = 'new-analysis-bar';
  const btn = document.createElement('button');
  btn.className = 'new-analysis-btn';
  btn.innerHTML = '&larr; New Analysis';
  btn.onclick = () => { resetToMenu(); };
  const switchBtn = document.createElement('button');
  switchBtn.className = 'new-analysis-btn switch-mode-btn';
  switchBtn.textContent = appMode === 'dugout' ? 'Switch to Full Analysis' : 'Switch to Dugout';
  switchBtn.onclick = () => {
    const newMode = appMode === 'dugout' ? 'full' : 'dugout';
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === newMode);
    });
    appMode = newMode;
    updateModeUI();
    resetToMenu();
  };
  bar.appendChild(btn);
  bar.appendChild(switchBtn);

  // "How to Pitch" button — only for individual hitter cards
  if (hitterName) {
    const pitchBtn = document.createElement('button');
    pitchBtn.className = 'new-analysis-btn';
    pitchBtn.textContent = 'How to Pitch';
    pitchBtn.onclick = () => {
      const pitchCard = buildHowToPitchCard(hitterName);
      if (pitchCard) {
        appendMessage('user', `How to pitch — ${hitterName}`);
        appendQuickLook(pitchCard);
      }
    };
    bar.appendChild(pitchBtn);
  }

  // "How to Hit" button — only for individual pitcher cards
  if (pitcherName) {
    const hitBtn = document.createElement('button');
    hitBtn.className = 'new-analysis-btn';
    hitBtn.textContent = 'How to Hit';
    hitBtn.onclick = () => {
      const hitCard = buildHowToHitCard(pitcherName);
      if (hitCard) {
        appendMessage('user', `How to hit — ${pitcherName}`);
        appendQuickLook(hitCard);
      }
    };
    bar.appendChild(hitBtn);
  }

  return bar;
}

function appendQuickLook(cardOrContainer, hitterName, pitcherName) {
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'Quick Look';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.style.padding = '4px';
  bubble.style.background = 'transparent';
  bubble.style.border = 'none';
  // Inject GCL links into the card content only (not the action buttons)
  const cardWrapper = document.createElement('div');
  cardWrapper.appendChild(cardOrContainer);
  cardWrapper.innerHTML = injectGCLLinks(cardWrapper.innerHTML);
  bubble.appendChild(cardWrapper);
  bubble.appendChild(buildNewAnalysisBar(hitterName, pitcherName));
  msg.appendChild(label);
  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  scrollToBottom();
}

function showLoading() {
  const el=document.createElement('div');
  el.className='loading-indicator';
  el.innerHTML='<div class="loading-dots"><span></span><span></span><span></span></div><span class="loading-text">Scouting...</span>';
  messagesEl.appendChild(el); scrollToBottom(); return el;
}
function removeLoading(el) { if (el&&el.parentNode) el.parentNode.removeChild(el); }
function scrollToBottom() { requestAnimationFrame(()=>{chatArea.scrollTop=chatArea.scrollHeight;}); }
function showError(msg) {
  const t=document.createElement('div'); t.className='error-toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>{if(t.parentNode)t.parentNode.removeChild(t);},5000);
}

// ===== AUTOCOMPLETE =====
function showAutocomplete() {
  const val=userInput.value.trim().toLowerCase();
  if (val.length<2) { hideAC(); return; }
  const words=val.split(/\s+/);
  const last=words[words.length-1];
  if (last.length<2) { hideAC(); return; }
  const matches=allNames.filter(n=>n.name.toLowerCase().includes(last)).slice(0,8);
  if (matches.length===0) { hideAC(); return; }
  acList.innerHTML='';
  matches.forEach(m => {
    const item=document.createElement('div');
    item.className='ac-item';
    item.innerHTML=`${m.name}<span class="ac-type">${m.type}</span>`;
    item.onclick=()=>{
      const before=userInput.value;
      const idx=before.toLowerCase().lastIndexOf(last);
      userInput.value=before.substring(0,idx)+m.name+' ';
      hideAC(); userInput.focus();
    };
    acList.appendChild(item);
  });
  acList.classList.remove('hidden');
}
function hideAC() { acList.classList.add('hidden'); }

// ===== MARKDOWN =====
function renderMarkdown(text) {
  let h=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  h=h.replace(/^#### (.+)$/gm,'<h4>$1</h4>');
  h=h.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  h=h.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  h=h.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  h=h.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h=h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h=h.replace(/`([^`]+)`/g,'<code>$1</code>');
  h=h.replace(/^---$/gm,'<hr>');
  h=h.replace(/^[\t ]*[-*] (.+)$/gm,'<li>$1</li>');
  h=h.replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul>$1</ul>');
  h=h.replace(/^[\t ]*\d+\. (.+)$/gm,'<li>$1</li>');
  h=h.split(/\n\n+/).map(b=>{
    b=b.trim(); if(!b) return '';
    if (b.startsWith('<h')||b.startsWith('<ul')||b.startsWith('<ol')||b.startsWith('<hr')) return b;
    return '<p>'+b.replace(/\n/g,'<br>')+'</p>';
  }).join('\n');
  return h;
}
