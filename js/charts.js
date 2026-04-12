/* K2 — Simple SVG Charts */

const Charts = (() => {
  function barChart(container, data, { width = 300, height = 140, barColor = '#e94560', labelKey = 'date', valueKey = 'spectateurs', unit = '' } = {}) {
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem">Pas encore de donnees</p>';
      return;
    }

    const maxVal = Math.max(...data.map(d => d[valueKey] || 0), 1);
    const barWidth = Math.min(40, (width - 20) / data.length - 8);
    const chartHeight = height - 30;

    let bars = '';
    data.forEach((d, i) => {
      const val = d[valueKey] || 0;
      const barH = (val / maxVal) * chartHeight;
      const x = 10 + i * ((width - 20) / data.length) + ((width - 20) / data.length - barWidth) / 2;
      const y = chartHeight - barH;
      const opacity = d.annulee ? 0.3 : 1;
      const color = d.annulee ? '#6c757d' : barColor;
      const label = d[labelKey]?.slice(5) || '';  // MM-DD

      bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="4" fill="${color}" opacity="${opacity}"/>`;
      bars += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="700">${val}${unit}</text>`;
      bars += `<text x="${x + barWidth / 2}" y="${height - 2}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${label}</text>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
  }

  function leaderboard(container, artists, { maxItems = 10 } = {}) {
    if (!artists || artists.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem">Aucun artiste</p>';
      return;
    }

    const sorted = [...artists].sort((a, b) => b.count - a.count).slice(0, maxItems);
    const maxCount = sorted[0].count;

    container.innerHTML = sorted.map((a, i) => {
      const pct = Math.round(a.count / maxCount * 100);
      const medal = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '';
      return `<div class="leaderboard-row">
        <span class="lb-rank">${medal || (i + 1)}</span>
        <span class="lb-name">${a.name}${a.genre === 'F' ? ' <span class="badge-genre">F</span>' : ''}</span>
        <div class="lb-bar-bg"><div class="lb-bar-fill" style="width:${pct}%"></div></div>
        <span class="lb-count">${a.count}</span>
      </div>`;
    }).join('');
  }

  return { barChart, leaderboard };
})();
