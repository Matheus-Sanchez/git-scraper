(function (globalScope) {
  function getContext(nodeOrContext) {
    if (!nodeOrContext) return null;
    if (typeof nodeOrContext.getContext === 'function') {
      return nodeOrContext.getContext('2d');
    }
    if (nodeOrContext.canvas && typeof nodeOrContext.clearRect === 'function') {
      return nodeOrContext;
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class TinyLineChart {
    constructor(nodeOrContext, config) {
      this.ctx = getContext(nodeOrContext);
      if (!this.ctx) {
        throw new Error('Chart: invalid canvas context');
      }
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
      const data = this.config.data || {};
      const labels = Array.isArray(data.labels) ? data.labels : [];
      const datasets = Array.isArray(data.datasets) ? data.datasets : [];
      const primary = datasets[0] || { data: [] };
      const values = (primary.data || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));

      const ctx = this.ctx;
      const { width, height } = this.canvas;
      const pad = { top: 24, right: 20, bottom: 42, left: 64 };
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

      if (values.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.fillText('Sem dados para o periodo selecionado.', pad.left + 8, pad.top + 20);
        return;
      }

      const min = Math.min(...values);
      const max = Math.max(...values);
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
        ctx.fillText(`R$ ${value.toFixed(2)}`, 8, y + 4);
      }

      const pointCount = values.length;
      const stepX = pointCount > 1 ? chartWidth / (pointCount - 1) : 0;

      ctx.strokeStyle = primary.borderColor || '#0f766e';
      ctx.lineWidth = 2;
      ctx.beginPath();

      values.forEach((value, index) => {
        const x = pad.left + index * stepX;
        const y = pad.top + (1 - (value - min) / span) * chartHeight;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();

      ctx.fillStyle = primary.backgroundColor || '#0f766e';
      values.forEach((value, index) => {
        const x = pad.left + index * stepX;
        const y = pad.top + (1 - (value - min) / span) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      const labelStep = Math.max(1, Math.ceil(labels.length / 6));
      ctx.fillStyle = '#4b5563';
      for (let i = 0; i < labels.length; i += labelStep) {
        const x = pad.left + i * stepX;
        const label = String(labels[i] || '').slice(0, 10);
        ctx.fillText(label, clamp(x - 18, 2, width - 80), height - 14);
      }

      if (primary.label) {
        ctx.fillStyle = '#0f172a';
        ctx.font = '13px Segoe UI, sans-serif';
        ctx.fillText(primary.label, pad.left + 6, 16);
      }
    }
  }

  globalScope.Chart = TinyLineChart;
})(typeof window !== 'undefined' ? window : globalThis);