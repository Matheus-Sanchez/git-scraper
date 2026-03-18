(function (globalScope) {
  function getContext(nodeOrContext) {
    if (!nodeOrContext) return null;
    if (typeof nodeOrContext.getContext === 'function') return nodeOrContext.getContext('2d');
    if (nodeOrContext.canvas && typeof nodeOrContext.clearRect === 'function') return nodeOrContext;
    return null;
  }

  function isFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function collectLineValues(datasets) {
    const values = [];
    datasets.forEach((dataset) => {
      (dataset.data || []).forEach((value) => {
        if (isFiniteNumber(value)) values.push(Number(value));
      });
    });
    return values;
  }

  function roundWithStep(value, step) {
    if (!isFiniteNumber(step) || step === 0) return Number(value);
    const decimals = Math.max(0, Math.ceil(-Math.log10(Math.abs(step))) + 2);
    return Number(Number(value).toFixed(decimals));
  }

  function niceNumber(range, round) {
    if (!isFiniteNumber(range) || range <= 0) return 1;

    const exponent = Math.floor(Math.log10(range));
    const fraction = range / (10 ** exponent);
    let niceFraction = 1;

    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else if (fraction <= 1) {
      niceFraction = 1;
    } else if (fraction <= 2) {
      niceFraction = 2;
    } else if (fraction <= 5) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }

    return niceFraction * (10 ** exponent);
  }

  function createNiceTicks(min, max, targetCount) {
    const lower = Number(min);
    const upper = Number(max);
    const safeTargetCount = clamp(Math.round(targetCount || 5), 2, 8);

    if (!isFiniteNumber(lower) || !isFiniteNumber(upper)) {
      return [0, 1];
    }

    if (lower === upper) {
      const padding = Math.max(1, Math.abs(lower) * 0.08);
      return [lower - padding, lower, lower + padding];
    }

    const range = niceNumber(upper - lower, false);
    const step = niceNumber(range / (safeTargetCount - 1), true);
    const niceMin = Math.floor(lower / step) * step;
    const niceMax = Math.ceil(upper / step) * step;
    const ticks = [];

    for (let value = niceMin; value <= niceMax + (step * 0.5); value += step) {
      ticks.push(roundWithStep(value, step));
    }

    return ticks;
  }

  function alphaColor(color, alpha) {
    const safeAlpha = clamp(Number(alpha), 0, 1);
    const value = String(color || '').trim();

    if (/^#([\da-f]{3}){1,2}$/i.test(value)) {
      const hex = value.slice(1);
      const normalized = hex.length === 3
        ? hex.split('').map((token) => token + token).join('')
        : hex;
      const numericValue = Number.parseInt(normalized, 16);
      const red = (numericValue >> 16) & 255;
      const green = (numericValue >> 8) & 255;
      const blue = numericValue & 255;
      return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`;
    }

    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
      const channels = rgbMatch[1].split(',').map((item) => item.trim()).slice(0, 3);
      if (channels.length === 3) {
        return `rgba(${channels.join(', ')}, ${safeAlpha})`;
      }
    }

    return value;
  }

  function formatCurrency(value) {
    return Number(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatAxisDate(value) {
    const label = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;

    const parsed = new Date(`${label}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return label;

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
    }).format(parsed).replace('.', '');
  }

  function createControlPoint(current, previous, next, reverse, smoothing) {
    const prior = previous || current;
    const following = next || current;
    const angle = Math.atan2(following.y - prior.y, following.x - prior.x) + (reverse ? Math.PI : 0);
    const length = Math.hypot(following.x - prior.x, following.y - prior.y) * smoothing;

    return {
      x: current.x + (Math.cos(angle) * length),
      y: current.y + (Math.sin(angle) * length),
    };
  }

  function traceLineSegment(ctx, segment, smoothing) {
    if (!segment.length) return;

    ctx.moveTo(segment[0].x, segment[0].y);
    if (segment.length === 1) return;

    for (let index = 0; index < segment.length - 1; index += 1) {
      const current = segment[index];
      const next = segment[index + 1];

      if (!smoothing) {
        ctx.lineTo(next.x, next.y);
        continue;
      }

      const previous = segment[index - 1];
      const following = segment[index + 2];
      const cp1 = createControlPoint(current, previous, next, false, smoothing);
      const cp2 = createControlPoint(next, current, following, true, smoothing);

      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, next.x, next.y);
    }
  }

  function splitPoints(points, spanGaps) {
    if (spanGaps) {
      return [points.filter(Boolean)];
    }

    const segments = [];
    let currentSegment = [];

    points.forEach((point) => {
      if (!point) {
        if (currentSegment.length) segments.push(currentSegment);
        currentSegment = [];
        return;
      }

      currentSegment.push(point);
    });

    if (currentSegment.length) segments.push(currentSegment);
    return segments;
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
  }

  class TinyChart {
    constructor(nodeOrContext, config) {
      this.ctx = getContext(nodeOrContext);
      if (!this.ctx) throw new Error('Chart: invalid canvas context');

      this.canvas = this.ctx.canvas;
      this.config = config || {};
      this.chartArea = null;
      this.datasetMeta = [];
      this.activeHover = null;
      this.handleCanvasClick = this.handleCanvasClick.bind(this);
      this.canvas.addEventListener('click', this.handleCanvasClick);
      this.draw();
    }

    destroy() {
      this.canvas.removeEventListener('click', this.handleCanvasClick);
      this.chartArea = null;
      this.datasetMeta = [];
      this.activeHover = null;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    update() {
      this.draw();
    }

    getDatasetMeta(index) {
      return this.datasetMeta[index] || { data: [], hidden: true };
    }

    setActiveHover(activeHover) {
      const nextHover = activeHover ? {
        datasetIndex: activeHover.datasetIndex,
        x: Number(activeHover.x),
        y: Number(activeHover.y),
      } : null;

      const current = this.activeHover;
      const changed = !current !== !nextHover
        || (current && nextHover && (
          current.datasetIndex !== nextHover.datasetIndex
          || current.x !== nextHover.x
          || current.y !== nextHover.y
        ));

      if (!changed) return;
      this.activeHover = nextHover;
      this.draw();
    }

    handleCanvasClick(nativeEvent) {
      const onClick = this.config?.options?.onClick;
      if (typeof onClick !== 'function') return;

      const rect = this.canvas.getBoundingClientRect();
      onClick({
        x: nativeEvent.clientX - rect.left,
        y: nativeEvent.clientY - rect.top,
        native: nativeEvent,
      }, [], this);
    }

    prepareSurface() {
      const bounds = this.canvas.getBoundingClientRect();
      const cssWidth = Math.max(10, Math.round(bounds.width || this.canvas.clientWidth || this.canvas.width || 300));
      const cssHeight = Math.max(10, Math.round(bounds.height || this.canvas.clientHeight || this.canvas.height || 150));
      const pixelRatio = clamp(globalScope.devicePixelRatio || 1, 1, 2);
      const internalWidth = Math.round(cssWidth * pixelRatio);
      const internalHeight = Math.round(cssHeight * pixelRatio);

      if (this.canvas.width !== internalWidth) this.canvas.width = internalWidth;
      if (this.canvas.height !== internalHeight) this.canvas.height = internalHeight;

      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      return {
        width: cssWidth,
        height: cssHeight,
      };
    }

    draw() {
      const type = this.config.type || 'line';
      if (type === 'pie') {
        this.drawPie();
        return;
      }

      this.drawLine();
    }

    drawLine() {
      const data = this.config.data || {};
      const options = this.config.options || {};
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];
      const { width, height } = this.prepareSurface();
      const ctx = this.ctx;

      ctx.fillStyle = '#fffdfb';
      ctx.fillRect(0, 0, width, height);

      const allValues = collectLineValues(datasets);
      const yScale = options.scales?.y || {};
      const xScale = options.scales?.x || {};
      const beginAtZero = Boolean(yScale.beginAtZero);
      const maxTicksLimit = clamp(Number(yScale.ticks?.maxTicksLimit || 5), 3, 7);
      const xTickLimit = clamp(Number(xScale.ticks?.maxTicksLimit || 6), 3, 8);
      const yTickFormatter = typeof yScale.ticks?.callback === 'function'
        ? (value) => yScale.ticks.callback(value)
        : (value) => formatCurrency(value);
      const xTickFormatter = typeof xScale.ticks?.callback === 'function'
        ? (value) => xScale.ticks.callback(value)
        : (value) => formatAxisDate(value);

      if (allValues.length === 0) {
        ctx.fillStyle = '#5b6b66';
        ctx.font = '13px Segoe UI, sans-serif';
        ctx.fillText('Sem dados para o periodo selecionado.', 22, 30);
        this.chartArea = null;
        this.datasetMeta = [];
        return;
      }

      let min = Math.min(...allValues);
      let max = Math.max(...allValues);

      if (min === max) {
        const padding = Math.max(1, Math.abs(min) * 0.08);
        min -= padding;
        max += padding;
      } else {
        const padding = (max - min) * 0.1;
        min -= padding;
        max += padding;
      }

      if (beginAtZero && min > 0) min = 0;
      if (allValues.every((value) => Number(value) >= 0) && min < 0) min = 0;

      const yTicks = createNiceTicks(min, max, maxTicksLimit);
      const domainMin = yTicks[0];
      const domainMax = yTicks[yTicks.length - 1];
      const domainSpan = Math.max(domainMax - domainMin, 1);

      const pad = {
        top: 18,
        right: datasets.length === 1 ? 98 : 26,
        bottom: 42,
        left: 78,
      };
      const chartWidth = Math.max(10, width - pad.left - pad.right);
      const chartHeight = Math.max(10, height - pad.top - pad.bottom);

      this.chartArea = {
        left: pad.left,
        top: pad.top,
        right: pad.left + chartWidth,
        bottom: pad.top + chartHeight,
      };

      drawRoundedRect(ctx, this.chartArea.left, this.chartArea.top, chartWidth, chartHeight, 16);
      ctx.fillStyle = '#fffdfd';
      ctx.fill();
      ctx.strokeStyle = '#e8ded0';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = '#e7ece9';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#61706a';

      yTicks.forEach((tickValue) => {
        const ratio = 1 - ((tickValue - domainMin) / domainSpan);
        const y = this.chartArea.top + (ratio * chartHeight);

        ctx.beginPath();
        ctx.moveTo(this.chartArea.left, y);
        ctx.lineTo(this.chartArea.right, y);
        ctx.stroke();

        ctx.fillText(String(yTickFormatter(tickValue)), this.chartArea.left - 12, y);
      });

      ctx.setLineDash([]);
      ctx.strokeStyle = '#d7dfda';
      ctx.beginPath();
      ctx.moveTo(this.chartArea.left, this.chartArea.bottom);
      ctx.lineTo(this.chartArea.right, this.chartArea.bottom);
      ctx.stroke();

      const stepX = labels.length > 1 ? chartWidth / (labels.length - 1) : 0;
      const xLabelIndices = new Set([0, Math.max(0, labels.length - 1)]);
      const xStep = Math.max(1, Math.ceil(labels.length / xTickLimit));
      for (let index = 0; index < labels.length; index += xStep) {
        xLabelIndices.add(index);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#61706a';

      [...xLabelIndices].sort((left, right) => left - right).forEach((index) => {
        const x = labels.length <= 1
          ? this.chartArea.left + (chartWidth / 2)
          : this.chartArea.left + (index * stepX);
        const label = xTickFormatter(labels[index], index);
        ctx.fillText(String(label), clamp(x, this.chartArea.left + 24, this.chartArea.right - 24), this.chartArea.bottom + 12);
      });

      const activeDatasetIndex = this.activeHover?.datasetIndex;
      const sortedDatasetEntries = datasets
        .map((dataset, datasetIndex) => ({ dataset, datasetIndex }))
        .sort((left, right) => {
          if (left.datasetIndex === activeDatasetIndex) return 1;
          if (right.datasetIndex === activeDatasetIndex) return -1;
          return left.datasetIndex - right.datasetIndex;
        });

      this.datasetMeta = datasets.map((dataset) => ({
        hidden: Boolean(dataset.hidden),
        label: dataset.label,
        data: Array.isArray(dataset.data) ? dataset.data.map(() => null) : [],
      }));

      sortedDatasetEntries.forEach(({ dataset, datasetIndex }) => {
        const values = Array.isArray(dataset.data) ? dataset.data : [];
        const lineColor = dataset.borderColor || '#0f7a62';
        const isActive = activeDatasetIndex === datasetIndex;
        const deEmphasize = activeDatasetIndex !== null && activeDatasetIndex !== undefined && !isActive;
        const lineOpacity = clamp(Number(dataset.lineOpacity ?? (deEmphasize ? 0.28 : 0.94)), 0.1, 1);
        const strokeWidth = Number(dataset.borderWidth || 2.5) + (isActive ? 0.9 : 0);
        const smoothing = clamp(Number(dataset.tension || 0.2), 0, 0.45) * 0.28;
        const points = values.map((rawValue, index) => {
          if (!isFiniteNumber(rawValue)) return null;
          const numericValue = Number(rawValue);
          const x = labels.length <= 1
            ? this.chartArea.left + (chartWidth / 2)
            : this.chartArea.left + (index * stepX);
          const y = this.chartArea.top + (1 - ((numericValue - domainMin) / domainSpan)) * chartHeight;

          return { x, y, value: numericValue, index };
        });
        const segments = splitPoints(points, Boolean(dataset.spanGaps))
          .filter((segment) => segment.length > 0);

        this.datasetMeta[datasetIndex] = {
          hidden: Boolean(dataset.hidden),
          label: dataset.label,
          data: points,
        };

        if (segments.length && Number(dataset.fillOpacity || 0) > 0) {
          const fillOpacity = deEmphasize ? Number(dataset.fillOpacity || 0) * 0.5 : Number(dataset.fillOpacity || 0);

          segments.forEach((segment) => {
            if (segment.length < 2) return;

            const gradient = ctx.createLinearGradient(0, this.chartArea.top, 0, this.chartArea.bottom);
            gradient.addColorStop(0, alphaColor(lineColor, clamp(fillOpacity, 0.02, 0.28)));
            gradient.addColorStop(1, alphaColor(lineColor, 0));

            ctx.beginPath();
            ctx.moveTo(segment[0].x, this.chartArea.bottom);
            ctx.lineTo(segment[0].x, segment[0].y);
            traceLineSegment(ctx, segment, smoothing);
            ctx.lineTo(segment[segment.length - 1].x, this.chartArea.bottom);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
          });
        }

        ctx.strokeStyle = alphaColor(lineColor, lineOpacity);
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        segments.forEach((segment) => {
          if (!segment.length) return;

          ctx.beginPath();
          traceLineSegment(ctx, segment, smoothing);
          ctx.stroke();
        });

        const pointRadius = Number(dataset.pointRadius || 0);
        if (pointRadius > 0) {
          ctx.fillStyle = alphaColor(dataset.backgroundColor || lineColor, deEmphasize ? 0.35 : 1);

          points.forEach((point) => {
            if (!point) return;
            ctx.beginPath();
            ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        if (dataset.highlightLastPoint !== false) {
          const lastPoint = [...points].reverse().find(Boolean);
          if (lastPoint) {
            const outerRadius = Number(dataset.lastPointRadius || 4.8) + (isActive ? 1 : 0);

            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, outerRadius + 2.6, 0, Math.PI * 2);
            ctx.fillStyle = alphaColor(lineColor, deEmphasize ? 0.12 : 0.18);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, outerRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = alphaColor(lineColor, deEmphasize ? 0.45 : 1);
            ctx.stroke();
          }
        }

        if (dataset.showLatestPrice && datasets.length === 1) {
          const lastPoint = [...points].reverse().find(Boolean);
          if (lastPoint) {
            const badgeText = formatCurrency(lastPoint.value);
            ctx.font = '600 11px Segoe UI, sans-serif';
            const badgeWidth = ctx.measureText(badgeText).width + 18;
            const badgeHeight = 24;
            const badgeX = width - badgeWidth - 12;
            const badgeY = clamp(lastPoint.y - (badgeHeight / 2), this.chartArea.top + 4, this.chartArea.bottom - badgeHeight - 4);

            ctx.beginPath();
            ctx.moveTo(lastPoint.x + 8, lastPoint.y);
            ctx.lineTo(badgeX - 6, lastPoint.y);
            ctx.strokeStyle = alphaColor(lineColor, 0.28);
            ctx.lineWidth = 1.5;
            ctx.stroke();

            drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 12);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = alphaColor(lineColor, 0.32);
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = lineColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, badgeX + (badgeWidth / 2), badgeY + (badgeHeight / 2) + 0.5);
          }
        }
      });

      if (this.activeHover && this.chartArea) {
        const hoverX = clamp(Number(this.activeHover.x), this.chartArea.left, this.chartArea.right);
        const hoverY = clamp(Number(this.activeHover.y), this.chartArea.top, this.chartArea.bottom);
        const hoverColor = datasets[this.activeHover.datasetIndex]?.borderColor || '#0f7a62';

        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(hoverX, this.chartArea.top);
        ctx.lineTo(hoverX, this.chartArea.bottom);
        ctx.strokeStyle = alphaColor('#3f5b54', 0.32);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(hoverX, hoverY, 5.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = hoverColor;
        ctx.stroke();
      }
    }

    drawPie() {
      const data = this.config.data || {};
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];
      const primary = datasets[0] || { data: [] };
      const values = (primary.data || []).map((value) => Number(value));
      const colors = Array.isArray(primary.backgroundColor) ? primary.backgroundColor : [];
      const { width, height } = this.prepareSurface();
      const ctx = this.ctx;

      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, width, height);

      const validValues = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
      const total = validValues.reduce((sum, value) => sum + value, 0);
      if (total <= 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillText('Sem dados de categoria.', 22, 30);
        return;
      }

      const centerX = width * 0.34;
      const centerY = height * 0.52;
      const radius = Math.min(width, height) * 0.3;
      let start = -Math.PI / 2;

      validValues.forEach((value, index) => {
        if (value <= 0) return;

        const ratio = value / total;
        const end = start + ratio * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = colors[index] || '#0f7a62';
        ctx.fill();
        start = end;
      });

      ctx.fillStyle = '#1f2937';
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Total: ${total}`, centerX, centerY);

      ctx.font = '12px Segoe UI, sans-serif';
      ctx.textAlign = 'left';
      labels.forEach((label, index) => {
        const y = 28 + index * 20;
        ctx.fillStyle = colors[index] || '#0f7a62';
        ctx.fillRect(width * 0.62, y - 8, 10, 10);
        ctx.fillStyle = '#334155';
        ctx.fillText(`${label} (${validValues[index] || 0})`, width * 0.62 + 16, y);
      });
    }
  }

  globalScope.Chart = TinyChart;
})(typeof window !== 'undefined' ? window : globalThis);
