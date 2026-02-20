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
    if (seasonFilter === '2024') return d.includes('/2024');
    if (seasonFilter === '2025') return d.includes('/2025');
    return true;
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
  let totalPA=0, ks=0, bbs=0, hrs=0, hits=0, firstPitchStrikes=0, firstPitches=0;
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
    if (isSwing) swingsByType[pt] = (swingsByType[pt]||0)+1;
    if (result.includes('Swing and Miss')) whiffByType[pt] = (whiffByType[pt]||0)+1;
    if (b===0&&s===0) { firstPitches++; if (result.includes('Strike')) firstPitchStrikes++; }

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
  const vsRHP={abs:0,hits:0,ks:0}, vsLHP={abs:0,hits:0,ks:0};
  const byCount={first_pitch:{abs:0,hits:0,ks:0},ahead:{abs:0,hits:0,ks:0},even:{abs:0,hits:0,ks:0},two_strikes:{abs:0,hits:0,ks:0}};
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
      if (isAB) sp.abs++; if (isHit) sp.hits++; if (abResult==='Strike Out') sp.ks++;
      const cats=[];
      if (b===0 && s===0) cats.push('first_pitch');
      if (s===2) cats.push('two_strikes');
      if (b>s) cats.push('ahead');
      if (b===s) cats.push('even');
      cats.forEach(cc=>{ if (isAB) byCount[cc].abs++; if (isHit) byCount[cc].hits++; if (abResult==='Strike Out') byCount[cc].ks++; });
    }
  });

  const resultsByPitchType={};
  Object.keys(byPitchType).forEach(pt => {
    const d=byPitchType[pt];
    resultsByPitchType[pt]={ pitchesSeen:d.pitches, AVG:d.abs>0?(d.hits/d.abs).toFixed(3):'N/A', whiffRate:pct(d.whiffs,d.swings), chaseRate:pct(chaseSwingsByType[pt]||0,chasePitchesByType[pt]||0) };
  });
  const fmtCount=c=>({AVG:c.abs>0?(c.hits/c.abs).toFixed(3):'N/A', K_rate:c.abs>0?pct(c.ks,c.abs):'N/A'});

  return {
    name, hand:hand||'', totalPitchesSeen:total, totalPA,
    AVG:totalAB>0?(totalHits/totalAB).toFixed(3):'N/A',
    K_rate:pct(totalKs,totalPA), BB_rate:pct(totalBBs,totalPA),
    overallChaseRate:pct(chaseSwings,chasePitches),
    resultsByPitchType,
    vsRHP:{AVG:vsRHP.abs>0?(vsRHP.hits/vsRHP.abs).toFixed(3):'N/A',K_rate:vsRHP.abs>0?pct(vsRHP.ks,vsRHP.abs):'N/A'},
    vsLHP:{AVG:vsLHP.abs>0?(vsLHP.hits/vsLHP.abs).toFixed(3):'N/A',K_rate:vsLHP.abs>0?pct(vsLHP.ks,vsLHP.abs):'N/A'},
    byCount:{first_pitch:fmtCount(byCount.first_pitch),ahead:fmtCount(byCount.ahead),even:fmtCount(byCount.even),two_strikes:fmtCount(byCount.two_strikes)},
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

// ===== QUESTION ROUTING =====
function findBestMatch(query, candidates) {
  let best=null, bestLen=0;
  for (const name of candidates) {
    const lower=name.toLowerCase();
    if (query.includes(lower)&&lower.length>bestLen) { best=name; bestLen=lower.length; }
    const parts=name.split(/\s+/);
    if (parts.length>1) { const ln=parts[parts.length-1].toLowerCase(); if (ln.length>2&&query.includes(ln)&&ln.length>bestLen) { best=name; bestLen=ln.length; } }
    if (parts.length>0) { const fn=parts[0].toLowerCase(); if (fn.length>3&&query.includes(fn)&&!best) best=name; }
  }
  return best;
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

function routeQuestion(question) {
  const q=question.toLowerCase();
  const ctx={type:'',data:{}};
  const oppP=findBestMatch(q,Object.keys(stats.opponentPitchers));
  const oppB=findBestMatch(q,Object.keys(stats.opponentBatters));
  const moeP=findBestMatch(q,stats.moellerPitcherList);
  const moeH=findBestMatch(q,stats.moellerHitterList);
  const team=findBestMatch(q,stats.teamList);

  if ((q.includes('game plan')||q.includes('scouting report')||q.includes('prepare for')||q.includes('prep for')||q.includes('facing'))&&team) {
    ctx.type='game_plan'; ctx.data.teamSummary=computeTeamSummary(team);
    ctx.data.opponentPitchers=getTeamPitcherProfiles(team); ctx.data.opponentBatters=getTeamBatterProfiles(team); ctx.data.moellerHitters=getAllMoellerHitterProfiles(); return ctx;
  }
  if ((q.includes('batter')||q.includes('hitter')||q.includes('lineup')||q.includes('hitting'))&&team) {
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
      showStep2(selectedReportType);
    });
  });

  document.getElementById('menu-back').addEventListener('click', () => {
    document.getElementById('menu-step2').classList.add('hidden');
    if (window._promptPickerActive) {
      window._promptPickerActive = false;
      showPrompts();
    } else {
      document.getElementById('menu-step1').classList.remove('hidden');
      document.getElementById('welcome-title').textContent = 'What do you need?';
      document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
      selectedReportType = null;
    }
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
  if (window._promptPickerActive && window._promptTemplate) {
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
  let query = '';
  if (type === 'hitter_report') query = `Give me a full scouting report on ${item.name} as a hitter`;
  else if (type === 'pitcher_report') query = `Give me a full scouting report on ${item.name} as a pitcher`;
  else if (type === 'team_hitters') query = item.name === 'Moeller' ? 'Give me a scouting report on all Moeller hitters in the lineup' : `Give me a scouting report on ${item.name}'s hitters and lineup`;
  else if (type === 'team_pitchers') query = item.name === 'Moeller' ? 'Give me a scouting report on our Moeller pitching staff' : `Give me a scouting report on ${item.name}'s pitching staff`;
  userInput.value = query;
  sendMessage();
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
  [{val:`${primaryVelo}`,lbl:`${primary} Velo`},{val:profile.K_rate||'N/A',lbl:'K Rate'},{val:profile.BB_rate||'N/A',lbl:'BB Rate'},{val:profile.firstPitchStrike||'N/A',lbl:'1st Pitch K%'}].forEach(s => {
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
    let tableHTML = '<div class="ql-pitch-header"><span>Pitch</span><span>Usage</span><span>Velo</span><span>Range</span><span>Whiff%</span></div>';
    types.forEach(t => {
      const m = mix[t];
      const range = (m.veloMin && m.veloMax) ? `${m.veloMin}\u2013${m.veloMax}` : '-';
      tableHTML += `<div class="ql-pitch-row">
        <span class="ql-pitch-name"><span class="ql-pitch-dot" style="background:${PITCH_COLORS[t]||'#95A5A6'}"></span>${t}</span>
        <span class="ql-pitch-val">${m.pct}</span>
        <span class="ql-pitch-val">${m.avgVelo || '-'}</span>
        <span class="ql-pitch-val">${range}</span>
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
      if (['BB','HBP','IBB'].includes(abResult)) sp.bbs++;
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

  // Compute wOBA
  function calcWOBA(s) {
    const num = (0.69*s.bbs) + (0.72*s.hbp) + (0.89*s.singles) + (1.27*s.doubles) + (1.62*s.triples) + (2.10*s.hrs);
    const den = s.bbs + s.hbp + s.singles + s.doubles + s.triples + s.hrs + s.outs;
    return den > 0 ? (num/den).toFixed(3) : 'N/A';
  }

  return {
    outcomeByGroup,
    vsRHP: { ...vsRHP, AVG: vsRHP.abs>0?(vsRHP.hits/vsRHP.abs).toFixed(3):'N/A', K_rate:pct(vsRHP.ks,vsRHP.abs||1), wOBA:calcWOBA(vsRHP), XBH:vsRHP.doubles+vsRHP.triples+vsRHP.hrs, H:vsRHP.hits },
    vsLHP: { ...vsLHP, AVG: vsLHP.abs>0?(vsLHP.hits/vsLHP.abs).toFixed(3):'N/A', K_rate:pct(vsLHP.ks,vsLHP.abs||1), wOBA:calcWOBA(vsLHP), XBH:vsLHP.doubles+vsLHP.triples+vsLHP.hrs, H:vsLHP.hits },
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
      if (['BB','HBP','IBB'].includes(abResult)) sp.bbs++;
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
    const den = s.bbs+s.hbp+s.singles+s.doubles+s.triples+s.hrs+s.outs;
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
        <span><strong>${pct(d.ks,d.abs||1)}</strong> K%</span>
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

  let totalPA=0, ks=0, bbs=0, hrs=0, hits=0, firstPitchStrikes=0, firstPitches=0;
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
    if (isSwing) swingsByType[pt] = (swingsByType[pt]||0)+1;
    if (result.includes('Swing and Miss')) whiffByType[pt] = (whiffByType[pt]||0)+1;
    if (b===0&&s===0) { firstPitches++; if (result.includes('Strike')) firstPitchStrikes++; }

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

  relayList.innerHTML += `<li>Staff K rate: <strong>${pct(ks,totalPA)}</strong> | BB rate: <strong>${pct(bbs,totalPA)}</strong> | 1st pitch strike: <strong>${pct(firstPitchStrikes,firstPitches)}</strong></li>`;

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
  [{val:pct(ks,totalPA),lbl:'K Rate'},{val:pct(bbs,totalPA),lbl:'BB Rate'},{val:pct(firstPitchStrikes,firstPitches),lbl:'1st Pitch K%'},{val:pct(hrs,totalPA),lbl:'HR Rate'},{val:String(names.length),lbl:'Arms'}].forEach(s => {
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
        <span class="ql-pitch-val">${veloByType[t]?avg(veloByType[t]):'-'}</span>
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
  const oppP = findBestMatch(q, Object.keys(stats.opponentPitchers));
  const moeP = findBestMatch(q, stats.moellerPitcherList);
  const moeH = findBestMatch(q, stats.moellerHitterList);
  const oppB = findBestMatch(q, Object.keys(stats.opponentBatters));
  const team = findBestMatch(q, stats.teamList);

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

  // Individual hitter by name
  if (moeH) {
    const h = stats.moellerHitters[moeH];
    return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, moeH, h.hand), h.pitches), hitterName: moeH, pitcherName: null};
  }
  if (oppB) {
    const h = stats.opponentBatters[oppB];
    return {card: buildHitterQuickLookCard(computeHitterProfile(h.pitches, oppB, h.hand), h.pitches), hitterName: oppB, pitcherName: null};
  }

  // Pitcher lookups
  if (oppP) {
    const p = stats.opponentPitchers[oppP];
    return {card: buildQuickLookCard(computePitcherProfile(p.pitches, oppP, p.hand, p.team), p.pitches), hitterName: null, pitcherName: oppP};
  }
  if (moeP) {
    const p = stats.moellerPitchers[moeP];
    return {card: buildQuickLookCard(computePitcherProfile(p.pitches, moeP, p.hand, 'Moeller'), p.pitches), hitterName: null, pitcherName: moeP};
  }
  if (team) return {card: buildTeamQuickLook(team), hitterName: null, pitcherName: null};
  return null;
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
    const dataPayload=JSON.stringify(context.data,null,2);
    const fullMessage=`Here is the relevant data (context type: ${context.type}). Coach's question: "${text}"\n\n${dataPayload}`;

    // Generate charts only in full mode
    const charts = appMode === 'full' ? generateCharts(text, context.type, context.data) : [];

    const res=await fetch('/api/chat',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:fullMessage,session_id:sessionId,mode:appMode}),
    });
    const data=await res.json();
    if (!res.ok) throw new Error(data.error||`Server error (${res.status})`);
    removeLoading(loadingEl);
    appendMessage('assistant', data.reply, charts);
  } catch(err) {
    removeLoading(loadingEl);
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
    bubble.innerHTML=renderMarkdown(text);
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

function buildNewAnalysisBar(hitterName, pitcherName) {
  const bar = document.createElement('div');
  bar.className = 'new-analysis-bar';
  const btn = document.createElement('button');
  btn.className = 'new-analysis-btn';
  btn.innerHTML = '&larr; New Analysis';
  btn.onclick = () => {
    // Reset to welcome menu
    messagesEl.innerHTML = '';
    welcomeEl.classList.remove('hidden');
    document.getElementById('menu-step1').classList.remove('hidden');
    document.getElementById('menu-step2').classList.add('hidden');
    document.getElementById('menu-prompts').classList.add('hidden');
    document.getElementById('welcome-title').textContent = 'What do you need?';
    document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
    selectedReportType = null;
    scrollToBottom();
  };
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
    // Reset to menu
    messagesEl.innerHTML = '';
    welcomeEl.classList.remove('hidden');
    document.getElementById('menu-step1').classList.remove('hidden');
    document.getElementById('menu-step2').classList.add('hidden');
    document.getElementById('menu-prompts').classList.add('hidden');
    document.getElementById('welcome-title').textContent = 'What do you need?';
    document.getElementById('welcome-subtitle').textContent = 'Select a report type to get started';
    selectedReportType = null;
    scrollToBottom();
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
  bubble.appendChild(cardOrContainer);
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
