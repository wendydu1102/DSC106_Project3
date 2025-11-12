// D3 v7
const files = {
  subset: 'data/cmip6_subset.csv',
  byVar: 'data/cmip6_summary_by_var.csv',
  byMatrix: 'data/cmip6_summary_matrix.csv',
  byYear: 'data/cmip6_year_hist.csv'
};

const state = {
  experiments: new Set(['historical','ssp126','ssp245','ssp370','ssp585']),
  variables: new Set(['tas','tasmax','tasmin','pr','psl','tos','siconc','sos']),
  yearRange: null, 
  modelSearch: ''
};

// Utility
const fmt = d3.format(',');

function unique(values){ return Array.from(new Set(values)); }

function renderCheckboxes(sel, options, checkedSet, onChange){
  const div = d3.select(sel);
  const labels = div.selectAll('label').data(options, d=>d);
  const enter = labels.enter().append('label');
  enter.append('input')
    .attr('type','checkbox')
    .attr('value', d=>d)
    .property('checked', d=>checkedSet.has(d))
    .on('change', function() {
      const v = this.value;
      if (this.checked) checkedSet.add(v); else checkedSet.delete(v);
      onChange();
    });
  enter.append('span').text(d=>` ${d}`);
  labels.exit().remove();
}

// Load all data then build
Promise.all([
  d3.csv(files.subset, d3.autoType),
  d3.csv(files.byVar, d3.autoType),
  d3.csv(files.byMatrix, d3.autoType),
  d3.csv(files.byYear, d3.autoType)
]).then(([subset, byVar, byMatrix, byYear]) => {
  // Controls
  const experiments = unique(subset.map(d => d.experiment_id)).sort();
  const variables = unique(subset.map(d => d.variable_id)).sort();

  renderCheckboxes('#experiment-filters', experiments, state.experiments, updateAll);
  renderCheckboxes('#variable-filters', variables, state.variables, updateAll);

  d3.select('#model-search').on('input', (e)=>{
    state.modelSearch = e.target.value.trim().toLowerCase();
    updateAll();
  });

  d3.select('#reset-btn').on('click', ()=>{
    state.experiments = new Set(experiments);
    state.variables = new Set(variables);
    state.yearRange = null;
    state.modelSearch = '';
    d3.select('#model-search').property('value','');
    renderCheckboxes('#experiment-filters', experiments, state.experiments, updateAll);
    renderCheckboxes('#variable-filters', variables, state.variables, updateAll);
    updateAll();
  });

  // Charts
  const treemapSel = d3.select('#treemap');
  const heatmapSel = d3.select('#heatmap');
  const yearSel = d3.select('#year-hist');

  // Tooltip
  const tooltip = d3.select('body').append('div').attr('class','tooltip').style('opacity',0);

  function showTip(html, event){
    tooltip.html(html).style('opacity',1)
      .style('left', (event.pageX+12)+'px')
      .style('top', (event.pageY+12)+'px');
  }
  function hideTip(){ tooltip.style('opacity',0); }

  // Year histogram + brush
  const marginY = {top:20,right:20,bottom:30,left:40}, WY = +yearSel.attr('width'), HY = +yearSel.attr('height');
  const innerWY = WY - marginY.left - marginY.right, innerHY = HY - marginY.top - marginY.bottom;
  const gY = yearSel.append('g').attr('transform', `translate(${marginY.left},${marginY.top})`);
  const years = byYear.map(d=>d.year);
  const xY = d3.scaleLinear().domain(d3.extent(years)).nice().range([0, innerWY]);
  const bins = d3.bin().domain(xY.domain()).thresholds(xY.ticks(40))(byYear.flatMap(d => Array(d.count).fill(d.year)));
  const yY = d3.scaleLinear().domain([0, d3.max(bins, d=>d.length)]).nice().range([innerHY, 0]);

  gY.append('g').attr('class','axis').attr('transform', `translate(0,${innerHY})`).call(d3.axisBottom(xY).ticks(10).tickFormat(d3.format('d')));
  gY.append('g').attr('class','axis').call(d3.axisLeft(yY));
  const bars = gY.selectAll('.bar').data(bins).join('rect')
    .attr('class','bar')
    .attr('x', d=>xY(d.x0)+1).attr('y', d=>yY(d.length))
    .attr('width', d=>Math.max(0, xY(d.x1)-xY(d.x0)-1)).attr('height', d=>innerHY - yY(d.length))
    .attr('fill', '#4f46e5')
    .on('mousemove', (event, d)=> showTip(`${d.x0}–${d.x1-1}: <b>${fmt(d.length)}</b>`, event))
    .on('mouseleave', hideTip);

  const brush = d3.brushX().extent([[0,0],[innerWY, innerHY]]).on('end', ({selection})=>{
    if (!selection) { state.yearRange = null; updateAll(); return; }
    const [x0, x1] = selection.map(xY.invert);
    state.yearRange = [Math.floor(x0), Math.floor(x1)];
    updateAll();
  });
  gY.append('g').attr('class','brush').call(brush);

  // Heatmap scaffolding
  const marginH = {top:30,right:10,bottom:60,left:160}, WH = +heatmapSel.attr('width'), HH = +heatmapSel.attr('height');
  const innerWH = WH - marginH.left - marginH.right, innerHH = HH - marginH.top - marginH.bottom;
  const gH = heatmapSel.append('g').attr('transform', `translate(${marginH.left},${marginH.top})`);

  function updateAll(){
    const yearFilter = state.yearRange;
    const modelSearch = state.modelSearch;

    // Filter subset
    let filtered = subset.filter(d => state.experiments.has(d.experiment_id) && state.variables.has(d.variable_id));
    if (yearFilter){
      filtered = filtered.filter(d => d.version >= yearFilter[0] && d.version <= yearFilter[1]);
    }
    if (modelSearch){
      filtered = filtered.filter(d => d.source_id.toLowerCase().includes(modelSearch));
    }

    // Treemap data
    const countsByVar = d3.rollup(filtered, v => v.length, d => d.variable_id);
    const treeData = { name: 'root', children: Array.from(countsByVar, ([k, v]) => ({name:k, value:v})) };
    drawTreemap(treeData);

    // Heatmap aggregation: count variables for each (model, experiment)
    const agg = d3.rollup(filtered, v => new Set(v.map(d => d.variable_id)).size, d => d.source_id, d => d.experiment_id);
    drawHeatmap(agg, filtered);
  }

  function drawTreemap(treeData){
    const width = +treemapSel.attr('width'), height = +treemapSel.attr('height');
    treemapSel.selectAll('*').remove();
    const root = d3.hierarchy(treeData).sum(d => d.value).sort((a,b)=>b.value-a.value);
    d3.treemap().size([width, height]).padding(2)(root);
    const nodes = treemapSel.selectAll('g').data(root.leaves()).join('g').attr('transform', d => `translate(${d.x0},${d.y0})`);

    nodes.append('rect')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', '#22c55e')
      .on('mousemove', (event,d)=> showTip(`${d.data.name}: <b>${fmt(d.value)}</b> stores`, event))
      .on('mouseleave', hideTip)
      .on('click', (_, d)=>{
        // Toggle variable filter to the clicked variable
        state.variables = new Set([d.data.name]);
        renderCheckboxes('#variable-filters', Array.from(state.variables), state.variables, updateAll);
        updateAll();
      });

    nodes.append('text')
      .attr('dx', 6).attr('dy', 16)
      .text(d => `${d.data.name} (${fmt(d.value)})`)
      .attr('font-size', '12px')
      .attr('pointer-events','none');
  }

  function drawHeatmap(agg, filteredRows){
    gH.selectAll('*').remove();

    const models = Array.from(agg.keys()).sort();
    const exps = Array.from(state.experiments).sort();

    const x = d3.scaleBand().domain(exps).range([0, innerWH]).padding(0.05);
    const y = d3.scaleBand().domain(models).range([0, innerHH]).padding(0.05);

    const values = [];
    for (const m of models){
      const row = agg.get(m) || new Map();
      for (const e of exps){
        const val = row.get(e) || 0;
        values.push({model:m, exp:e, val});
      }
    }
    const maxVal = d3.max(values, d => d.val) || 0;
    const color = d3.scaleSequential(d3.interpolateYlGnBu).domain([0, maxVal || 1]);

    // axes
    gH.append('g').attr('class','axis').call(d3.axisLeft(y).tickSize(0)).selectAll('text').style('font-size','10px');
    gH.append('g').attr('class','axis').attr('transform', `translate(0,${innerHH})`).call(d3.axisBottom(x)).selectAll('text').style('font-size','10px').attr('transform','rotate(-20)').style('text-anchor','end');

    // cells
    gH.selectAll('rect.cell').data(values).join('rect')
      .attr('class','cell')
      .attr('x', d=>x(d.exp)).attr('y', d=>y(d.model))
      .attr('width', x.bandwidth()).attr('height', y.bandwidth())
      .attr('fill', d=>color(d.val))
      .on('mousemove', (event,d)=> showTip(`${d.model} × ${d.exp}<br/>Variables: <b>${fmt(d.val)}</b>`, event))
      .on('mouseleave', hideTip)
      .on('click', (_, d)=>{
        // Show matching rows in details table
        const rows = filteredRows.filter(r => r.source_id === d.model && r.experiment_id === d.exp);
        renderTable(rows.slice(0,50));
      });

    // Legend (simple)
    const legW = 160, legH = 10;
    const lg = gH.append('g').attr('transform', `translate(${innerWH - legW - 10}, -10)`);
    const gradId = 'gradHeat';
    const defs = heatmapSel.append('defs');
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1','0%').attr('y1','0%').attr('x2','100%').attr('y2','0%');
    for (let i=0;i<=10;i++){
      grad.append('stop').attr('offset', `${i*10}%`).attr('stop-color', color((i/10)*maxVal));
    }
    lg.append('rect').attr('width', legW).attr('height', legH).attr('fill', `url(#${gradId})`);
    const scale = d3.scaleLinear().domain([0,maxVal]).range([0,legW]);
    const axis = d3.axisBottom(scale).ticks(5).tickSize(3);
    lg.append('g').attr('transform', `translate(0,${legH})`).attr('class','axis').call(axis);
  }

  function renderTable(rows){
    const container = d3.select('#records');
    container.selectAll('*').remove();
    if (!rows.length){ container.append('p').text('No records for current selection.'); return; }

    const table = container.append('table');
    const thead = table.append('thead').append('tr');
    const cols = ['source_id','experiment_id','variable_id','member_id','table_id','grid_label','version','zstore'];
    thead.selectAll('th').data(cols).enter().append('th').text(d=>d);

    const tbody = table.append('tbody');
    tbody.selectAll('tr').data(rows).enter().append('tr')
      .selectAll('td').data(d => cols.map(c=>d[c])).enter().append('td')
      .html(d => {
        if (String(d).startsWith('gs://')) return `<a href="${d}" target="_blank" rel="noopener">${d}</a>`;
        return String(d);
      });
  }

  // initial render
  updateAll();
}).catch(err => {
  console.error(err);
  alert('Failed to load data. Check the console for details.');
});
