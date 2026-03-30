/* K2 — Simple SVG Charts */

const Charts = (() => {
  function barChart(container, data, { width = 300, height = 140, barColor = '#e94560', labelKey = 'date', valueKey = 'spectateurs' } = {}) {
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
      bars += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="700">${val}</text>`;
      bars += `<text x="${x + barWidth / 2}" y="${height - 2}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${label}</text>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
  }

  return { barChart };
})();
