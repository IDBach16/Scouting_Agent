/* ============================================
   APP.JS — Data processing, routing, chat, autocomplete
   Moeller Game Prep Agent V3
   ============================================ */

let rawData = [];
let filteredData = [];
let seasonFilter = 'all';
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
    pitchMix[pt] = { count:pitchTypes[pt], pct:pct(pitchTypes[pt],total), avgVelo:veloByType[pt]?avg(veloByType[pt]):null, whiffRate:pct(whiffByType[pt]||0,swingsByType[pt]||0) };
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
  const byCount={ahead:{abs:0,hits:0,ks:0},behind:{abs:0,hits:0,ks:0},even:{abs:0,hits:0,ks:0}};
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
      let cc='even'; if (s>b) cc='behind'; else if (b>s) cc='ahead';
      if (isAB) byCount[cc].abs++; if (isHit) byCount[cc].hits++; if (abResult==='Strike Out') byCount[cc].ks++;
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
    byCount:{ahead:fmtCount(byCount.ahead),behind:fmtCount(byCount.behind),even:fmtCount(byCount.even)},
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

// ===== SEND MESSAGE =====
async function sendMessage() {
  const text=userInput.value.trim();
  if (!text||isLoading) return;
  hideAC();
  welcomeEl.classList.add('hidden');
  appendMessage('user',text);
  userInput.value=''; userInput.style.height='auto';
  isLoading=true; sendBtn.disabled=true;
  const loadingEl=showLoading();

  try {
    const context=routeQuestion(text);
    const dataPayload=JSON.stringify(context.data,null,2);
    const fullMessage=`Here is the relevant data (context type: ${context.type}). Coach's question: "${text}"\n\n${dataPayload}`;

    // Start generating charts while waiting for API
    const charts = generateCharts(text, context.type, context.data);

    const res=await fetch('/api/chat',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:fullMessage,session_id:sessionId}),
    });
    const data=await res.json();
    if (!res.ok) throw new Error(data.error||`Server error (${res.status})`);
    removeLoading(loadingEl);
    appendMessage('assistant', data.reply, charts);
  } catch(err) {
    removeLoading(loadingEl);
    showError(err.message);
  } finally {
    isLoading=false; sendBtn.disabled=false; userInput.focus();
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
  } else {
    bubble.textContent=text;
  }

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
