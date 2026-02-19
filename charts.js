/* ============================================
   CHARTS.JS — All Chart.js rendering functions
   Moeller Game Prep Agent V3
   ============================================ */

const PITCH_COLORS = {
  'Fastball':'#E63946','Two Seam':'#FF6B6B','Cutter':'#9B59B6',
  'Slider':'#3498DB','Curveball':'#2ECC71','Breaking Ball':'#F1C40F',
  'Changeup':'#E67E22','Splitter':'#1ABC9C','Unknown':'#95A5A6',
};
const ZONE_COLORS = { Heart:'#E63946', Shadow:'#E67E22', Chase:'#F1C40F', Waste:'#6B7280' };
const CHART_BG = '#243656';
const CHART_TEXT = 'rgba(255,255,255,0.85)';
const CHART_GRID = 'rgba(255,255,255,0.08)';
const GOLD = '#C5A55A';

let chartCounter = 0;
function uid() { return 'chart_' + (++chartCounter) + '_' + Date.now(); }

function getColor(pitchType) { return PITCH_COLORS[pitchType] || '#95A5A6'; }

function defaultChartOpts(title) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      title: { display: !!title, text: title, color: CHART_TEXT, font: { size: 13, weight: 'bold' } },
      legend: { labels: { color: CHART_TEXT, font: { size: 11 }, padding: 10 } },
      tooltip: { backgroundColor: '#111D33', titleColor: '#C5A55A', bodyColor: '#E8E6E1', borderColor: '#C5A55A', borderWidth: 1, cornerRadius: 6 },
    },
    scales: {
      x: { ticks: { color: CHART_TEXT, font: { size: 10 } }, grid: { color: CHART_GRID } },
      y: { ticks: { color: CHART_TEXT, font: { size: 10 } }, grid: { color: CHART_GRID } },
    },
  };
}

function makeCard(titleText) {
  const card = document.createElement('div');
  card.className = 'chart-card';
  const t = document.createElement('div');
  t.className = 'chart-card-title';
  t.textContent = titleText;
  card.appendChild(t);
  const canvas = document.createElement('canvas');
  canvas.id = uid();
  canvas.style.height = '300px';
  card.appendChild(canvas);
  // Download btn
  const dl = document.createElement('button');
  dl.className = 'chart-dl-btn';
  dl.textContent = '\u2B07 PNG';
  dl.onclick = () => {
    const a = document.createElement('a');
    a.download = titleText.replace(/[^a-z0-9]/gi,'_') + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  card.appendChild(dl);
  return { card, canvas };
}

// ===== CHART 1: PITCH MIX DONUT =====
function chartPitchMixDonut(profile, label) {
  const mix = profile.pitchMix;
  if (!mix) return null;
  const types = Object.keys(mix);
  const title = `${label || profile.name}: Pitch Mix (${profile.totalPitches} pitches)`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: types.map(t => `${t} ${mix[t].pct}`),
      datasets: [{ data: types.map(t => mix[t].count), backgroundColor: types.map(getColor), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: CHART_TEXT, font: { size: 11 }, padding: 8 } },
        tooltip: { callbacks: { label: ctx => `${types[ctx.dataIndex]}: ${mix[types[ctx.dataIndex]].count} (${mix[types[ctx.dataIndex]].pct})` } },
      },
      cutout: '55%',
    },
  });
  return card;
}

// ===== CHART 2: PITCH MIX BY COUNT — STACKED BAR =====
function chartPitchMixByCount(profile, label) {
  const byCount = profile.pitchMixByCount;
  if (!byCount) return null;
  const countLabels = ['first_pitch','even','ahead','behind','two_strikes'];
  const displayLabels = ['First Pitch','Even','Ahead','Behind','Two Strikes'];
  const available = countLabels.filter(c => byCount[c]);
  if (available.length === 0) return null;
  const allTypes = new Set();
  available.forEach(c => Object.keys(byCount[c]).forEach(t => allTypes.add(t)));
  const types = [...allTypes];
  const title = `${label || profile.name}: Pitch Mix by Count`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: available.map(c => displayLabels[countLabels.indexOf(c)]),
      datasets: types.map(t => ({
        label: t,
        data: available.map(c => parseFloat(byCount[c]?.[t]) || 0),
        backgroundColor: getColor(t),
      })),
    },
    options: {
      ...defaultChartOpts(),
      indexAxis: 'y',
      plugins: { ...defaultChartOpts().plugins, legend: { labels: { color: CHART_TEXT, font: { size: 10 } } } },
      scales: {
        x: { stacked: true, max: 100, ticks: { color: CHART_TEXT, callback: v => v + '%' }, grid: { color: CHART_GRID } },
        y: { stacked: true, ticks: { color: CHART_TEXT, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
  return card;
}

// ===== CHART 3: VELOCITY BAR =====
function chartVelocity(profile, label) {
  const mix = profile.pitchMix;
  if (!mix) return null;
  const types = Object.keys(mix).filter(t => mix[t].avgVelo);
  if (types.length === 0) return null;
  const title = `${label || profile.name}: Avg Velocity by Pitch Type`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: types,
      datasets: [{ label: 'Avg Velo (mph)', data: types.map(t => parseFloat(mix[t].avgVelo)), backgroundColor: types.map(getColor), borderRadius: 4 }],
    },
    options: {
      ...defaultChartOpts(),
      plugins: {
        ...defaultChartOpts().plugins,
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} mph` } },
      },
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { display: false } },
        y: { min: Math.max(0, Math.min(...types.map(t => parseFloat(mix[t].avgVelo))) - 10), ticks: { color: CHART_TEXT, callback: v => v + ' mph' }, grid: { color: CHART_GRID } },
      },
    },
    plugins: [{
      afterDatasetsDraw(chart) {
        const ctx2 = chart.ctx;
        chart.data.datasets[0].data.forEach((val, i) => {
          const meta = chart.getDatasetMeta(0).data[i];
          ctx2.save();
          ctx2.fillStyle = '#fff';
          ctx2.font = 'bold 11px sans-serif';
          ctx2.textAlign = 'center';
          ctx2.fillText(val + ' mph', meta.x, meta.y - 6);
          ctx2.restore();
        });
      }
    }],
  });
  return card;
}

// ===== CHART 5: ATTACK ZONE PIE =====
function chartAttackZone(profile, label) {
  const zp = profile.zoneProfile;
  if (!zp) return null;
  const slices = ['Heart%','Shadow%','Chase%','Waste%'];
  const vals = slices.map(s => parseFloat(zp[s]) || 0);
  if (vals.every(v => v === 0)) return null;
  const colors = ['#E63946','#E67E22','#F1C40F','#6B7280'];
  const title = `${label || profile.name}: Attack Zone Breakdown`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'pie',
    data: {
      labels: ['Heart','Shadow','Chase','Waste'].map((l,i) => `${l} ${vals[i]}%`),
      datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: CHART_TEXT, font: { size: 11 } } } } },
  });
  return card;
}

// ===== CHART 6: WHIFF RATE BAR =====
function chartWhiffRate(profile, label) {
  const mix = profile.pitchMix;
  if (!mix) return null;
  const types = Object.keys(mix).filter(t => mix[t].whiffRate && mix[t].whiffRate !== 'N/A');
  if (types.length === 0) return null;
  types.sort((a, b) => parseFloat(mix[b].whiffRate) - parseFloat(mix[a].whiffRate));
  const title = `${label || profile.name}: Whiff Rate by Pitch Type`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: types,
      datasets: [{ label: 'Whiff %', data: types.map(t => parseFloat(mix[t].whiffRate) || 0), backgroundColor: types.map(getColor), borderRadius: 4 }],
    },
    options: {
      ...defaultChartOpts(),
      plugins: { ...defaultChartOpts().plugins, legend: { display: false },
        annotation: { annotations: { line1: { type: 'line', yMin: 25, yMax: 25, borderColor: GOLD, borderDash: [5, 5], borderWidth: 1, label: { display: true, content: '25% reference', color: GOLD } } } }
      },
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { display: false } },
        y: { min: 0, ticks: { color: CHART_TEXT, callback: v => v + '%' }, grid: { color: CHART_GRID } },
      },
    },
  });
  return card;
}

// ===== CHART 4: ZONE HEATMAP (HTML grid, not canvas) =====
function chartZoneHeatmap(pitches, label) {
  if (!pitches || pitches.length === 0) return null;
  const card = document.createElement('div');
  card.className = 'chart-card';
  const t = document.createElement('div');
  t.className = 'chart-card-title';
  t.textContent = `${label}: Pitch Location Heatmap (${pitches.length} pitches)`;
  card.appendChild(t);

  // Map locations to 5x5 grid
  // Row/Col mapping: 5x5 grid [row][col]
  const grid = Array.from({ length: 5 }, () => Array(5).fill(0));
  const locMap = {
    31:[0,0],32:[0,1],33:[0,2],34:[0,3],35:[0,4],
    21:[1,0],11:[1,1],12:[1,2],13:[1,3],22:[1,4],
    24:[2,0],14:[2,1], 1:[2,1], 2:[2,2], 3:[2,3],15:[2,3],25:[2,4],
    26:[3,0],16:[3,1], 4:[3,1], 5:[3,2], 6:[3,3],17:[3,3],27:[3,4],
    36:[4,0],28:[4,0],18:[4,1], 7:[4,1], 8:[4,2], 9:[4,3],19:[4,3],29:[4,4],37:[4,4],
    38:[4,2],39:[4,4],23:[1,4],
  };
  // Simplified mapping
  const simpleMap = {
    1:[1,1],2:[1,2],3:[1,3],4:[2,1],5:[2,2],6:[2,3],7:[3,1],8:[3,2],9:[3,3],
    11:[0,1],12:[0,2],13:[0,3],14:[2,0],15:[2,4],16:[1,0],17:[3,0],18:[4,1],19:[3,4],
    21:[0,0],22:[0,4],23:[1,4],24:[2,0],25:[2,4],26:[3,0],27:[3,4],28:[4,0],29:[4,4],
    31:[0,0],32:[0,1],33:[0,2],34:[0,3],35:[0,4],36:[4,0],37:[4,1],38:[4,2],39:[4,4],
  };

  pitches.forEach(row => {
    const loc = parseInt(row.Location);
    if (simpleMap[loc]) {
      const [r, c] = simpleMap[loc];
      grid[r][c]++;
    }
  });

  const maxVal = Math.max(1, ...grid.flat());
  const gridEl = document.createElement('div');
  gridEl.className = 'zone-grid';

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement('div');
      cell.className = 'zone-cell';
      const intensity = grid[r][c] / maxVal;
      const isZone = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      let bg;
      if (intensity === 0) bg = 'rgba(255,255,255,0.03)';
      else if (intensity < 0.25) bg = `rgba(197,165,90,${0.15 + intensity})`;
      else if (intensity < 0.5) bg = `rgba(230,121,70,${0.3 + intensity * 0.5})`;
      else bg = `rgba(230,57,70,${0.4 + intensity * 0.5})`;
      cell.style.background = bg;
      if (isZone) cell.style.border = '1px solid rgba(197,165,90,0.4)';
      else cell.style.border = '1px solid rgba(255,255,255,0.05)';
      if (grid[r][c] > 0) cell.textContent = grid[r][c];
      gridEl.appendChild(cell);
    }
  }
  card.appendChild(gridEl);
  const lbl = document.createElement('div');
  lbl.className = 'zone-grid-label';
  lbl.textContent = 'Catcher\'s View | Inner box = strike zone | Color intensity = frequency';
  card.appendChild(lbl);
  return card;
}

// ===== CHART 8: VELOCITY BY INNING =====
function chartVeloByInning(pitches, name) {
  if (!pitches || pitches.length === 0) return null;
  const byInning = {};
  pitches.forEach(row => {
    const inn = parseInt(row.Inning);
    const velo = parseFloat(row.PitchVelo);
    const pt = normalizePitchType(row.PitchType);
    if (!inn || isNaN(velo) || velo <= 0) return;
    if (!byInning[inn]) byInning[inn] = {};
    if (!byInning[inn][pt]) byInning[inn][pt] = [];
    byInning[inn][pt].push(velo);
  });
  const innings = Object.keys(byInning).map(Number).sort((a, b) => a - b);
  if (innings.length < 2) return null;
  const allTypes = new Set();
  innings.forEach(i => Object.keys(byInning[i]).forEach(t => allTypes.add(t)));
  const types = [...allTypes];
  const title = `${name}: Velocity by Inning`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: innings.map(i => 'Inn ' + i),
      datasets: types.map(t => ({
        label: t,
        data: innings.map(i => {
          const v = byInning[i]?.[t];
          return v ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
        }),
        borderColor: getColor(t),
        backgroundColor: getColor(t) + '33',
        tension: 0.3, pointRadius: 4, spanGaps: true,
      })),
    },
    options: {
      ...defaultChartOpts(),
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_TEXT, callback: v => v + ' mph' }, grid: { color: CHART_GRID } },
      },
    },
  });
  return card;
}

// ===== CHART 11: HITTER PERFORMANCE BY PITCH TYPE =====
function chartHitterByPitchType(hProfile, label) {
  const rbt = hProfile.resultsByPitchType;
  if (!rbt) return null;
  const types = Object.keys(rbt).filter(t => rbt[t].pitchesSeen >= 5);
  if (types.length === 0) return null;
  types.sort((a, b) => rbt[b].pitchesSeen - rbt[a].pitchesSeen);
  const title = `${label || hProfile.name}: Performance by Pitch Type`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: types,
      datasets: [
        { label: 'AVG (x1000)', data: types.map(t => rbt[t].AVG !== 'N/A' ? (parseFloat(rbt[t].AVG) * 1000).toFixed(0) : 0), backgroundColor: '#2ECC71', borderRadius: 3 },
        { label: 'Whiff%', data: types.map(t => parseFloat(rbt[t].whiffRate) || 0), backgroundColor: '#E63946', borderRadius: 3 },
        { label: 'Chase%', data: types.map(t => parseFloat(rbt[t].chaseRate) || 0), backgroundColor: '#F1C40F', borderRadius: 3 },
      ],
    },
    options: {
      ...defaultChartOpts(),
      indexAxis: 'y',
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_TEXT, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
  return card;
}

// ===== CHART 12: HITTER HOT/COLD ZONE =====
function chartHotColdZone(pitches, name) {
  if (!pitches || pitches.length === 0) return null;
  const card = document.createElement('div');
  card.className = 'chart-card';
  const t = document.createElement('div');
  t.className = 'chart-card-title';
  t.textContent = `${name}: Hot/Cold Zone Map`;
  card.appendChild(t);

  const zoneStats = {};
  for (let i = 1; i <= 9; i++) zoneStats[i] = { hits: 0, abs: 0 };
  const seenPA = new Set();
  pitches.forEach(row => {
    const loc = parseInt(row.Location);
    const abResult = (row.AtBatResult || '').trim();
    if (loc >= 1 && loc <= 9 && abResult) {
      const paKey = `${row.Date}-${row.Inning}-${row['Top/Bottom']}-${row.Pitcher}-${row.PAofInning}`;
      if (!seenPA.has(paKey)) {
        seenPA.add(paKey);
        const isHit = ['1B','2B','3B','HR'].includes(abResult);
        const isAB = !['BB','HBP','IBB','Sacrifice','Catchers Interference'].includes(abResult);
        if (isAB) { zoneStats[loc].abs++; if (isHit) zoneStats[loc].hits++; }
      }
    }
  });

  const gridEl = document.createElement('div');
  gridEl.style.display = 'inline-grid';
  gridEl.style.gridTemplateColumns = 'repeat(3,60px)';
  gridEl.style.gridTemplateRows = 'repeat(3,60px)';
  gridEl.style.gap = '2px';
  gridEl.style.margin = '8px auto';
  gridEl.style.borderRadius = '4px';

  for (let i = 1; i <= 9; i++) {
    const cell = document.createElement('div');
    cell.style.display = 'flex';
    cell.style.flexDirection = 'column';
    cell.style.alignItems = 'center';
    cell.style.justifyContent = 'center';
    cell.style.borderRadius = '4px';
    cell.style.fontSize = '.75rem';
    cell.style.fontWeight = '700';
    const s = zoneStats[i];
    const avg = s.abs > 0 ? (s.hits / s.abs) : -1;
    if (avg < 0) { cell.style.background = 'rgba(255,255,255,0.05)'; cell.textContent = '-'; cell.style.color = '#666'; }
    else if (avg >= .300) { cell.style.background = 'rgba(46,204,113,0.6)'; cell.style.color = '#fff'; }
    else if (avg >= .200) { cell.style.background = 'rgba(241,196,15,0.5)'; cell.style.color = '#fff'; }
    else { cell.style.background = 'rgba(230,57,70,0.5)'; cell.style.color = '#fff'; }
    if (avg >= 0) {
      cell.innerHTML = `<span>${avg.toFixed(3)}</span><span style="font-size:.55rem;opacity:.7">${s.abs} AB</span>`;
    }
    gridEl.appendChild(cell);
  }
  card.appendChild(gridEl);
  const lbl = document.createElement('div');
  lbl.className = 'zone-grid-label';
  lbl.innerHTML = 'Catcher\'s View | <span style="color:#2ECC71">Green = Hot (.300+)</span> | <span style="color:#F1C40F">Yellow = .200-.299</span> | <span style="color:#E63946">Red = Cold (&lt;.200)</span>';
  card.appendChild(lbl);
  return card;
}

// ===== CHART 14: HITTER COUNT PERFORMANCE =====
function chartHitterByCount(hProfile, label) {
  const bc = hProfile.byCount;
  if (!bc) return null;
  const groups = ['first_pitch','ahead','even','two_strikes'];
  const display = ['1st Pitch','Ahead','Even','2 Strikes'];
  const title = `${label || hProfile.name}: Performance by Count`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: display,
      datasets: [
        { label: 'AVG', data: groups.map(g => bc[g]?.AVG !== 'N/A' ? (parseFloat(bc[g].AVG) * 1000).toFixed(0) : 0), backgroundColor: '#2ECC71', borderRadius: 3 },
        { label: 'K Rate %', data: groups.map(g => parseFloat(bc[g]?.K_rate) || 0), backgroundColor: '#E63946', borderRadius: 3 },
      ],
    },
    options: {
      ...defaultChartOpts(),
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { display: false } },
        y: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
      },
    },
  });
  return card;
}

// ===== CHART 15: HITTER SPLITS (RHP/LHP) =====
function chartHitterSplits(hProfile, label) {
  if (!hProfile.vsRHP || !hProfile.vsLHP) return null;
  const title = `${label || hProfile.name}: vs RHP / LHP`;
  const { card, canvas } = makeCard(title);
  const rAvg = parseFloat(hProfile.vsRHP.AVG) || 0;
  const lAvg = parseFloat(hProfile.vsLHP.AVG) || 0;
  const rK = parseFloat(hProfile.vsRHP.K_rate) || 0;
  const lK = parseFloat(hProfile.vsLHP.K_rate) || 0;
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['vs RHP', 'vs LHP'],
      datasets: [
        { label: 'AVG (x1000)', data: [(rAvg*1000).toFixed(0), (lAvg*1000).toFixed(0)], backgroundColor: ['#3498DB','#E67E22'], borderRadius: 4 },
        { label: 'K Rate %', data: [rK, lK], backgroundColor: ['#3498DB80','#E67E2280'], borderRadius: 4 },
      ],
    },
    options: {
      ...defaultChartOpts(),
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { display: false } },
        y: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
      },
    },
  });
  return card;
}

// ===== CHART 17: MATCHUP RADAR =====
function chartMatchupRadar(pitcherProfile, hitterProfile) {
  if (!pitcherProfile || !hitterProfile) return null;
  const title = `Matchup: ${hitterProfile.name} vs ${pitcherProfile.name}`;
  const { card, canvas } = makeCard(title);
  const axes = ['FB Whiff%', 'Brk Whiff%', 'Zone%', 'Chase Induced%', 'K Rate%', '1st Pitch K%'];
  const mix = pitcherProfile.pitchMix || {};
  const fbWhiff = parseFloat(mix['Fastball']?.whiffRate) || 0;
  const brkWhiff = Math.max(parseFloat(mix['Slider']?.whiffRate) || 0, parseFloat(mix['Curveball']?.whiffRate) || 0, parseFloat(mix['Breaking Ball']?.whiffRate) || 0);
  const zonePct = parseFloat(pitcherProfile.zoneProfile?.['Zone% (Heart+Shadow)']) || 0;
  const chasePct = parseFloat(pitcherProfile.zoneProfile?.['Chase%']) || 0;
  const kRate = parseFloat(pitcherProfile.K_rate) || 0;
  const fpk = parseFloat(pitcherProfile.firstPitchStrike) || 0;
  const hChase = parseFloat(hitterProfile.overallChaseRate) || 0;
  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: axes,
      datasets: [
        { label: pitcherProfile.name + ' (Pitcher)', data: [fbWhiff, brkWhiff, zonePct, chasePct, kRate, fpk], borderColor: '#E63946', backgroundColor: 'rgba(230,57,70,0.15)', pointBackgroundColor: '#E63946' },
        { label: hitterProfile.name + ' (Hitter)', data: [parseFloat(hitterProfile.resultsByPitchType?.['Fastball']?.whiffRate) || 0, hChase, 100 - hChase, hChase, parseFloat(hitterProfile.K_rate) || 0, 50], borderColor: '#3498DB', backgroundColor: 'rgba(52,152,219,0.15)', pointBackgroundColor: '#3498DB' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_TEXT } } },
      scales: { r: { angleLines: { color: CHART_GRID }, grid: { color: CHART_GRID }, pointLabels: { color: CHART_TEXT, font: { size: 10 } }, ticks: { color: CHART_TEXT, backdropColor: 'transparent' }, min: 0 } },
    },
  });
  return card;
}

// ===== CHART 20: TEAM OVERVIEW STATS =====
function chartTeamStatCards(teamSummary, pitcherProfiles) {
  if (!teamSummary) return null;
  const card = document.createElement('div');
  card.className = 'chart-card';
  const t = document.createElement('div');
  t.className = 'chart-card-title';
  t.textContent = `${teamSummary.team}: Staff Overview`;
  card.appendChild(t);

  const stats = document.createElement('div');
  stats.className = 'stat-cards';
  const pitchers = Object.keys(teamSummary.pitchers || {});
  const profiles = pitcherProfiles ? Object.values(pitcherProfiles) : [];
  const avgK = profiles.length > 0 ? (profiles.reduce((s, p) => s + (parseFloat(p?.K_rate) || 0), 0) / profiles.length).toFixed(1) + '%' : 'N/A';
  const avgBB = profiles.length > 0 ? (profiles.reduce((s, p) => s + (parseFloat(p?.BB_rate) || 0), 0) / profiles.length).toFixed(1) + '%' : 'N/A';

  [
    { val: pitchers.length, lbl: 'Pitchers' },
    { val: teamSummary.totalPitchesInData?.toLocaleString() || '0', lbl: 'Total Pitches' },
    { val: avgK, lbl: 'Avg K Rate' },
    { val: avgBB, lbl: 'Avg BB Rate' },
  ].forEach(s => {
    const sc = document.createElement('div');
    sc.className = 'stat-card';
    sc.innerHTML = `<div class="val">${s.val}</div><div class="lbl">${s.lbl}</div>`;
    stats.appendChild(sc);
  });
  card.appendChild(stats);
  return card;
}

// ===== CHART 21: PITCHER COMPARISON =====
function chartPitcherComparison(p1, p2) {
  if (!p1 || !p2) return null;
  const title = `${p1.name} vs ${p2.name}`;
  const { card, canvas } = makeCard(title);
  const cats = ['Avg FB Velo', 'K Rate%', 'BB Rate%', 'Whiff% (Best)', 'Zone%', '1st Pitch K%'];
  const bestWhiff = (p) => {
    const mix = p.pitchMix || {};
    return Math.max(...Object.values(mix).map(m => parseFloat(m.whiffRate) || 0));
  };
  const getData = (p) => [
    parseFloat(p.pitchMix?.['Fastball']?.avgVelo) || 0,
    parseFloat(p.K_rate) || 0, parseFloat(p.BB_rate) || 0,
    bestWhiff(p), parseFloat(p.zoneProfile?.['Zone% (Heart+Shadow)']) || 0,
    parseFloat(p.firstPitchStrike) || 0,
  ];
  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: cats,
      datasets: [
        { label: p1.name, data: getData(p1), borderColor: '#E63946', backgroundColor: 'rgba(230,57,70,0.15)', pointBackgroundColor: '#E63946' },
        { label: p2.name, data: getData(p2), borderColor: '#3498DB', backgroundColor: 'rgba(52,152,219,0.15)', pointBackgroundColor: '#3498DB' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_TEXT } } },
      scales: { r: { angleLines: { color: CHART_GRID }, grid: { color: CHART_GRID }, pointLabels: { color: CHART_TEXT, font: { size: 10 } }, ticks: { color: CHART_TEXT, backdropColor: 'transparent' }, min: 0 } },
    },
  });
  return card;
}

// ===== CHART 22: TWO-STRIKE PANEL =====
function chartTwoStrike(profile, pitches, label) {
  if (!pitches || pitches.length === 0) return null;
  const tsPitches = pitches.filter(r => parseInt(r.Strikes) === 2);
  if (tsPitches.length < 5) return null;
  const typeCounts = {};
  tsPitches.forEach(r => {
    const pt = normalizePitchType(r.PitchType);
    typeCounts[pt] = (typeCounts[pt] || 0) + 1;
  });
  const types = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
  const title = `${label || profile.name}: Two-Strike Approach (${tsPitches.length} pitches)`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: types.map(t => `${t} ${((typeCounts[t]/tsPitches.length)*100).toFixed(1)}%`),
      datasets: [{ data: types.map(t => typeCounts[t]), backgroundColor: types.map(getColor), borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'right', labels: { color: CHART_TEXT, font: { size: 11 } } } } },
  });
  return card;
}

// ===== CHART 10: FIRST PITCH =====
function chartFirstPitch(profile, pitches, label) {
  if (!pitches || pitches.length === 0) return null;
  const fpPitches = pitches.filter(r => parseInt(r.Balls) === 0 && parseInt(r.Strikes) === 0);
  if (fpPitches.length < 5) return null;
  const typeCounts = {};
  let strikes = 0;
  fpPitches.forEach(r => {
    const pt = normalizePitchType(r.PitchType);
    typeCounts[pt] = (typeCounts[pt] || 0) + 1;
    if ((r.PitchResult || '').includes('Strike')) strikes++;
  });
  const types = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
  const card = document.createElement('div');
  card.className = 'chart-card';
  const t = document.createElement('div');
  t.className = 'chart-card-title';
  t.textContent = `${label || profile.name}: First Pitch Tendencies`;
  card.appendChild(t);

  const statRow = document.createElement('div');
  statRow.className = 'stat-cards';
  statRow.innerHTML = `<div class="stat-card"><div class="val">${((strikes/fpPitches.length)*100).toFixed(1)}%</div><div class="lbl">1st Pitch Strike%</div></div>
    <div class="stat-card"><div class="val">${fpPitches.length}</div><div class="lbl">First Pitches</div></div>`;
  card.appendChild(statRow);

  const canvas = document.createElement('canvas');
  canvas.id = uid();
  canvas.style.height = '200px';
  card.appendChild(canvas);
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: types.map(t => `${t} ${((typeCounts[t]/fpPitches.length)*100).toFixed(1)}%`),
      datasets: [{ data: types.map(t => typeCounts[t]), backgroundColor: types.map(getColor), borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '50%', plugins: { legend: { position: 'right', labels: { color: CHART_TEXT, font: { size: 10 } } } } },
  });
  return card;
}

// ===== CHART 9: USAGE BY INNING =====
function chartUsageByInning(pitches, name) {
  if (!pitches || pitches.length === 0) return null;
  const byInning = {};
  pitches.forEach(row => {
    const inn = parseInt(row.Inning);
    const pt = normalizePitchType(row.PitchType);
    if (!inn) return;
    if (!byInning[inn]) byInning[inn] = {};
    byInning[inn][pt] = (byInning[inn][pt] || 0) + 1;
  });
  const innings = Object.keys(byInning).map(Number).sort((a, b) => a - b);
  if (innings.length < 2) return null;
  const allTypes = new Set();
  innings.forEach(i => Object.keys(byInning[i]).forEach(t => allTypes.add(t)));
  const types = [...allTypes];
  // Convert to percentages
  const title = `${name}: Pitch Usage by Inning`;
  const { card, canvas } = makeCard(title);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: innings.map(i => 'Inn ' + i),
      datasets: types.map(t => ({
        label: t,
        data: innings.map(i => {
          const total = Object.values(byInning[i]).reduce((a, b) => a + b, 0);
          return total > 0 ? ((byInning[i][t] || 0) / total * 100).toFixed(1) : 0;
        }),
        backgroundColor: getColor(t),
      })),
    },
    options: {
      ...defaultChartOpts(),
      scales: {
        x: { stacked: true, ticks: { color: CHART_TEXT }, grid: { display: false } },
        y: { stacked: true, max: 100, ticks: { color: CHART_TEXT, callback: v => v + '%' }, grid: { color: CHART_GRID } },
      },
    },
  });
  return card;
}

// ===== VISUALIZATION ROUTER =====
function generateCharts(question, contextType, contextData) {
  const q = question.toLowerCase();
  const charts = [];

  // Helper to add chart with null-check
  const add = (chart) => { if (chart) charts.push(chart); };

  // Pitcher focused
  if (contextType === 'opponent_pitcher' || contextType === 'moeller_pitcher') {
    const p = contextData.pitcher;
    const rawPitches = contextType === 'opponent_pitcher'
      ? (window.appStats?.opponentPitchers?.[p?.name]?.pitches)
      : (window.appStats?.moellerPitchers?.[p?.name]?.pitches);
    if (p) {
      add(chartPitchMixDonut(p));
      add(chartPitchMixByCount(p));
      add(chartVelocity(p));
      add(chartWhiffRate(p));
      add(chartAttackZone(p));
      if (rawPitches) add(chartZoneHeatmap(rawPitches, p.name));
      if (q.includes('everything') || q.includes('deep dive') || q.includes('full')) {
        if (rawPitches) {
          add(chartVeloByInning(rawPitches, p.name));
          add(chartUsageByInning(rawPitches, p.name));
          add(chartFirstPitch(p, rawPitches));
          add(chartTwoStrike(p, rawPitches));
        }
      }
      if (q.includes('velo') || q.includes('velocity') || q.includes('fatigue') || q.includes('stamina')) {
        if (rawPitches) add(chartVeloByInning(rawPitches, p.name));
      }
      if (q.includes('two strike') || q.includes('2-strike') || q.includes('2 strike') || q.includes('putaway') || q.includes('finish')) {
        if (rawPitches) add(chartTwoStrike(p, rawPitches));
      }
      if (q.includes('first pitch') || q.includes('1st pitch') || q.includes('start')) {
        if (rawPitches) add(chartFirstPitch(p, rawPitches));
      }
      if (q.includes('sequenc') || q.includes('inning')) {
        if (rawPitches) add(chartUsageByInning(rawPitches, p.name));
      }
    }
  }

  // Hitter focused
  if (contextType === 'moeller_hitter') {
    const h = contextData.hitter;
    const rawPitches = window.appStats?.moellerHitters?.[h?.name]?.pitches;
    if (h) {
      add(chartHitterByPitchType(h));
      add(chartHitterByCount(h));
      add(chartHitterSplits(h));
      if (rawPitches) add(chartHotColdZone(rawPitches, h.name));
    }
  }

  // Team / Game plan
  if (contextType === 'opponent_team' || contextType === 'game_plan') {
    const ts = contextData.teamSummary;
    const pitcherProfiles = contextData.opponentPitchers;
    if (ts) add(chartTeamStatCards(ts, pitcherProfiles));
    if (pitcherProfiles) {
      const pNames = Object.keys(pitcherProfiles);
      // Show charts for top 2 pitchers by pitch count
      pNames.sort((a, b) => (pitcherProfiles[b]?.totalPitches || 0) - (pitcherProfiles[a]?.totalPitches || 0));
      pNames.slice(0, 2).forEach(name => {
        const p = pitcherProfiles[name];
        if (p) {
          add(chartPitchMixDonut(p, name));
          add(chartPitchMixByCount(p, name));
          add(chartWhiffRate(p, name));
          const rawPitches = window.appStats?.opponentPitchers?.[name]?.pitches;
          if (rawPitches) add(chartZoneHeatmap(rawPitches, name));
        }
      });
    }
  }

  // Hitter group questions
  if (contextType === 'moeller_hitters') {
    const hitters = contextData.moellerHitters;
    if (hitters) {
      const names = Object.keys(hitters).filter(n => hitters[n]?.totalPA >= 5);
      names.sort((a, b) => (hitters[b]?.totalPA || 0) - (hitters[a]?.totalPA || 0));
      names.slice(0, 3).forEach(name => {
        add(chartHitterByPitchType(hitters[name], name));
      });
    }
  }

  // Moeller pitching staff
  if (contextType === 'moeller_pitching_staff') {
    const pitchers = contextData.moellerPitchers;
    if (pitchers) {
      const names = Object.keys(pitchers);
      names.sort((a, b) => (pitchers[b]?.totalPitches || 0) - (pitchers[a]?.totalPitches || 0));
      names.slice(0, 3).forEach(name => {
        add(chartPitchMixDonut(pitchers[name], name));
      });
    }
  }

  // Comparison
  if (q.includes('compare') || q.includes('vs') || q.includes('versus')) {
    const pitcherProfiles = contextData.opponentPitchers || contextData.moellerPitchers;
    if (pitcherProfiles) {
      const names = Object.keys(pitcherProfiles);
      if (names.length >= 2) {
        add(chartPitcherComparison(pitcherProfiles[names[0]], pitcherProfiles[names[1]]));
      }
    }
  }

  // Zone/location questions
  if (q.includes('zone') || q.includes('heatmap') || q.includes('location') || q.includes('command')) {
    if (contextData.pitcher) {
      const rawPitches = window.appStats?.opponentPitchers?.[contextData.pitcher.name]?.pitches
        || window.appStats?.moellerPitchers?.[contextData.pitcher.name]?.pitches;
      if (rawPitches) add(chartZoneHeatmap(rawPitches, contextData.pitcher.name));
    }
  }

  // General fallback
  if (charts.length === 0 && contextType === 'general') {
    // No specific charts for general questions
  }

  return charts;
}

function buildChartSection(charts) {
  if (charts.length === 0) return null;
  const section = document.createElement('div');
  section.className = 'chart-section';
  const toggle = document.createElement('button');
  toggle.className = 'chart-toggle';
  toggle.innerHTML = `<span class="arrow">&#9660;</span> Visual Breakdown (${charts.length} chart${charts.length > 1 ? 's' : ''})`;
  const container = document.createElement('div');
  container.className = 'chart-container';
  toggle.onclick = () => {
    container.classList.toggle('collapsed');
    toggle.querySelector('.arrow').classList.toggle('collapsed');
  };
  section.appendChild(toggle);
  charts.forEach(c => container.appendChild(c));
  section.appendChild(container);
  return section;
}
