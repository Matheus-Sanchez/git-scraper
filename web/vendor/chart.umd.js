(function (globalScope) {
  function getContext(nodeOrContext) {
    if (!nodeOrContext) return null;
    if (typeof nodeOrContext.getContext === 'function') return nodeOrContext.getContext('2d');
    if (nodeOrContext.canvas && typeof nodeOrContext.clearRect === 'function') return nodeOrContext;
    return null;
  }

  function isFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n);
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

  class TinyChart {
    constructor(nodeOrContext, config) {
      this.ctx = getContext(nodeOrContext);
      if (!this.ctx) throw new Error('Chart: invalid canvas context');
      this.canvas = this.ctx.canvas;
      this.config = config || {};
      this.draw();
    }

    destroy() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    update() {
      this.draw();
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
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];

      const ctx = this.ctx;
      const { width, height } = this.canvas;
      const pad = { top: 24, right: 24, bottom: 42, left: 68 };
      const chartWidth = Math.max(10, width - pad.left - pad.right);
      const chartHeight = Math.max(10, height - pad.top - pad.bottom);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#d7d7d7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, height - pad.bottom);
      ctx.lineTo(width - pad.right, height - pad.bottom);
      ctx.stroke();

      const allValues = collectLineValues(datasets);
      if (allValues.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillText('Sem dados para o periodo selecionado.', pad.left + 8, pad.top + 20);
        return;
      }

      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      const span = Math.max(1, max - min);
      const gridLines = 4;

      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillStyle = '#4b5563';

      for (let i = 0; i <= gridLines; i += 1) {
        const ratio = i / gridLines;
        const y = pad.top + ratio * chartHeight;
        ctx.strokeStyle = '#efefef';
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();

        const value = max - ratio * span;
        ctx.fillText(`R$ ${value.toFixed(2)}`, 10, y + 4);
      }

      const pointCount = Math.max(labels.length, 2);
      const stepX = pointCount > 1 ? chartWidth / (pointCount - 1) : 0;

      datasets.forEach((dataset) => {
        const dataPoints = Array.isArray(dataset.data) ? dataset.data : [];
        const color = dataset.borderColor || '#0f766e';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let drawing = false;
        dataPoints.forEach((rawValue, index) => {
          const value = Number(rawValue);
          if (!Number.isFinite(value)) {
            drawing = false;
            return;
          }

          const x = pad.left + index * stepX;
          const y = pad.top + (1 - ((value - min) / span)) * chartHeight;

          if (!drawing) {
            ctx.moveTo(x, y);
            drawing = true;
          } else {
            ctx.lineTo(x, y);
          }
        });

        ctx.stroke();

        ctx.fillStyle = dataset.backgroundColor || color;
        dataPoints.forEach((rawValue, index) => {
          const value = Number(rawValue);
          if (!Number.isFinite(value)) return;
          const x = pad.left + index * stepX;
          const y = pad.top + (1 - ((value - min) / span)) * chartHeight;
          ctx.beginPath();
          ctx.arc(x, y, 2.8, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      const labelStep = Math.max(1, Math.ceil(labels.length / 6));
      ctx.fillStyle = '#4b5563';
      for (let i = 0; i < labels.length; i += labelStep) {
        const x = pad.left + i * stepX;
        const label = String(labels[i] || '').slice(0, 10);
        ctx.fillText(label, clamp(x - 20, 2, width - 90), height - 14);
      }
    }

    drawPie() {
      const data = this.config.data || {};
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];
      const primary = datasets[0] || { data: [] };
      const values = (primary.data || []).map((value) => Number(value));
      const colors = Array.isArray(primary.backgroundColor) ? primary.backgroundColor : [];

      const ctx = this.ctx;
      const { width, height } = this.canvas;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
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
        ctx.fillStyle = colors[index] || '#0f766e';
        ctx.fill();
        start = end;
      });

      ctx.fillStyle = '#1f2937';
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(`Total: ${total}`, centerX - 28, centerY + 5);

      ctx.font = '12px Segoe UI, sans-serif';
      labels.forEach((label, index) => {
        const y = 28 + index * 20;
        ctx.fillStyle = colors[index] || '#0f766e';
        ctx.fillRect(width * 0.62, y - 8, 10, 10);
        ctx.fillStyle = '#334155';
        ctx.fillText(`${label} (${validValues[index] || 0})`, width * 0.62 + 16, y);
      });
    }
  }

  globalScope.Chart = TinyChart;
})(typeof window !== 'undefined' ? window : globalThis);
