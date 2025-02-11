export const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .timestamp {
      color: #666;
      font-size: 0.9em;
    }
    .section {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
      margin-bottom: 30px;
    }
    .section h2 {
      color: #1a73e8;
      margin-top: 0;
    }
    .chart-container {
      position: relative;
      height: 300px;
      margin: 20px 0;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .metric-card {
      background: #f8f9fa;
      border-radius: 6px;
      padding: 15px;
    }
    .metric-card h3 {
      margin: 0 0 10px;
      color: #202124;
      font-size: 1em;
    }
    .metric-card p {
      margin: 0;
      font-size: 1.2em;
      font-weight: 500;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: 500;
    }
    .status-badge.success { background: #e6f4ea; color: #137333; }
    .status-badge.warning { background: #fef7e0; color: #b06000; }
    .status-badge.error { background: #fce8e6; color: #c5221f; }
    @media (max-width: 768px) {
      .metric-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>{{title}}</h1>
    <p class="timestamp">生成时间: {{timestamp}}</p>
    <p>统计周期: {{period}}</p>
  </div>

  {{#if includePerformance}}
  <div class="section">
    <h2>性能概览</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>平均响应时间</h3>
        <p>{{performance.avgResponseTime}}ms</p>
      </div>
      <div class="metric-card">
        <h3>错误率</h3>
        <p>{{performance.errorRate}}%</p>
      </div>
      <div class="metric-card">
        <h3>吞吐量</h3>
        <p>{{performance.throughput}}/秒</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="performanceChart"></canvas>
    </div>
  </div>
  {{/if}}

  {{#if includeErrors}}
  <div class="section">
    <h2>错误分析</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>总错误数</h3>
        <p>{{errors.totalCount}}</p>
      </div>
      <div class="metric-card">
        <h3>严重错误</h3>
        <p>{{errors.criticalCount}}</p>
      </div>
      <div class="metric-card">
        <h3>已解决</h3>
        <p>{{errors.resolvedCount}}</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="errorChart"></canvas>
    </div>
  </div>
  {{/if}}

  {{#if includeConsistency}}
  <div class="section">
    <h2>一致性检查</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>检查总数</h3>
        <p>{{consistency.totalChecks}}</p>
      </div>
      <div class="metric-card">
        <h3>通过率</h3>
        <p>{{consistency.passRate}}%</p>
      </div>
      <div class="metric-card">
        <h3>待处理问题</h3>
        <p>{{consistency.pendingIssues}}</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="consistencyChart"></canvas>
    </div>
  </div>
  {{/if}}

  <script>
    {{#if includeCharts}}
    // 性能图表
    new Chart(document.getElementById('performanceChart'), {
      type: 'line',
      data: {{performanceData}},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: '响应时间趋势'
          }
        }
      }
    });

    // 错误分布图表
    new Chart(document.getElementById('errorChart'), {
      type: 'bar',
      data: {{errorData}},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: '错误分布'
          }
        }
      }
    });

    // 一致性检查图表
    new Chart(document.getElementById('consistencyChart'), {
      type: 'radar',
      data: {{consistencyData}},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: '一致性检查状态'
          }
        }
      }
    });
    {{/if}}
  </script>
</body>
</html>
`
