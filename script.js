const scenarioOrder = ["historical", "future"];
const scenarioLabels = {
    historical: "Historical (1850–2014)",
    future: "Future (2015–2100)"
};
const scenarioColors = {
    historical: getComputedStyle(document.documentElement).getPropertyValue("--historical").trim() || "#314d64",
    future: getComputedStyle(document.documentElement).getPropertyValue("--future").trim() || "#2a9d8f"
};

const seasonColors = {
    DJF: "#264653", // Winter - dark blue-green
    MAM: "#2a9d8f", // Spring - teal
    JJA: "#e9c46a", // Summer - golden (June Gloom season)
    SON: "#f4a261"  // Fall - orange
};

const seasonLabels = {
    DJF: "Winter (DJF)",
    MAM: "Spring (MAM)",
    JJA: "Summer (JJA • June Gloom)",
    SON: "Fall (SON)"
};

const state = {
    scenarioFilter: "both",
    year: null,
    monthValue: null, // For monthly view: year + (month-1)/12
    trendChart: null,
    diffChart: null,
    monthlyData: null,
    zoomedRange: null,
    isZoomed: false,
    annualData: null,
    seasonalData: null,
    viewMode: "annual", // "annual", "seasonal", or "monthly" (when zoomed)
    seasonalVisibility: new Set(), // Track which season-scenario combinations are visible
    sliderTooltipTimeout: null, // Timeout for showing tooltip when slider stops
    actualDataRange: null, // Actual min/max dateValue range of visible data when zoomed
    mapRendered: false // Track if map has been rendered
};

const tooltip = d3.select("#tooltip");

Promise.all([
    d3.csv("data/fog_socal_timeseries.csv", d => ({
        year: +d.year,
        clt: +d.clt,
        scenario: d.scenario.trim()
    })),
    d3.csv("data/fog_socal_seasonal.csv", d => ({
        season: d.season.trim(),
        clt: +d.clt,
        scenario: d.scenario.trim()
    })),
    d3.csv("data/fog_socal_monthly.csv", d => ({
        year: +d.year,
        month: +d.month,
        clt: +d.clt,
        scenario: d.scenario.trim(),
        // Create a date-like value for sorting (year + month/12)
        dateValue: +d.year + (+d.month - 1) / 12
    }))
]).then(([timeseries, seasonal, monthly]) => {
    const filteredTimeseries = timeseries.filter(d => scenarioOrder.includes(d.scenario));

    // Calculate year extent based on visible scenarios (initially both)
    const visibleScenarios = state.scenarioFilter === "both" ? scenarioOrder : [state.scenarioFilter];
    const visibleTimeseries = filteredTimeseries.filter(d => visibleScenarios.includes(d.scenario));
    const yearExtent = visibleTimeseries.length > 0 ? d3.extent(visibleTimeseries, d => d.year) : [1850, 2100];
    const defaultYear = Math.round((yearExtent[0] + yearExtent[1]) / 2);
    state.year = defaultYear;

            state.monthlyData = monthly;
            state.annualData = filteredTimeseries;
            // Compute seasonal data from monthly data
            state.seasonalData = computeSeasonalData(monthly);
            
            // Initialize seasonal visibility - all visible by default
            if (state.seasonalVisibility.size === 0) {
                const seasons = ["DJF", "MAM", "JJA", "SON"];
                scenarioOrder.forEach(scenario => {
                    seasons.forEach(season => {
                        state.seasonalVisibility.add(`${scenario}_${season}`);
                    });
                });
            }

            setupControls(yearExtent);
            setupViewToggles();
            setupWriteupToggle();
            setupMapToggle();
            setupRegionLink();
            renderTrendChart(filteredTimeseries, monthly, null, state.viewMode);
            renderMap(); // Render map even though it's hidden initially

    updateYearHighlight(state.year);
    updateYearCopy(filteredTimeseries, state.year);
}).catch(err => {
    console.error("Failed to load data", err);
    document.body.innerHTML = `<div style="padding: 60px; text-align: center;">
        <h2>Data files not found</h2>
        <p>Please verify fog_socal_timeseries.csv and fog_socal_seasonal.csv exist in data/</p>
    </div>`;
});

function setupSummaryCards(timeseries, seasonal) {
    const baseline = timeseries.filter(d => d.scenario === "historical" && d.year >= 1980 && d.year <= 2010);
    const futureWindow = timeseries.filter(d => d.scenario === "future" && d.year >= 2070 && d.year <= 2100);

    const baselineMean = d3.mean(baseline, d => d.clt);
    const futureMean = d3.mean(futureWindow, d => d.clt);
    const changeValue = futureMean - baselineMean;
    const changePct = (changeValue / baselineMean) * 100;

    const foggiestHistoric = d3.least(timeseries.filter(d => d.scenario === "historical"), d => d.clt);
    const clearestFuture = d3.least(timeseries.filter(d => d.scenario === "future"), d => d.clt);

    const jjaHistoric = seasonal.find(d => d.season === "JJA" && d.scenario === "historical");
    const jjaFuture = seasonal.find(d => d.season === "JJA" && d.scenario === "future");

    const cards = [
        {
            eyebrow: "Future change",
            value: isFinite(changePct) ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "n/a",
            delta: isFinite(changeValue) ? `${changeValue >= 0 ? "+" : ""}${changeValue.toFixed(1)} pts` : "",
            note: "Difference between 1980–2010 historical mean and 2070–2100 future mean"
        },
        {
            eyebrow: "Highest cloud fraction (historical)",
            value: foggiestHistoric ? `${foggiestHistoric.year}` : "n/a",
            delta: foggiestHistoric ? `${foggiestHistoric.clt.toFixed(1)}% cloud fraction` : "",
            note: "Lowest cloudiness year in the historical run"
        },
        {
            eyebrow: "Clearest future year",
            value: clearestFuture ? `${clearestFuture.year}` : "n/a",
            delta: clearestFuture ? `${clearestFuture.clt.toFixed(1)}% cloud fraction` : "",
            note: "Minimum cloud fraction in future projection"
        },
        {
            eyebrow: "June Gloom shift",
            value: jjaHistoric && jjaFuture ? `${(jjaFuture.clt - jjaHistoric.clt >= 0 ? "+" : "")}${(jjaFuture.clt - jjaHistoric.clt).toFixed(1)} pts` : "n/a",
            delta: jjaHistoric && jjaFuture ? `Historical ${jjaHistoric.clt.toFixed(1)}% → Future ${jjaFuture.clt.toFixed(1)}%` : "",
            note: "Average JJA cloud fraction using seasonal means"
        }
    ];

    const grid = d3.select("#summaryGrid");
    const cardSel = grid.selectAll(".summary-card").data(cards);
    const cardEnter = cardSel.enter().append("div").attr("class", "summary-card");

    cardEnter.append("div").attr("class", "summary-eyebrow");
    cardEnter.append("div").attr("class", "summary-value");
    cardEnter.append("div").attr("class", "summary-delta");
    cardEnter.append("div").attr("class", "summary-note");

    const cardMerge = cardEnter.merge(cardSel);
    cardMerge.select(".summary-eyebrow").text(d => d.eyebrow);
    cardMerge.select(".summary-value").text(d => d.value);
    cardMerge.select(".summary-delta").text(d => d.delta);
    cardMerge.select(".summary-note").text(d => d.note);
}

function computeSeasonalData(monthly) {
    // Group monthly data by year, scenario, and season
    // Seasons: DJF (Dec, Jan, Feb), MAM (Mar, Apr, May), JJA (Jun, Jul, Aug), SON (Sep, Oct, Nov)
    const seasonMonths = {
        DJF: [12, 1, 2],
        MAM: [3, 4, 5],
        JJA: [6, 7, 8],
        SON: [9, 10, 11]
    };

    const seasonalByYear = {};
    
    monthly.forEach(d => {
        let season = null;
        for (const [s, months] of Object.entries(seasonMonths)) {
            if (months.includes(d.month)) {
                season = s;
                break;
            }
        }
        
        if (!season) return;
        
        // For DJF, Dec belongs to the following year's winter
        let yearKey = d.year;
        if (d.month === 12) {
            yearKey = d.year + 1;
        }
        
        const key = `${yearKey}_${d.scenario}_${season}`;
        if (!seasonalByYear[key]) {
            seasonalByYear[key] = {
                year: yearKey,
                scenario: d.scenario,
                season: season,
                values: []
            };
        }
        seasonalByYear[key].values.push(d.clt);
    });

    // Compute averages
    const seasonalData = Object.values(seasonalByYear).map(d => ({
        year: d.year,
        scenario: d.scenario,
        season: d.season,
        clt: d3.mean(d.values)
    }));

    return seasonalData;
}

function setupViewToggles() {
    d3.selectAll(".view-toggle").on("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        const view = this.dataset.view;
        
        // Update active state
        d3.selectAll(".view-toggle").classed("active", false);
        d3.select(this).classed("active", true);
        
        state.viewMode = view;
        
        // Reset zoom if switching views
        if (state.isZoomed) {
            state.zoomedRange = null;
            state.isZoomed = false;
            d3.select("#resetZoomBtn").style("display", "none");
            if (state.brush && state.brush.reset) {
                state.brush.reset();
            }
        }
        
        // Hide/show hint based on view mode
        if (view === "seasonal") {
            d3.select("#legendHint").style("display", "block");
            d3.select("#viewModeHint").text("Click legend items to show/hide seasonal lines");
        } else {
            d3.select("#legendHint").style("display", "none");
            if (state.isZoomed) {
                d3.select("#viewModeHint").text("Use slider to navigate months • Click reset to return to annual view");
            } else {
                d3.select("#viewModeHint").text("Click and drag on the chart to zoom into monthly detail");
            }
        }
        
        // Reset monthValue when switching away from monthly view
        if (view !== "monthly" || !state.isZoomed) {
            state.monthValue = null;
        }
        
        // Re-render chart
        renderTrendChart(state.annualData, state.monthlyData, null, view);
        
        // Update slider for new view mode
        const minYear = d3.min(state.annualData.filter(d => 
            state.scenarioFilter === "both" || d.scenario === state.scenarioFilter
        ), d => d.year) || 1850;
        const maxYear = d3.max(state.annualData.filter(d => 
            state.scenarioFilter === "both" || d.scenario === state.scenarioFilter
        ), d => d.year) || 2100;
        updateSliderForViewMode(d3.select("#yearSlider"), minYear, maxYear);
        
        if (state.isZoomed && state.monthValue !== null) {
            updateYearHighlight(state.monthValue, true);
        } else {
            updateYearHighlight(state.year, false);
        }
        
        // When switching to seasonal view, ensure visibility state is initialized
        if (view === "seasonal" && state.seasonalVisibility.size === 0) {
            const seasons = ["DJF", "MAM", "JJA", "SON"];
            const scenarioFilter = state.scenarioFilter;
            const visibleScenarios = scenarioFilter === "both" ? scenarioOrder : [scenarioFilter];
            visibleScenarios.forEach(scenario => {
                seasons.forEach(season => {
                    state.seasonalVisibility.add(`${scenario}_${season}`);
                });
            });
        }
    });
}

function setupWriteupToggle() {
    const header = d3.select("#writeupToggle");
    const content = d3.select("#writeupContent");
    const icon = d3.select("#writeupToggleIcon");
    
    header.on("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        const isVisible = content.style("display") !== "none";
        
        if (isVisible) {
            content.style("display", "none");
            header.classed("active", false);
        } else {
            content.style("display", "block");
            header.classed("active", true);
        }
    });
}

function setupMapToggle() {
    const header = d3.select("#mapToggle");
    const content = d3.select("#mapContent");
    const icon = d3.select("#mapToggleIcon");
    
    header.on("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        toggleMapSection();
    });
}

function toggleMapSection() {
    const content = d3.select("#mapContent");
    const header = d3.select("#mapToggle");
    const isVisible = content.style("display") !== "none";
    
    if (isVisible) {
        content.style("display", "none");
        header.classed("active", false);
    } else {
        content.style("display", "block");
        header.classed("active", true);
        // Render map if not already rendered
        if (!state.mapRendered) {
            renderMap();
            state.mapRendered = true;
        }
    }
}

function setupRegionLink() {
    const regionLink = d3.select("#regionLink");
    
    regionLink.on("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        toggleMapSection();
        // Scroll to map section smoothly
        const mapSection = document.getElementById("mapSection");
        if (mapSection) {
            mapSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    });
}

function setupControls([minYear, maxYear]) {
    const slider = d3.select("#yearSlider");
    
    // Update slider based on current view mode
    updateSliderForViewMode(slider, minYear, maxYear);

    // Hide tooltip when slider starts moving
    slider.on("input", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = +event.target.value;
        
        // Clear any pending tooltip timeout
        if (state.sliderTooltipTimeout) {
            clearTimeout(state.sliderTooltipTimeout);
            state.sliderTooltipTimeout = null;
        }
        
        // Hide tooltip while dragging
        hideTooltip();
        
        if (state.isZoomed && state.zoomedRange) {
            // In monthly view, value represents dateValue (year + month/12)
            state.monthValue = value;
            state.year = Math.floor(value);
            updateYearHighlight(value, true); // Pass value directly for monthly
        } else {
            // In annual/seasonal view, value is just year
            state.year = value;
            state.monthValue = null;
            updateYearHighlight(value, false);
        }
    });
    
    // Show tooltip when slider stops (on change event)
    slider.on("change", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = +event.target.value;
        
        // Clear any pending timeout
        if (state.sliderTooltipTimeout) {
            clearTimeout(state.sliderTooltipTimeout);
        }
        
        // Show tooltip after a short delay to ensure highlight is updated
        state.sliderTooltipTimeout = setTimeout(() => {
            showTooltipAtHighlightedPoint();
        }, 100);
    });
}

function updateSliderForViewMode(slider, minYear, maxYear) {
    if (state.isZoomed && state.zoomedRange && state.monthlyData) {
        // Monthly view: slider should step through months within the actual visible data range
        // Use actual data range if available, otherwise fall back to year boundaries
        let startDateValue, endDateValue;
        
        if (state.actualDataRange && state.actualDataRange.length === 2) {
            // Use the actual min/max from the visible data
            [startDateValue, endDateValue] = state.actualDataRange;
        } else {
            // Fallback to year boundaries
            const [startYear, endYear] = state.zoomedRange;
            startDateValue = startYear; // January of start year
            endDateValue = endYear + 11 / 12; // December of end year
        }
        
        // Clamp current value to the actual visible data range
        let currentValue = state.monthValue !== null ? state.monthValue : 
                           (state.year !== null ? state.year + 6 / 12 : (startDateValue + endDateValue) / 2);
        currentValue = Math.max(startDateValue, Math.min(endDateValue, currentValue));
        
        slider
            .attr("min", startDateValue)
            .attr("max", endDateValue)
            .attr("step", 1 / 12) // Step by month
            .property("value", currentValue);
        
        // Update label
        d3.select("#yearSlider").node().previousElementSibling?.querySelector("label") ||
        d3.select('label[for="yearSlider"]').text("Highlight month");
        
        // Update the readout to show the current zoom range
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const startYearInt = Math.floor(startDateValue);
        const startMonthNum = Math.round((startDateValue - startYearInt) * 12) + 1;
        const endYearInt = Math.floor(endDateValue);
        const endMonthNum = Math.round((endDateValue - endYearInt) * 12) + 1;
        const startMonthName = monthNames[Math.max(0, Math.min(11, startMonthNum - 1))];
        const endMonthName = monthNames[Math.max(0, Math.min(11, endMonthNum - 1))];
        d3.select("#yearReadout").text(`Range: ${startMonthName} ${startYearInt} - ${endMonthName} ${endYearInt}`);
    } else {
        // Annual/seasonal view: slider steps through years
        const currentValue = state.year !== null ? state.year : Math.round((minYear + maxYear) / 2);
        // Clamp current value to the range
        const clampedValue = Math.max(minYear, Math.min(maxYear, currentValue));
        
        slider
            .attr("min", minYear)
            .attr("max", maxYear)
            .attr("step", 1)
            .property("value", clampedValue);
        
        // Update label
        d3.select('label[for="yearSlider"]').text("Highlight year");
        
        // Update readout to show the current range
        d3.select("#yearReadout").text(`Range: ${minYear} - ${maxYear}`);
    }
}

function setupControls([minYear, maxYear]) {
    const slider = d3.select("#yearSlider");
    
    // Update slider based on current view mode
    updateSliderForViewMode(slider, minYear, maxYear);

    // Hide tooltip when slider starts moving
    slider.on("input", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = +event.target.value;
        
        // Clear any pending tooltip timeout
        if (state.sliderTooltipTimeout) {
            clearTimeout(state.sliderTooltipTimeout);
            state.sliderTooltipTimeout = null;
        }
        
        // Hide tooltip while dragging
        hideTooltip();
        
        if (state.isZoomed && state.zoomedRange) {
            // In monthly view, value represents dateValue (year + month/12)
            // Clamp value to the actual visible data range
            let clampedValue = value;
            if (state.actualDataRange && state.actualDataRange.length === 2) {
                const [minDateValue, maxDateValue] = state.actualDataRange;
                clampedValue = Math.max(minDateValue, Math.min(maxDateValue, value));
            } else {
                // Fallback to year boundaries
                const [startYear, endYear] = state.zoomedRange;
                clampedValue = Math.max(startYear, Math.min(endYear + 11/12, value));
            }
            
            // Update slider if value was clamped
            if (clampedValue !== value) {
                slider.property("value", clampedValue);
            }
            
            state.monthValue = clampedValue;
            state.year = Math.floor(clampedValue);
            updateYearHighlight(clampedValue, true); // Pass clamped value for monthly
        } else {
            // In annual/seasonal view, value is just year
            // Clamp to current visible range based on scenario filter
            const sliderMin = +slider.attr("min");
            const sliderMax = +slider.attr("max");
            const clampedValue = Math.max(sliderMin, Math.min(sliderMax, value));
            
            // Update slider if value was clamped
            if (clampedValue !== value) {
                slider.property("value", clampedValue);
            }
            
            state.year = clampedValue;
            state.monthValue = null;
            updateYearHighlight(clampedValue, false);
        }
    });
    
    // Show tooltip when slider stops (on change event)
    slider.on("change", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = +event.target.value;
        
        // Clear any pending timeout
        if (state.sliderTooltipTimeout) {
            clearTimeout(state.sliderTooltipTimeout);
        }
        
        // Show tooltip after a short delay to ensure highlight is updated
        state.sliderTooltipTimeout = setTimeout(() => {
            showTooltipAtHighlightedPoint();
        }, 100);
    });

    // Setup scenario toggle buttons
    d3.selectAll(".scenario-toggle-btn").on("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const clickedButton = d3.select(this);
        const newValue = clickedButton.attr("data-value");
        
        // Update active state
        d3.selectAll(".scenario-toggle-btn").classed("active", false);
        clickedButton.classed("active", true);
        
        // Update hidden select for backward compatibility
        d3.select("#scenarioFilter").property("value", newValue);
        
        // Update state and trigger change
        state.scenarioFilter = newValue;
        triggerScenarioFilterChange(newValue);
    });
    
    // Also keep the select handler for backward compatibility
    d3.select("#scenarioFilter").on("change", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const newValue = event.target.value;
        
        // Update button states to match
        d3.selectAll(".scenario-toggle-btn").classed("active", false);
        d3.select(`.scenario-toggle-btn[data-value="${newValue}"]`).classed("active", true);
        
        state.scenarioFilter = newValue;
        triggerScenarioFilterChange(newValue);
    });
    
    function triggerScenarioFilterChange(newValue) {
        d3.select("#trendChart").selectAll("*").remove();
        state.brush = null;

        Promise.all([
            d3.csv("data/fog_socal_timeseries.csv", d => ({
                year: +d.year,
                clt: +d.clt,
                scenario: d.scenario.trim()
            })),
            d3.csv("data/fog_socal_monthly.csv", d => ({
                year: +d.year,
                month: +d.month,
                clt: +d.clt,
                scenario: d.scenario.trim(),
                dateValue: +d.year + (+d.month - 1) / 12
            }))
        ]).then(([timeseries, monthly]) => {
            const filteredTimeseries = timeseries.filter(d => scenarioOrder.includes(d.scenario));
                    state.monthlyData = monthly;
                    state.annualData = filteredTimeseries;
                    state.seasonalData = computeSeasonalData(monthly);
                    // Reset zoom when filter changes
                    state.zoomedRange = null;
                    state.isZoomed = false;
                    state.actualDataRange = null;
                    d3.select("#resetZoomBtn").style("display", "none");
                    
                    // Update seasonal visibility for new scenario filter
                    // Clear and rebuild visibility set based on current filter
                    state.seasonalVisibility.clear();
                    const visibleScenarios = newValue === "both" ? scenarioOrder : [newValue];
                    const seasons = ["DJF", "MAM", "JJA", "SON"];
                    visibleScenarios.forEach(scenario => {
                        seasons.forEach(season => {
                            state.seasonalVisibility.add(`${scenario}_${season}`);
                        });
                    });
                    
                    // Recalculate year extent based on visible scenarios and update slider
                    const visibleTimeseries = filteredTimeseries.filter(d => visibleScenarios.includes(d.scenario));
                    const yearExtent = visibleTimeseries.length > 0 ? d3.extent(visibleTimeseries, d => d.year) : [1850, 2100];
                    // Clamp current year to new range
                    if (state.year < yearExtent[0] || state.year > yearExtent[1]) {
                        state.year = Math.round((yearExtent[0] + yearExtent[1]) / 2);
                    }
                    // Reset monthValue when scenario changes
                    state.monthValue = null;
                    
                    renderTrendChart(filteredTimeseries, monthly, null, state.viewMode);
                    // Update slider for current view mode
                    updateSliderForViewMode(d3.select("#yearSlider"), yearExtent[0], yearExtent[1]);
                    if (state.isZoomed && state.monthValue !== null) {
                        updateYearHighlight(state.monthValue, true);
                    } else {
                        updateYearHighlight(state.year, false);
                    }
                    updateYearCopy(filteredTimeseries, state.year);
                });
    }
}

function renderTrendChart(timeseries, monthly = null, zoomRange = null, viewMode = "annual") {
    const container = d3.select("#trendChart");
    container.selectAll("*").remove();
    
    const width = Math.min(960, container.node().getBoundingClientRect().width || 960);
    const height = 440;
    const margin = { top: 32, right: 28, bottom: 60, left: 70 };

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img");

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Determine view mode: monthly (when zoomed), seasonal, or annual
    const useMonthly = zoomRange && monthly && monthly.length > 0;
    const useSeasonal = viewMode === "seasonal" && state.seasonalData && state.seasonalData.length > 0;
    const dataToUse = useMonthly ? monthly : (useSeasonal ? state.seasonalData : timeseries);
    
    // Determine visible scenarios
    const scenarioFilter = state.scenarioFilter;
    const visibleScenarios = scenarioFilter === "both" ? scenarioOrder : [scenarioFilter];
    
    let x, xAxis, dataByScenario;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    if (useMonthly) {
        // Filter monthly data for zoom range
        const [startYear, endYear] = zoomRange;
        
        const filteredMonthly = monthly.filter(d => {
            const inRange = d.year >= startYear && d.year <= endYear;
            const inScenario = visibleScenarios.includes(d.scenario);
            return inRange && inScenario;
        }).sort((a, b) => a.dateValue - b.dateValue);

        const xMin = d3.min(filteredMonthly, d => d.dateValue);
        const xMax = d3.max(filteredMonthly, d => d.dateValue);
        x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerWidth]);
        
        // Store actual data range for slider
        state.actualDataRange = [xMin, xMax];
        
        // Format x-axis for monthly data
        xAxis = d3.axisBottom(x)
            .ticks(Math.min(16, (endYear - startYear + 1) * 3))
            .tickFormat(d => {
                const year = Math.floor(d);
                const month = Math.round((d - year) * 12) + 1;
                if ((d - Math.floor(d)) < 0.01) {
                    return `${year}`;
                }
                if (month >= 1 && month <= 12) {
                    return monthNames[month - 1];
                }
                return "";
            });

        dataByScenario = visibleScenarios.map(key => ({
            key,
            scenario: key,
            values: filteredMonthly
                .filter(d => d.scenario === key)
                .sort((a, b) => a.dateValue - b.dateValue)
        })).filter(d => d.values.length > 0);
    } else if (useSeasonal) {
        // Use seasonal data - group by scenario and season
        // Filter seasonal data by visible scenarios first to get correct year extent
        const filteredSeasonalData = state.seasonalData.filter(d => visibleScenarios.includes(d.scenario));
        const years = filteredSeasonalData.length > 0 ? d3.extent(filteredSeasonalData, d => d.year) : [1850, 2100];
        x = d3.scaleLinear().domain(years).range([0, innerWidth]);
        xAxis = d3.axisBottom(x).ticks(width < 700 ? 8 : 12).tickFormat(d3.format("d"));
        
        const seasons = ["DJF", "MAM", "JJA", "SON"];
        // Create data structure: one line per scenario-season combination
        // Filter by visibility state
        dataByScenario = [];
        visibleScenarios.forEach(scenario => {
            seasons.forEach(season => {
                const key = `${scenario}_${season}`;
                // Only include if visible
                if (state.seasonalVisibility.has(key)) {
                    const seasonData = state.seasonalData
                        .filter(d => d.scenario === scenario && d.season === season)
                        .sort((a, b) => a.year - b.year);
                    if (seasonData.length > 0) {
                        dataByScenario.push({
                            key: key,
                            scenario: scenario,
                            season: season,
                            values: seasonData
                        });
                    }
                }
            });
        });
    } else {
        // Use annual data
        // Filter by visible scenarios first to get correct year extent
        const filteredTimeseries = timeseries.filter(d => visibleScenarios.includes(d.scenario));
        const years = filteredTimeseries.length > 0 ? d3.extent(filteredTimeseries, d => d.year) : [1850, 2100];
        x = d3.scaleLinear().domain(years).range([0, innerWidth]);
        xAxis = d3.axisBottom(x).ticks(width < 700 ? 8 : 12).tickFormat(d3.format("d"));
        
        dataByScenario = visibleScenarios.map(key => ({
            key,
            scenario: key,
            values: filteredTimeseries
                .filter(d => d.scenario === key)
                .sort((a, b) => a.year - b.year)
        })).filter(d => d.values.length > 0);
    }

    const y = d3.scaleLinear()
        .domain([0, d3.max(dataToUse, d => d.clt) * 1.08])
        .nice()
        .range([innerHeight, 0]);

    const yAxis = d3.axisLeft(y).ticks(8).tickFormat(d => `${d.toFixed(0)}%`);

    g.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(x).tickSize(-innerHeight).tickFormat(""));

    g.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(""));

    const xAxisG = g.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(xAxis);

    if (useMonthly) {
        xAxisG.selectAll("text")
            .style("font-size", "10px")
            .attr("transform", "rotate(-45)")
            .attr("text-anchor", "end")
            .attr("dx", "-0.5em")
            .attr("dy", "0.5em");
    }

    xAxisG.append("text")
        .attr("class", "axis-title")
        .attr("x", innerWidth / 2)
        .attr("y", 44)
        .attr("text-anchor", "middle")
        .text(useMonthly ? "Year & Month" : "Year");

    g.append("g")
        .attr("class", "axis")
        .call(yAxis)
        .append("text")
        .attr("class", "axis-title")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -52)
        .attr("text-anchor", "middle")
        .text(useMonthly ? "Monthly cloud fraction (%)" : (useSeasonal ? "Seasonal cloud fraction (%)" : "Mean coastal cloud fraction (%)"));

    const lineGen = d3.line()
        .defined(d => !Number.isNaN(d.clt))
        .x(d => useMonthly ? x(d.dateValue) : x(d.year))
        .y(d => y(d.clt))
        .curve(d3.curveMonotoneX);

    const lineGroups = g.selectAll(".scenario-line")
        .data(dataByScenario, d => d.key)
        .join(enter => {
            const group = enter.append("g").attr("class", "scenario-line");
            group.append("path")
                .attr("class", d => `line line-${d.key}`)
                .attr("stroke", d => {
                    if (useSeasonal && d.season) {
                        // For seasonal view, use season colors, but add opacity based on scenario
                        const baseColor = seasonColors[d.season] || "#555";
                        return baseColor;
                    }
                    return scenarioColors[d.key] || scenarioColors[d.scenario] || "#555";
                })
                .attr("stroke-width", useSeasonal ? 2 : 2.8)
                .attr("stroke-dasharray", d => {
                    // Different dash patterns for different scenarios in seasonal view
                    if (useSeasonal && d.scenario === "future") {
                        return "4 4";
                    }
                    return "none";
                })
                .attr("opacity", d => {
                    if (useSeasonal && d.scenario === "historical") {
                        return 0.7;
                    }
                    return 1;
                })
                .attr("d", d => lineGen(d.values));

            group.selectAll("circle")
                .data(d => d.values)
                .join("circle")
                .attr("cx", d => useMonthly ? x(d.dateValue) : x(d.year))
                .attr("cy", d => y(d.clt))
                .attr("r", useMonthly ? 2.5 : (useSeasonal ? 2 : 3))
                .attr("fill", d => {
                    if (useSeasonal && d.season) {
                        return seasonColors[d.season] || "#555";
                    }
                    return scenarioColors[d.scenario] || "#555";
                })
                .attr("opacity", useMonthly ? 0.4 : (useSeasonal ? 0.3 : 0.15))
                .on("mouseenter", (event, d) => {
                    if (useMonthly) {
                        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                        showTooltip(event, {
                            year: d.year,
                            clt: d.clt,
                            scenario: d.scenario,
                            month: monthNames[d.month - 1]
                        });
                    } else if (useSeasonal && d.season) {
                        showTooltip(event, {
                            year: d.year,
                            clt: d.clt,
                            scenario: d.scenario,
                            season: d.season
                        });
                    } else {
                        showTooltip(event, d);
                    }
                })
                .on("mouseleave", hideTooltip);
            return group;
        });

    const focusLine = g.append("line")
        .attr("class", "focus-line")
        .attr("y1", 0)
        .attr("y2", innerHeight);

    const focusPoints = g.append("g").attr("class", "focus-points");

    state.trendChart = {
        x,
        y,
        focusLine,
        focusPoints,
        dataByScenario,
        visibleScenarios,
        useMonthly,
        useSeasonal,
        innerWidth: innerWidth
    };

            if (useSeasonal) {
                renderSeasonalLegend(dataByScenario);
                // Show hint text for seasonal view
                d3.select("#legendHint").style("display", "block");
                d3.select("#viewModeHint").text("Click legend items to show/hide seasonal lines");
            } else {
                renderTrendLegend(visibleScenarios);
                // Hide hint text for non-seasonal views
                d3.select("#legendHint").style("display", "none");
                
                // Add brush interaction directly to main chart
                // Brush is available in both annual view and when zoomed (to allow further zooming)
                if (monthly && monthly.length > 0) {
                    setupBrushOnMainChart(timeseries, monthly, g, x, innerWidth, innerHeight, zoomRange);
                }
                
                // Update hint text
                if (state.isZoomed) {
                    // Check if at minimum zoom
                    const zoomRange = state.zoomedRange;
                    const rangeYears = zoomRange ? (zoomRange[1] - zoomRange[0]) : 0;
                    const HARD_MIN_RANGE = 1; // 1 year minimum
                    const isAtMinZoom = rangeYears <= HARD_MIN_RANGE + 0.1;
                    
                    if (isAtMinZoom) {
                        d3.select("#viewModeHint").text("Use slider to navigate months • Minimum zoom reached (1 year) • Click reset to return to annual view");
                    } else {
                        d3.select("#viewModeHint").text("Use slider to navigate months • Click and drag to zoom further • Click reset to return to annual view");
                    }
                } else {
                    d3.select("#viewModeHint").text("Click and drag on the chart to select a time range for monthly detail");
                }
            }
            
            // Setup reset zoom button handler
            setupResetZoom();
        }

function setupBrushOnMainChart(timeseries, monthly, g, x, innerWidth, innerHeight, currentZoomRange = null) {
    // Remove any existing brush
    g.selectAll(".brush").remove();
    g.selectAll(".brush-label").remove();
    
    // Get year extent - use current zoom range if zoomed, otherwise use full data range
    const scenarioFilter = state.scenarioFilter;
    const visibleScenarios = scenarioFilter === "both" ? scenarioOrder : [scenarioFilter];
    const filteredTimeseries = timeseries.filter(d => visibleScenarios.includes(d.scenario));
    
    // Determine the bounds for brushing
    let years;
    if (currentZoomRange) {
        // If already zoomed, brush within the current zoom range
        years = currentZoomRange;
    } else {
        // If not zoomed, use full data range
        years = filteredTimeseries.length > 0 ? d3.extent(filteredTimeseries, d => d.year) : [1850, 2100];
    }
    
    // Create a label to show selected range
    const brushLabel = g.append("text")
        .attr("class", "brush-label")
        .attr("x", innerWidth / 2)
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("fill", "var(--accent-dark)")
        .attr("font-weight", "600")
        .style("opacity", 0)
        .style("pointer-events", "none");
    
    // Create brush on main chart - use brushX to allow horizontal range selection
    const brush = d3.brushX()
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("brush", brushed)  // Update label while brushing
        .on("end", brushEnded); // Commit zoom when done

    const brushG = g.append("g")
        .attr("class", "brush")
        .call(brush);

    function brushed(event) {
        // Update label while brushing to show selected range
        if (event.selection) {
            const [x0, x1] = event.selection.map(x.invert);
            let startYear = Math.max(years[0], x0);
            let endYear = Math.min(years[1], x1);
            
            // Calculate the range in years (can be fractional for monthly view)
            const yearRange = endYear - startYear;
            const startYearInt = Math.floor(startYear);
            const endYearInt = Math.floor(endYear);
            const startMonthNum = Math.round((startYear - startYearInt) * 12);
            const endMonthNum = Math.round((endYear - endYearInt) * 12);
            
            // Format label based on zoom level
            if (yearRange < 1 && currentZoomRange && (currentZoomRange[1] - currentZoomRange[0]) < 5) {
                // Show months if range is less than a year and we're already zoomed
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const startMonth = monthNames[Math.max(0, Math.min(11, startMonthNum))];
                const endMonth = monthNames[Math.max(0, Math.min(11, endMonthNum))];
                const monthsDiff = Math.round(yearRange * 12);
                if (monthsDiff < 12) {
                    brushLabel
                        .text(`Selected: ${startMonth} ${startYearInt} - ${endMonth} ${endYearInt} (${monthsDiff} months)`)
                        .style("opacity", 1);
                } else {
                    brushLabel
                        .text(`Selected: ${startYearInt} - ${endYearInt} (${Math.round(yearRange * 12)} months)`)
                        .style("opacity", 1);
                }
            } else {
                // Show years
                const yearDiff = endYearInt - startYearInt;
                if (yearDiff === 0) {
                    // Less than a full year
                    const monthsDiff = Math.round(yearRange * 12);
                    brushLabel
                        .text(`Selected: ${startYearInt} (${monthsDiff} months)`)
                        .style("opacity", 1);
                } else {
                    brushLabel
                        .text(`Selected: ${startYearInt} - ${endYearInt} (${yearDiff + 1} years)`)
                        .style("opacity", 1);
                }
            }
        } else {
            brushLabel.style("opacity", 0);
        }
    }

    function brushEnded(event) {
        if (!event.selection) {
            // Brush was cleared
            brushLabel.style("opacity", 0);
            // If already zoomed, don't reset - just clear the brush selection
            // User can click reset button to go back to annual view
            return;
        }

        // Hard minimum: 1 year (12 months) - prevent zooming in too much
        const HARD_MIN_RANGE = 1; // 1 year minimum

        // Get the selected range
        const [x0, x1] = event.selection.map(x.invert);
        let startYear = Math.max(years[0], x0);
        let endYear = Math.min(years[1], x1);

        // Calculate minimum range based on current zoom level
        const currentRange = years[1] - years[0];
        
        // Adaptive minimum based on current zoom level, but never less than hard minimum
        let minRange;
        if (currentRange < 10) {
            // If already zoomed to < 10 years, allow 1 year minimum
            minRange = Math.max(HARD_MIN_RANGE, currentRange * 0.1); // 10% of current range, but at least 1 year
        } else {
            // If not zoomed or zoomed to > 10 years, minimum is 5 years
            minRange = 5;
        }
        
        // Ensure we never go below the hard minimum
        minRange = Math.max(HARD_MIN_RANGE, minRange);
        
        if (endYear - startYear < minRange) {
            const center = (startYear + endYear) / 2;
            startYear = Math.max(years[0], center - minRange / 2);
            endYear = Math.min(years[1], center + minRange / 2);
            
            // Double-check: if the enforced range is still too small, expand it
            if (endYear - startYear < HARD_MIN_RANGE) {
                const center2 = (startYear + endYear) / 2;
                startYear = Math.max(years[0], center2 - HARD_MIN_RANGE / 2);
                endYear = Math.min(years[1], center2 + HARD_MIN_RANGE / 2);
            }
            
            // Update brush position to show enforced minimum
            brushG.call(brush.move, [x(startYear), x(endYear)]);
        }

        // Hide label
        brushLabel.style("opacity", 0);

        // Check if we've reached the minimum zoom limit
        const rangeYears = endYear - startYear;
        const isAtMinZoom = rangeYears <= HARD_MIN_RANGE + 0.1; // Add small tolerance for floating point

        // Zoom the main chart to show monthly data for the selected time frame
        state.zoomedRange = [startYear, endYear];
        state.isZoomed = true;
        state.viewMode = "monthly"; // Override view mode when zoomed
        d3.select("#resetZoomBtn").style("display", "inline-block");
        renderTrendChart(state.annualData, monthly, [startYear, endYear], "monthly");
        
        // After chart renders, update slider to use actual data range
        // The renderTrendChart will set state.actualDataRange
        // Then set monthValue to leftmost point if current value is outside range
        const slider = d3.select("#yearSlider");
        if (state.actualDataRange && state.actualDataRange.length === 2) {
            const [actualMin, actualMax] = state.actualDataRange;
            // Set monthValue to leftmost point if current value is outside range
            if (state.monthValue === null || state.monthValue < actualMin || state.monthValue > actualMax) {
                state.monthValue = actualMin; // Start at leftmost visible point
            }
        } else {
            // Fallback: set to middle of selected range
            if (state.monthValue === null || state.monthValue < startYear || state.monthValue > endYear + 11/12) {
                state.monthValue = startYear + (endYear - startYear) / 2;
            }
        }
        
        // Update slider configuration for monthly view - will use actual data range
        updateSliderForViewMode(slider, startYear, endYear);
        updateYearHighlight(state.monthValue, true);
        
        // Update hint text - show different message if at minimum zoom
        if (isAtMinZoom) {
            d3.select("#viewModeHint").text("Use slider to navigate months • Minimum zoom reached (1 year) • Click reset to return to annual view");
        } else {
            d3.select("#viewModeHint").text("Use slider to navigate months • Click and drag to zoom further • Click reset to return to annual view");
        }
    }

    // Store brush functions for reset
    state.brush = { brush, brushG, xBrush: x, reset: () => {
        if (brushG) {
            brushG.call(brush.clear);
        }
        state.zoomedRange = null;
        state.isZoomed = false;
        state.actualDataRange = null;
        state.monthValue = null;
        d3.select("#resetZoomBtn").style("display", "none");
        renderTrendChart(state.annualData, monthly, null, "annual");
        // Update slider back to annual view
        const minYear = d3.min(state.annualData.filter(d => 
            state.scenarioFilter === "both" || d.scenario === state.scenarioFilter
        ), d => d.year) || 1850;
        const maxYear = d3.max(state.annualData.filter(d => 
            state.scenarioFilter === "both" || d.scenario === state.scenarioFilter
        ), d => d.year) || 2100;
        updateSliderForViewMode(d3.select("#yearSlider"), minYear, maxYear);
        updateYearHighlight(state.year, false);
        
        // Update hint text
        d3.select("#viewModeHint").text("Click and drag on the chart to select a time range for monthly detail");
    }};
}


function setupResetZoom() {
    d3.select("#resetZoomBtn").on("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.brush && state.brush.reset) {
            state.brush.reset();
        } else {
            state.zoomedRange = null;
            state.isZoomed = false;
            state.actualDataRange = null;
            state.monthValue = null;
            state.viewMode = "annual";
            d3.select("#resetZoomBtn").style("display", "none");
            renderTrendChart(state.annualData, state.monthlyData, null, "annual");
            d3.select("#viewModeHint").text("Click and drag on the chart to zoom into monthly detail");
        }
    });
}

function renderTrendLegend(visibleScenarios) {
    const legend = d3.select("#trendLegend");
    legend.selectAll("*").remove();

    visibleScenarios.forEach(key => {
        const item = legend.append("div").attr("class", "legend-item");
        item.append("span")
            .attr("class", "legend-color")
            .style("background", scenarioColors[key] || "#555");
        item.append("span").text(scenarioLabels[key] || key);
    });
}

function renderSeasonalLegend(dataByScenario) {
    const legend = d3.select("#trendLegend");
    legend.selectAll("*").remove();

    // Group by season to show legend
    const seasons = ["DJF", "MAM", "JJA", "SON"];
    const scenarioFilter = state.scenarioFilter;
    const visibleScenarios = scenarioFilter === "both" ? scenarioOrder : [scenarioFilter];

    // If "both" scenarios, show one legend item per season (controlling both hist and future)
    // Otherwise, show separate items for each season-scenario combination
    if (scenarioFilter === "both") {
        seasons.forEach(season => {
            // Check if this season has data for either scenario
            const hasData = state.seasonalData && state.seasonalData.some(
                d => d.season === season && (d.scenario === "historical" || d.scenario === "future")
            );
            if (!hasData) return;

            // Find the actual future scenario key used in the data
            let actualFutKey = null;
            if (state.seasonalData) {
                const futScenario = state.seasonalData.find(d => d.season === season && d.scenario !== "historical");
                if (futScenario) {
                    actualFutKey = `${futScenario.scenario}_${season}`;
                }
            }
            if (!actualFutKey) return; // Skip if no future scenario found
            
            const histKey = `historical_${season}`;
            const histVisible = state.seasonalVisibility.has(histKey);
            const futVisible = state.seasonalVisibility.has(actualFutKey);
            const bothVisible = histVisible && futVisible;
            const bothHidden = !histVisible && !futVisible;
            
            const item = legend.append("div")
                .attr("class", "legend-item seasonal-legend-item")
                .classed("legend-item-hidden", bothHidden)
                .style("cursor", "pointer")
                .on("click", function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    // Toggle both historical and future for this season
                    // If both are hidden, show both; otherwise hide both
                    if (bothHidden) {
                        state.seasonalVisibility.add(histKey);
                        state.seasonalVisibility.add(actualFutKey);
                    } else {
                        state.seasonalVisibility.delete(histKey);
                        state.seasonalVisibility.delete(actualFutKey);
                    }
                    
                    // Re-render the chart with updated visibility
                    renderTrendChart(state.annualData, state.monthlyData, null, state.viewMode);
                    updateYearHighlight(state.year);
                });

            const color = seasonColors[season] || "#555";
            const colorSpan = item.append("span")
                .attr("class", "legend-color")
                .style("background", color)
                .style("border", "1px solid rgba(0,0,0,0.15)") // Show border to indicate it's a combined item
                .style("opacity", bothVisible ? 1 : (bothHidden ? 0.3 : 0.6));
            
            const label = seasonLabels[season];
            const labelSpan = item.append("span").text(label);
            
            // Style if fully hidden
            if (bothHidden) {
                labelSpan.style("opacity", 0.4).style("text-decoration", "line-through");
            } else if (!bothVisible) {
                labelSpan.style("opacity", 0.7); // Partially visible (shouldn't happen with toggle both)
            }
        });
    } else {
        // Show separate items for each season-scenario combination
        const allCombinations = [];
        visibleScenarios.forEach(scenario => {
            seasons.forEach(season => {
                const key = `${scenario}_${season}`;
                const hasData = state.seasonalData && state.seasonalData.some(
                    d => d.scenario === scenario && d.season === season
                );
                if (hasData) {
                    allCombinations.push({
                        key: key,
                        scenario: scenario,
                        season: season,
                        isVisible: state.seasonalVisibility.has(key)
                    });
                }
            });
        });

        allCombinations.forEach(combo => {
            const item = legend.append("div")
                .attr("class", "legend-item seasonal-legend-item")
                .classed("legend-item-hidden", !combo.isVisible)
                .style("cursor", "pointer")
                .on("click", function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    // Toggle visibility
                    if (state.seasonalVisibility.has(combo.key)) {
                        state.seasonalVisibility.delete(combo.key);
                    } else {
                        state.seasonalVisibility.add(combo.key);
                    }
                    
                    // Re-render the chart with updated visibility
                    renderTrendChart(state.annualData, state.monthlyData, null, state.viewMode);
                    updateYearHighlight(state.year);
                });

            const color = seasonColors[combo.season] || "#555";
            item.append("span")
                .attr("class", "legend-color")
                .style("background", color)
                .style("border", combo.scenario === "future" ? "1px dashed rgba(0,0,0,0.3)" : "none")
                .style("opacity", combo.isVisible ? (combo.scenario === "historical" ? 0.7 : 1) : 0.3);
            
            const label = `${seasonLabels[combo.season]} (${scenarioLabels[combo.scenario]})`;
            const labelSpan = item.append("span").text(label);
            
            // Style hidden items
            if (!combo.isVisible) {
                labelSpan.style("opacity", 0.4).style("text-decoration", "line-through");
            }
        });
    }
}

function renderDifferenceChart(timeseries) {
    // Calculate historical baseline (1980-2010 mean, standard climate reference period)
    const historicalBaseline = timeseries.filter(
        d => d.scenario === "historical" && d.year >= 1980 && d.year <= 2010
    );
    const baselineMean = d3.mean(historicalBaseline, d => d.clt);

    // Get all future data points
    const futureData = timeseries
        .filter(d => d.scenario === "future")
        .sort((a, b) => a.year - b.year);

    // Compute difference: future value minus historical baseline mean
    const diffSeries = futureData.map(d => ({
        year: d.year,
        diff: d.clt - baselineMean,
        future: d.clt,
        baseline: baselineMean
    }));

    const container = d3.select("#differenceChart");
    const width = Math.min(900, container.node().getBoundingClientRect().width || 900);
    const height = 320;
    const margin = { top: 22, right: 22, bottom: 56, left: 68 };

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img");

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Only render if we have data
    if (diffSeries.length === 0) {
        container.append("div")
            .style("padding", "40px")
            .style("text-align", "center")
            .style("color", "var(--muted)")
            .text("No data available for difference calculation");
        return;
    }

    const x = d3.scaleLinear()
        .domain(d3.extent(diffSeries, d => d.year))
        .range([0, innerWidth]);

    const yMax = d3.max(diffSeries, d => Math.abs(d.diff));
    const y = d3.scaleLinear()
        .domain([-(yMax * 1.1), yMax * 1.1])
        .range([innerHeight, 0]);

    const area = d3.area()
        .x(d => x(d.year))
        .y0(d => y(0))
        .y1(d => y(d.diff))
        .curve(d3.curveMonotoneX);

    const xAxis = d3.axisBottom(x).ticks(width < 640 ? 6 : 10).tickFormat(d3.format("d"));
    const yAxis = d3.axisLeft(y).ticks(6).tickFormat(d => `${d.toFixed(1)} pts`);

    const gradient = svg.append("defs")
        .append("linearGradient")
        .attr("id", "diff-gradient")
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "0%")
        .attr("y2", "100%");

    gradient.append("stop").attr("offset", "0%")
        .attr("stop-color", "var(--difference-pos)").attr("stop-opacity", 0.45);
    gradient.append("stop").attr("offset", "50%")
        .attr("stop-color", "var(--difference-pos)").attr("stop-opacity", 0.05);
    gradient.append("stop").attr("offset", "50.1%")
        .attr("stop-color", "var(--difference-neg)").attr("stop-opacity", 0.05);
    gradient.append("stop").attr("offset", "100%")
        .attr("stop-color", "var(--difference-neg)").attr("stop-opacity", 0.35);

    g.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(x).tickSize(-innerHeight).tickFormat(""));

    g.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(""));

    g.append("line")
        .attr("class", "baseline-line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", y(0))
        .attr("y2", y(0));

    g.append("path")
        .datum(diffSeries)
        .attr("class", "difference-area")
        .attr("d", area);

    g.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(xAxis);

    g.append("g")
        .attr("class", "axis")
        .call(yAxis)
        .append("text")
        .attr("class", "axis-title")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -52)
        .attr("text-anchor", "middle")
        .text("Future minus historical (percentage points)");

    const focusLine = g.append("line")
        .attr("class", "focus-line")
        .attr("y1", 0)
        .attr("y2", innerHeight);

    const focusPoint = g.append("circle")
        .attr("class", "focus-point")
        .attr("r", 5.5);

    state.diffChart = {
        data: diffSeries,
        x,
        y,
        focusLine,
        focusPoint
    };
}

function renderMap() {
    const container = d3.select("#mapChart");
    container.selectAll("*").remove();

    const width = Math.min(800, container.node().getBoundingClientRect().width || 800);
    const height = 500;
    const margin = { top: 20, right: 20, bottom: 40, left: 20 };

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img");

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Study area bounds: 30-35°N, 125-115°W (235-245°E)
    const studyBox = {
        latMin: 30,
        latMax: 35,
        lonMin: -125,  // 125°W
        lonMax: -115   // 115°W
    };

    // California approximate bounds for context
    const calBounds = {
        latMin: 32.5,
        latMax: 42,
        lonMin: -125,
        lonMax: -114
    };

    // Projection centered on study area
    const projection = d3.geoMercator()
        .center([(studyBox.lonMin + studyBox.lonMax) / 2, (studyBox.latMin + studyBox.latMax) / 2])
        .scale(2500)
        .translate([innerWidth / 2, innerHeight / 2]);

    const path = d3.geoPath().projection(projection);

    // Graticule for lat/lon reference lines
    const graticule = d3.geoGraticule()
        .extent([[studyBox.lonMin - 2, studyBox.latMin - 2], [studyBox.lonMax + 2, studyBox.latMax + 2]]);

    g.append("path")
        .datum(graticule)
        .attr("class", "map-graticule")
        .attr("d", path);

    // Simple California coastline approximation
    // Using a simplified path that roughly matches California's coast
    const californiaCoastline = {
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [[
                [-124.5, 42.0],
                [-124.2, 41.8],
                [-124.0, 41.5],
                [-123.8, 41.2],
                [-123.5, 40.8],
                [-123.2, 40.5],
                [-122.9, 40.2],
                [-122.5, 39.8],
                [-122.2, 39.5],
                [-122.0, 39.2],
                [-121.8, 38.8],
                [-121.6, 38.5],
                [-121.4, 38.2],
                [-121.2, 37.8],
                [-121.0, 37.5],
                [-120.8, 37.2],
                [-120.6, 36.8],
                [-120.4, 36.5],
                [-120.2, 36.2],
                [-120.0, 35.8],
                [-119.8, 35.5],
                [-119.6, 35.2],
                [-119.4, 34.8],
                [-119.2, 34.5],
                [-119.0, 34.2],
                [-118.8, 33.8],
                [-118.6, 33.5],
                [-118.4, 33.2],
                [-118.2, 32.8],
                [-118.0, 32.5],
                [-117.8, 32.2],
                [-117.6, 32.0],
                [-117.4, 32.0],
                [-117.2, 32.0],
                [-117.0, 32.1],
                [-116.8, 32.2],
                [-116.9, 32.4],
                [-117.1, 32.6],
                [-117.3, 32.8],
                [-117.5, 33.0],
                [-117.7, 33.2],
                [-118.0, 33.5],
                [-118.3, 33.8],
                [-118.6, 34.1],
                [-119.0, 34.5],
                [-119.3, 34.8],
                [-119.6, 35.1],
                [-120.0, 35.5],
                [-120.3, 35.8],
                [-120.6, 36.1],
                [-120.9, 36.4],
                [-121.2, 36.7],
                [-121.5, 37.0],
                [-121.8, 37.3],
                [-122.2, 37.7],
                [-122.5, 38.0],
                [-122.8, 38.3],
                [-123.2, 38.7],
                [-123.5, 39.0],
                [-123.8, 39.3],
                [-124.2, 39.7],
                [-124.5, 40.0],
                [-124.6, 40.3],
                [-124.7, 40.6],
                [-124.6, 40.9],
                [-124.5, 41.2],
                [-124.5, 41.5],
                [-124.5, 41.8],
                [-124.5, 42.0],
                [-124.5, 42.0]
            ]]
        }
    };

    // Land background
    g.append("path")
        .datum(californiaCoastline)
        .attr("class", "map-land")
        .attr("d", path);

    // Study area box
    const studyBoxGeo = {
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [[
                [studyBox.lonMin, studyBox.latMin],
                [studyBox.lonMax, studyBox.latMin],
                [studyBox.lonMax, studyBox.latMax],
                [studyBox.lonMin, studyBox.latMax],
                [studyBox.lonMin, studyBox.latMin]
            ]]
        }
    };

    g.append("path")
        .datum(studyBoxGeo)
        .attr("class", "map-study-box")
        .attr("d", path);

    // Cities
    const cities = [
        { name: "San Diego", lat: 32.7157, lon: -117.1611 },
        { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
        { name: "Santa Barbara", lat: 34.4208, lon: -119.6982 }
    ];

    const cityPoints = g.selectAll(".city")
        .data(cities)
        .enter()
        .append("g")
        .attr("class", "city-group");

    cityPoints.append("circle")
        .attr("class", "map-city")
        .attr("cx", d => projection([d.lon, d.lat])[0])
        .attr("cy", d => projection([d.lon, d.lat])[1]);

    cityPoints.append("text")
        .attr("class", "map-city-label")
        .attr("x", d => projection([d.lon, d.lat])[0] + 8)
        .attr("y", d => projection([d.lon, d.lat])[1] - 8)
        .text(d => d.name);

    // Latitude labels
    [30, 32, 34, 35].forEach(lat => {
        const [x, y] = projection([studyBox.lonMin - 1, lat]);
        g.append("text")
            .attr("class", "map-axis-label")
            .attr("x", x - 8)
            .attr("y", y + 4)
            .attr("text-anchor", "end")
            .text(`${lat}°N`);
    });

    // Longitude labels
    [-125, -120, -115].forEach(lon => {
        const [x, y] = projection([lon, studyBox.latMin - 0.5]);
        g.append("text")
            .attr("class", "map-axis-label")
            .attr("x", x)
            .attr("y", y + 14)
            .attr("text-anchor", "middle")
            .text(`${Math.abs(lon)}°W`);
    });

    // Study area label
    const [centerX, centerY] = projection([
        (studyBox.lonMin + studyBox.lonMax) / 2,
        (studyBox.latMin + studyBox.latMax) / 2
    ]);
    g.append("text")
        .attr("x", centerX)
        .attr("y", centerY)
        .attr("text-anchor", "middle")
        .attr("font-size", "13px")
        .attr("font-weight", "600")
        .attr("fill", "var(--accent-dark)")
        .text("Study Area");
}

function renderSeasonCards(seasonal) {
    const grid = d3.select("#seasonGrid");
    grid.selectAll("*").remove();

    const seasons = ["DJF", "MAM", "JJA", "SON"];
    const maxClt = d3.max(seasonal, d => d.clt);

    seasons.forEach(season => {
        const card = grid.append("div").attr("class", "season-card");
        card.append("div").attr("class", "season-title").text(season === "JJA" ? "JJA • June Gloom" : season);

        const seasonValues = scenarioOrder.map(key => ({
            scenario: key,
            value: (seasonal.find(d => d.season === season && d.scenario === key) || {}).clt
        })).filter(d => d.value !== undefined);

        const barGroup = card.append("div").attr("class", "season-bars");
        seasonValues.forEach(row => {
            const rowWrap = barGroup.append("div").attr("class", "season-row");
            rowWrap.append("span").text(scenarioLabels[row.scenario] || row.scenario);
            rowWrap.append("span").text(`${row.value.toFixed(1)}%`);

            const bar = barGroup.append("div").attr("class", "season-bar");
            bar.append("div")
                .attr("class", "season-bar-fill")
                .style("width", `${(row.value / maxClt) * 100}%`)
                .style("background", scenarioColors[row.scenario] || "#555");
        });

        const hist = seasonValues.find(d => d.scenario === "historical");
        const fut = seasonValues.find(d => d.scenario === "future");
        if (hist && fut) {
            const diff = fut.value - hist.value;
            card.append("div")
                .attr("class", "season-diff")
                .text(`${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts vs historical`);
        }
    });
}

function updateYearHighlight(value, isMonthlyValue = false) {
    if (!state.trendChart) return;

    const { x, y, focusLine, focusPoints, dataByScenario, useMonthly, useSeasonal, innerWidth } = state.trendChart;
    const isMonthly = useMonthly || false;
    const isSeasonal = (useSeasonal !== undefined) ? useSeasonal : false;
    
    // Get the x-axis domain to check if value is within visible range
    const xDomain = x.domain();
    let xValue, yearDateValue, year, month;
    
    if (isMonthly || isMonthlyValue) {
        // Value is dateValue (year + month/12)
        yearDateValue = isMonthlyValue ? value : (value + 6 / 12);
        year = Math.floor(yearDateValue);
        month = Math.round((yearDateValue - year) * 12) + 1;
        month = Math.max(1, Math.min(12, month)); // Clamp to 1-12
        xValue = yearDateValue;
        
        // Clamp to actual visible data range if zoomed
        if (state.isZoomed && state.actualDataRange && state.actualDataRange.length === 2) {
            const [minDateValue, maxDateValue] = state.actualDataRange;
            xValue = Math.max(minDateValue, Math.min(maxDateValue, yearDateValue));
        } else if (state.isZoomed && state.zoomedRange) {
            // Fallback to year boundaries
            const [startYear, endYear] = state.zoomedRange;
            const minDateValue = startYear;
            const maxDateValue = endYear + 11 / 12; // End of December in end year
            xValue = Math.max(minDateValue, Math.min(maxDateValue, yearDateValue));
        }
    } else {
        // Value is just year
        year = Math.floor(value);
        month = null;
        xValue = year;
        yearDateValue = year;
        // Clamp to visible range if zoomed (shouldn't happen in annual/seasonal, but just in case)
        if (state.isZoomed && state.zoomedRange) {
            const [startYear, endYear] = state.zoomedRange;
            xValue = Math.max(startYear, Math.min(endYear, year));
        }
    }
    
    // Calculate x position, clamped to chart bounds
    const xPos = Math.max(0, Math.min(innerWidth || 900, x(xValue)));
    const isValid = !isNaN(xPos) && isFinite(xPos) && xValue >= xDomain[0] && xValue <= xDomain[1];
    
    focusLine
        .attr("x1", isValid ? xPos : -10) // Hide if outside bounds
        .attr("x2", isValid ? xPos : -10)
        .style("opacity", isValid ? 1 : 0);

    const points = [];
    dataByScenario.forEach(s => {
        let closest;
        if (isMonthly) {
            // Find the exact month if specified, otherwise closest monthly point
            if (month !== null && month >= 1 && month <= 12) {
                // Try to find exact month
                closest = s.values.find(d => d.year === year && d.month === month);
                if (!closest) {
                    // If exact month not found, find closest in that year
                    const yearPoints = s.values.filter(d => d.year === year);
                    if (yearPoints.length > 0) {
                        closest = d3.least(yearPoints, d => Math.abs(d.month - month));
                    }
                }
                // If still not found, use closest overall
                if (!closest) {
                    closest = d3.least(s.values, d => Math.abs(d.dateValue - yearDateValue));
                }
            } else {
                // Find closest monthly point overall
                closest = d3.least(s.values, d => Math.abs(d.dateValue - yearDateValue));
            }
        } else if (isSeasonal) {
            // Find exact year match first
            closest = s.values.find(d => d.year === year);
            if (!closest) {
                const historicalEndYear = 2014;
                const futureStartYear = 2015;
                const scenario = s.scenario || s.key;
                // Only find closest if within scenario's valid range
                if ((scenario === "historical" && year <= historicalEndYear) ||
                    (scenario === "future" && year >= futureStartYear)) {
                    closest = d3.least(s.values, d => Math.abs(d.year - year));
                }
            }
        } else {
            // Find exact annual point for this year
            closest = s.values.find(d => d.year === year);
            // Only use closest match if no exact match and we're within reasonable range
            // Historical data only goes to 2014, future starts at 2015
            if (!closest) {
                const historicalEndYear = 2014;
                const futureStartYear = 2015;
                // For historical: only find closest if year <= 2014
                // For future: only find closest if year >= 2015
                if ((s.scenario === "historical" && year <= historicalEndYear) ||
                    (s.scenario === "future" && year >= futureStartYear) ||
                    (s.key === "historical" && year <= historicalEndYear) ||
                    (s.key === "future" && year >= futureStartYear)) {
                    closest = d3.least(s.values, d => Math.abs(d.year - year));
                }
            }
        }
        if (closest) {
            const xPos = isMonthly ? x(closest.dateValue) : x(closest.year);
            const yPos = y(closest.clt);
            // Only add point if it's within chart bounds
            if (!isNaN(xPos) && !isNaN(yPos) && isFinite(xPos) && isFinite(yPos) &&
                xPos >= 0 && xPos <= (innerWidth || 900) && yPos >= 0) {
                // Ensure scenario is correctly identified
                let scenario = s.scenario || s.key;
                // Handle case where key might be different format
                if (!scenario && s.values && s.values.length > 0) {
                    scenario = s.values[0].scenario;
                }
                
                points.push({
                    scenario: scenario,
                    year: closest.year,
                    clt: closest.clt,
                    x: xPos,
                    y: yPos,
                    month: closest.month,
                    season: closest.season || s.season
                });
            }
        }
    });

    const pointSel = focusPoints.selectAll("circle").data(points, d => `${d.scenario}_${d.season || ''}_${d.month || ''}`);
    pointSel.enter()
        .append("circle")
        .attr("class", "focus-point")
        .attr("r", 5.5)
        .attr("fill", d => {
            if (isSeasonal && d.season) {
                return seasonColors[d.season] || "#555";
            }
            return scenarioColors[d.scenario] || "#555";
        })
        .merge(pointSel)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .style("opacity", 1)
        .on("mouseenter", (event, d) => {
            const scenarioName = d.scenario === "historical" ? "Historical" : 
                               d.scenario === "future" ? "Future" : d.scenario;
            // Pass month as number if it exists, for proper formatting in tooltip
            const monthNum = d.month && typeof d.month === 'number' ? d.month : 
                           (d.month ? parseInt(d.month) : null);
            showTooltip(event, {
                year: d.year,
                clt: d.clt,
                scenario: scenarioName,
                month: monthNum,
                season: d.season
            });
        })
        .on("mouseleave", hideTooltip);
    pointSel.exit().remove();

    // Update the copy/info section
    if (isMonthly) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = month && month >= 1 && month <= 12 ? monthNames[month - 1] : "";
        updateYearCopy([...state.trendChart.dataByScenario.flatMap(d => d.values)], year, month);
        d3.select("#yearSlider").property("value", yearDateValue);
        // Show current value - range is already shown by updateSliderForViewMode when zoom changes
        d3.select("#yearReadout").text(month ? `${monthName} ${year}` : `Year ${year}`);
    } else {
        updateYearCopy([...state.trendChart.dataByScenario.flatMap(d => d.values)], year);
        d3.select("#yearSlider").property("value", year);
        // Show current value - range is already shown by updateSliderForViewMode
        d3.select("#yearReadout").text(`Year ${year}`);
    }
}

function updateYearCopy(timeseries, year, month = null) {
    const infoContainer = d3.select("#yearContext");

    let historical, future;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Historical data only exists up to 2014, future data starts at 2015
    const historicalEndYear = 2014;
    const futureStartYear = 2015;
    
    if (month !== null && state.isZoomed && state.monthlyData) {
        // Monthly view: find exact month
        // Only look for historical if year <= 2014
        if (year <= historicalEndYear) {
            historical = timeseries.find(d => d.scenario === "historical" && d.year === year && d.month === month);
            // If exact match not found, try closest in that year
            if (!historical) {
                historical = d3.least(
                    timeseries.filter(d => d.scenario === "historical" && d.year === year),
                    d => Math.abs(d.month - month)
                );
            }
        }
        
        // Only look for future if year >= 2015
        if (year >= futureStartYear) {
            future = timeseries.find(d => d.scenario === "future" && d.year === year && d.month === month);
            // If exact match not found, try closest in that year
            if (!future) {
                future = d3.least(
                    timeseries.filter(d => d.scenario === "future" && d.year === year),
                    d => Math.abs(d.month - month)
                );
            }
        }
    } else {
        // Annual/seasonal view: find exact year match only if within scenario's range
        // Only look for historical if year <= 2014
        if (year <= historicalEndYear) {
            historical = timeseries.find(d => d.scenario === "historical" && d.year === year);
        }
        
        // Only look for future if year >= 2015
        if (year >= futureStartYear) {
            future = timeseries.find(d => d.scenario === "future" && d.year === year);
        }
    }

    const parts = [];
    if (historical) {
        // Show scenario range instead of specific year
        parts.push(`Historical (1850-2014): ${historical.clt.toFixed(1)}%`);
    }
    if (future) {
        // Show scenario range instead of specific year
        parts.push(`Future (2015-2100): ${future.clt.toFixed(1)}%`);
    }
    if (historical && future) {
        const diff = future.clt - historical.clt;
        parts.push(`${diff >= 0 ? "+" : ""}${diff.toFixed(1)}-pt change`);
    }

    infoContainer.text(parts.join(" • "));
}

function showTooltip(event, d) {
    const container = d3.select("#trendChart");
    const containerRect = container.node().getBoundingClientRect();
    
    // Calculate position relative to chart container
    const margin = { top: 32, right: 28, bottom: 60, left: 70 };
    let tooltipX, tooltipY;
    
    if (event && event.clientX !== undefined) {
        // For mouse events, use mouse position relative to container
        tooltipX = event.clientX - containerRect.left + 16;
        tooltipY = event.clientY - containerRect.top - 12;
    } else {
        // For programmatic calls, calculate from point position
        // This will be handled by showTooltipAtHighlightedPoint
        tooltipX = event.x || 0;
        tooltipY = event.y || 0;
    }
    
    const scenarioName = scenarioLabels[d.scenario] || d.scenario;
    const seasonText = d.season ? `<br /><span>Season: ${seasonLabels[d.season] || d.season}</span>` : "";
    
    // Check if we're in monthly view (month exists and is a number between 1-12)
    const isMonthlyView = d.month && typeof d.month === 'number' && d.month >= 1 && d.month <= 12;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Format header: "Jan 2021" for monthly view, "2021" for annual/seasonal
    let headerText;
    if (isMonthlyView) {
        const monthName = monthNames[d.month - 1] || d.month;
        headerText = `<strong>${monthName} ${d.year}</strong>`;
    } else {
        headerText = `<strong>${d.year}</strong>`;
    }
    
    // Don't show month text separately in monthly view (already in header)
    // Only show season if it exists
    
    // Move tooltip into chart container for proper absolute positioning
    const containerNode = container.node();
    if (containerNode && tooltip.node().parentNode !== containerNode) {
        containerNode.appendChild(tooltip.node());
    }
    
    tooltip
        .style("left", `${tooltipX}px`)
        .style("top", `${tooltipY}px`)
        .style("opacity", 1)
        .style("transform", "translateY(0)")
        .html(`${headerText}<span style="color: #b0b0b0;">${scenarioName}</span>${seasonText}<br /><span>${d.clt.toFixed(2)}% cloud fraction</span>`);
}

function hideTooltip() {
    tooltip
        .style("opacity", 0)
        .style("transform", "translateY(-8px)");
}

function showTooltipAtHighlightedPoint() {
    if (!state.trendChart) return;
    
    const { focusPoints, innerWidth, innerHeight, dataByScenario } = state.trendChart;
    const container = d3.select("#trendChart");
    
    // Collect all point data from the circles
    const pointDataArray = [];
    focusPoints.selectAll("circle").each(function(d) {
        if (d && d.x !== undefined && d.y !== undefined) {
            pointDataArray.push(d);
        }
    });
    
    if (pointDataArray.length === 0) {
        // If no points found, try to get data directly from state
        const { useMonthly, useSeasonal, x, y } = state.trendChart;
        const isMonthly = useMonthly || false;
        const isSeasonal = (useSeasonal !== undefined) ? useSeasonal : false;
        
        let year, month;
        if (isMonthly && state.monthValue !== null) {
            year = Math.floor(state.monthValue);
            month = Math.round((state.monthValue - year) * 12) + 1;
            month = Math.max(1, Math.min(12, month));
        } else {
            year = state.year;
            month = null;
        }
        
        // Find points directly from data
        dataByScenario.forEach(s => {
            let closest;
            if (isMonthly && month !== null) {
                closest = s.values.find(d => d.year === year && d.month === month);
                if (!closest) {
                    const yearPoints = s.values.filter(d => d.year === year);
                    if (yearPoints.length > 0) {
                        closest = d3.least(yearPoints, d => Math.abs(d.month - month));
                    }
                }
            } else if (isSeasonal) {
                // Find exact year match first
                closest = s.values.find(d => d.year === year);
                if (!closest) {
                    const historicalEndYear = 2014;
                    const futureStartYear = 2015;
                    const scenario = s.scenario || s.key;
                    // Only find closest if within scenario's valid range
                    if ((scenario === "historical" && year <= historicalEndYear) ||
                        (scenario === "future" && year >= futureStartYear)) {
                        closest = d3.least(s.values, d => Math.abs(d.year - year));
                    }
                }
            } else {
                // Annual view: find exact year match
                closest = s.values.find(d => d.year === year);
                if (!closest) {
                    const historicalEndYear = 2014;
                    const futureStartYear = 2015;
                    const scenario = s.scenario || s.key;
                    // Only find closest if within scenario's valid range
                    // Historical data only goes to 2014, future starts at 2015
                    if ((scenario === "historical" && year <= historicalEndYear) ||
                        (scenario === "future" && year >= futureStartYear)) {
                        closest = d3.least(s.values, d => Math.abs(d.year - year));
                    }
                }
            }
            
            if (closest) {
                const xPos = isMonthly ? x(closest.dateValue || (closest.year + (closest.month - 1) / 12)) : x(closest.year);
                const yPos = y(closest.clt);
                // Ensure scenario is correctly identified
                let scenario = s.scenario || s.key;
                // Handle case where key might be different format
                if (!scenario && closest.scenario) {
                    scenario = closest.scenario;
                }
                
                pointDataArray.push({
                    scenario: scenario,
                    year: closest.year,
                    clt: closest.clt,
                    x: xPos,
                    y: yPos,
                    month: closest.month,
                    season: closest.season || s.season
                });
            }
        });
    }
    
    if (pointDataArray.length === 0) return;
    
    // Use first point or average position
    const firstPoint = pointDataArray[0];
    const avgX = pointDataArray.reduce((sum, p) => sum + p.x, 0) / pointDataArray.length;
    const avgY = pointDataArray.reduce((sum, p) => sum + p.y, 0) / pointDataArray.length;
    const xPos = pointDataArray.length > 1 ? avgX : firstPoint.x;
    const yPos = pointDataArray.length > 1 ? avgY : firstPoint.y;
    
    // Position relative to chart container (not viewport)
    const margin = { top: 32, right: 28, bottom: 60, left: 70 };
    const tooltipX = margin.left + xPos + 16;
    const tooltipY = margin.top + yPos - 12;
    
    // Ensure tooltip is inside the chart container
    const containerNode = container.node();
    if (!containerNode) return;
    
    // Move tooltip into chart container if not already there
    if (tooltip.node().parentNode !== containerNode) {
        containerNode.appendChild(tooltip.node());
    }
    
    // Show tooltip for all points (or first if multiple)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Check if we're in seasonal view
    const { useSeasonal } = state.trendChart || {};
    const isSeasonalView = useSeasonal || false;
    
    // Check if we're in monthly view (month exists and is a number between 1-12)
    const isMonthlyView = firstPoint.month && typeof firstPoint.month === 'number' && firstPoint.month >= 1 && firstPoint.month <= 12;
    
    // Format header: "Jan 2021" for monthly view, "2021" for annual/seasonal
    let headerText;
    if (isMonthlyView) {
        const monthName = monthNames[firstPoint.month - 1] || firstPoint.month;
        headerText = `<strong>${monthName} ${firstPoint.year}</strong>`;
    } else {
        headerText = `<strong>${firstPoint.year}</strong>`;
    }
    
    // If multiple scenarios/seasons, show info for all
    let html = headerText;
    if (pointDataArray.length > 1) {
        // In seasonal view, show scenario name first, then season names
        if (isSeasonalView) {
            // Group points by scenario to show scenario name once
            const scenarioGroups = {};
            pointDataArray.forEach((p, i) => {
                const scenario = p.scenario || 'unknown';
                if (!scenarioGroups[scenario]) {
                    scenarioGroups[scenario] = [];
                }
                scenarioGroups[scenario].push(p);
            });
            
            // Display each scenario with its seasons
            Object.keys(scenarioGroups).forEach((scenario, idx) => {
                const scnName = scenarioLabels[scenario] || scenario;
                const seasonPoints = scenarioGroups[scenario];
                
                // Show scenario name on same line as header (no break), then seasons on new lines
                // Use grey color for scenario names
                if (idx === 0) {
                    html += `<span style="color: #b0b0b0;">${scnName}</span>`;
                } else {
                    html += `<br /><span style="color: #b0b0b0;">${scnName}</span>`;
                }
                
                // Show each season for this scenario
                seasonPoints.forEach((p) => {
                    const seasonName = p.season ? (seasonLabels[p.season] || p.season) : '';
                    if (seasonName) {
                        html += `<br /><span>${seasonName}: ${p.clt.toFixed(2)}%</span>`;
                    }
                });
            });
        } else {
            // Show all scenarios (for annual/monthly view)
            pointDataArray.forEach((p, i) => {
                const scnName = scenarioLabels[p.scenario] || p.scenario;
                html += `<br /><span style="color: #b0b0b0;">${scnName}</span>: <span>${p.clt.toFixed(2)}%</span>`;
            });
        }
    } else {
        // Single point - format based on view mode
        if (isSeasonalView && firstPoint.season) {
            // In seasonal view, show scenario name on same line as header, then season name
            const scenarioName = scenarioLabels[firstPoint.scenario] || firstPoint.scenario;
            const seasonName = seasonLabels[firstPoint.season] || firstPoint.season;
            html += `<span style="color: #b0b0b0;">${scenarioName}</span><br /><span>${seasonName}: ${firstPoint.clt.toFixed(2)}%</span>`;
        } else {
            // In annual/monthly view, show scenario name
            const scenarioName = scenarioLabels[firstPoint.scenario] || firstPoint.scenario;
            const seasonText = firstPoint.season ? `<br /><span>Season: ${seasonLabels[firstPoint.season] || firstPoint.season}</span>` : "";
            html += `<span style="color: #b0b0b0;">${scenarioName}</span>${seasonText}<br /><span>${firstPoint.clt.toFixed(2)}% cloud fraction</span>`;
        }
    }
    
    tooltip
        .style("left", `${tooltipX}px`)
        .style("top", `${tooltipY}px`)
        .style("opacity", 1)
        .style("transform", "translateY(0)")
        .html(html);
}

