/**
 * @fileOverview A D3 based distribution chart system. Supports: Box plots, Violin plots, Notched box plots, trend lines, beeswarm plot
 * @version 2.5
 */

/**
 * Creates a box plot, violin plot, and or notched box plot
 * @param settings Configuration options for the base plot
 * @param settings.data The data for the plot
 * @param settings.xName The name of the column that should be used for the x groups
 * @param settings.yName The name of the column used for the y values
 * @param {string} settings.selector The selector string for the main chart div
 * @param [settings.axisLabels={}] Defaults to the xName and yName
 * @param [settings.scale='linear'] 'linear' or 'log' - y scale of the chart
 * @param [settings.chartSize={width:800, height:400}] The height and width of the chart itself (doesn't include the container)
 * @param [settings.margin={top: 15, right: 60, bottom: 40, left: 50}] The margins around the chart (inside the main div)
 * @param [settings.constrainExtremes=false] Should the y scale include outliers?
 * @returns {object} chart A chart object
 */

// Modified from https://github.com/asielen/D3_Reusable_Charts
// Original under MIT licence
// Wenjie Sun
// Jan 30 2018

function makeDistroChart(settings) {

    var chart = {};

    // Defaults
    chart.settings = {
        data: null,
        xName: null,
        xCode: null,
        yName: null,
        selector: null,
        axisLables: null,
        scale:'linear',
        chartSize:{width:800,height:400},
        margin:{top: 15, right: 10, bottom: 100, left: 150},
        constrainExtremes:false,
        color:d3.scale.category10()};
    for (var setting in settings) {chart.settings[setting] = settings[setting]}

    function x_rename(id) {
        return chart.settings.xCode[id];
    }

    function formatAsFloat(d) {
        if (d % 1 !== 0) {
            return d3.format(".2f")(d);
        } else {
            return d3.format(".0f")(d);
        }
    }
    function logFormatNumber(d) {
        var x = Math.log(d) / Math.log(10) + 1e-6;
        return Math.abs(x - Math.floor(x)) < 0.6 ? formatAsFloat(d) : "";
    }
    chart.yFormatter = formatAsFloat;

    chart.data = chart.settings.data;

    chart.groupObjs = {}; //The data organized by grouping and sorted as well as any metadata for the groups
    chart.objs = {mainDiv: null, chartDiv: null, g: null, xAxis: null, yAxis: null};
    chart.colorFunct = null;

    /**
     * Takes an array, function, or object mapping and created a color function from it
     * @param {function|[]|object} colorOptions
     * @returns {function} Function to be used to determine chart colors
     */
    function getColorFunct(colorOptions) {
        if (typeof colorOptions == 'function') {
            return colorOptions
        } else if (Array.isArray(colorOptions)) {
            //  If an array is provided, map it to the domain
            var colorMap = {}, cColor = 0;
            for (var cName in chart.groupObjs) {
                colorMap[cName] = colorOptions[cColor];
                cColor = (cColor + 1) % colorOptions.length;
            }
            return function (group) {
                return colorMap[group];
            }
        } else if (typeof colorOptions == 'object') {
            // if an object is provided, assume it maps to  the colors
            return function (group) {
                return colorOptions[group];
            }
        } else {
            return d3.scale.category10();
        }
    }

    /**
     * Takes a percentage as returns the values that correspond to that percentage of the group range witdh
     * @param objWidth Percentage of range band
     * @param gName The bin name to use to get the x shift
     * @returns {{left: null, right: null, middle: null}}
     */
    function getObjWidth(objWidth, gName) {
        var objSize = {left: null, right: null, middle: null};
        var width = chart.xScale.rangeBand() * (objWidth / 100);
        var padding = (chart.xScale.rangeBand() - width) / 2;
        var gShift = chart.xScale(gName);
        objSize.middle = chart.xScale.rangeBand() / 2 + gShift;
        objSize.left = padding + gShift;
        objSize.right = objSize.left + width;
        return objSize;
    }

    /**
     * Adds jitter to the  scatter point plot
     * @param doJitter true or false, add jitter to the point
     * @param width percent of the range band to cover with the jitter
     * @returns {number}
     */
    function addJitter(doJitter, width) {
            if (doJitter!==true || width==0) {return 0}
            return Math.floor(Math.random() * width)-width/2;
    }

    function shallowCopy(oldObj) {
        var newObj = {};
        for(var i in oldObj) {
            if(oldObj.hasOwnProperty(i)) {
                newObj[i] = oldObj[i];
            }
        }
        return newObj;
    }

    /**
     * Closure that creates the tooltip hover function
     * @param groupName Name of the x group
     * @param metrics Object to use to get values for the group
     * @returns {Function} A function that provides the values for the tooltip
     */
    function tooltipHover(groupName, metrics) {
        var tooltipString = "Group: " + x_rename(groupName);
        tooltipString += "<br\>Max: " + formatAsFloat(metrics.max, 0.1);
        tooltipString += "<br\>Q3: " + formatAsFloat(metrics.quartile3);
        tooltipString += "<br\>Median: " + formatAsFloat(metrics.median);
        tooltipString += "<br\>Q1: " + formatAsFloat(metrics.quartile1);
        tooltipString += "<br\>Min: " + formatAsFloat(metrics.min);
        return function () {
            chart.objs.tooltip.transition().duration(200).style("opacity", 0.9);
            chart.objs.tooltip.html(tooltipString)
        };
    }

    /**
     * Parse the data and calculates base values for the plots
     */
    !function prepareData() {
        function calcMetrics(values) {

            var metrics = { //These are the original non–scaled values
                max: null,
                upperOuterFence: null,
                upperInnerFence: null,
                quartile3: null,
                median: null,
                mean: null,
                iqr: null,
                quartile1: null,
                lowerInnerFence: null,
                lowerOuterFence: null,
                min: null
            };

            metrics.min = d3.min(values);
            metrics.quartile1 = d3.quantile(values, 0.25);
            metrics.median = d3.median(values);
            metrics.mean = d3.mean(values);
            metrics.quartile3 = d3.quantile(values, 0.75);
            metrics.max = d3.max(values);
            metrics.iqr = metrics.quartile3 - metrics.quartile1;

            //The inner fences are the closest value to the IQR without going past it (assumes sorted lists)
            var LIF = metrics.quartile1 - (1.5 * metrics.iqr);
            var UIF = metrics.quartile3 + (1.5 * metrics.iqr);
            for (var i = 0; i <= values.length; i++) {
                if (values[i] < LIF) {
                    continue;
                }
                if (!metrics.lowerInnerFence && values[i] >= LIF) {
                    metrics.lowerInnerFence = values[i];
                    continue;
                }
                if (values[i] > UIF) {
                    metrics.upperInnerFence = values[i - 1];
                    break;
                }
            }


            metrics.lowerOuterFence = metrics.quartile1 - (3 * metrics.iqr);
            metrics.upperOuterFence = metrics.quartile3 + (3 * metrics.iqr);
            if (!metrics.lowerInnerFence) {
                metrics.lowerInnerFence = metrics.min;
            }
            if (!metrics.upperInnerFence) {
                metrics.upperInnerFence = metrics.max;
            }
            return metrics
        }

        var current_x = null;
        var current_y = null;
        var current_row;

        // Group the values
        for (current_row = 0; current_row < chart.data.length; current_row++) {
            current_x = chart.data[current_row][chart.settings.xName];
            current_y = chart.data[current_row][chart.settings.yName];

            if (chart.groupObjs.hasOwnProperty(current_x)) {
                chart.groupObjs[current_x].values.push(current_y);
            } else {
                chart.groupObjs[current_x] = {};
                chart.groupObjs[current_x].values = [current_y];
            }
        }

        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].values.sort(d3.ascending);
            chart.groupObjs[cName].metrics = {};
            chart.groupObjs[cName].metrics = calcMetrics(chart.groupObjs[cName].values);

        }
    }();

    /**
     * Prepare the chart settings and chart div and svg
     */
    !function prepareSettings() {
        //Set base settings
        chart.margin = chart.settings.margin;
        chart.divWidth = chart.settings.chartSize.width;
        chart.divHeight = chart.settings.chartSize.height;
        chart.width = chart.divWidth - chart.margin.left - chart.margin.right;
        chart.height = chart.divHeight - chart.margin.top - chart.margin.bottom;

        if (chart.settings.axisLabels) {
            chart.xAxisLable = chart.settings.axisLabels.xAxis;
            chart.yAxisLable = chart.settings.axisLabels.yAxis;
        } else {
            chart.xAxisLable = chart.settings.xName;
            chart.yAxisLable = chart.settings.yName;
        }

        if (chart.settings.scale === 'log') {
            chart.yScale = d3.scale.log();
            chart.yFormatter = logFormatNumber;
        } else {
            chart.yScale = d3.scale.linear();
        }

        if (chart.settings.constrainExtremes === true) {
            var fences = [];
            for (var cName in chart.groupObjs) {
                fences.push(chart.groupObjs[cName].metrics.lowerInnerFence);
                fences.push(chart.groupObjs[cName].metrics.upperInnerFence);
            }
            chart.range = d3.extent(fences);

        } else {
            chart.range = d3.extent(chart.data, function (d) {
                return d[chart.settings.yName];
            });
        }

        chart.colorFunct = getColorFunct(chart.settings.colors);

        // Build Scale functions
        chart.yScale.range([chart.height, 0]).domain(chart.range).nice().clamp(true);
        chart.xScale = d3.scale.ordinal().domain(Object.keys(chart.groupObjs)).rangeBands([0, chart.width]);

        //Build Axes Functions
        chart.objs.yAxis = d3.svg.axis()
            .scale(chart.yScale)
            .orient("left")
            // Using default formatter function
            .tickFormat(d3.format(".2f"))
            .outerTickSize(0)
            .innerTickSize(-chart.width + (chart.margin.right + chart.margin.left));

        chart.objs.xAxis = d3.svg.axis()
            .scale(chart.xScale)
            // using tick formatter to change the tick name
            .tickFormat(x_rename)
            .orient("bottom").tickSize(5);
    }();

    /**
     * Updates the chart based on the current settings and window size
     * @returns {*}
     */
    chart.update = function () {
        // Update chart size based on view port size
        chart.width = parseInt(chart.objs.chartDiv.style("width"), 10) - (chart.margin.left + chart.margin.right);
        chart.height = parseInt(chart.objs.chartDiv.style("height"), 10) - (chart.margin.top + chart.margin.bottom);

        // Update scale functions
        chart.xScale.rangeBands([0, chart.width]);
        chart.yScale.range([chart.height, 0]);

        //Update axes
        chart.objs.g.select('.x.axis').attr("transform", "translate(0," + chart.height + ")").call(chart.objs.xAxis)
            .selectAll("text")
            .attr("y", 5)
            .attr("x", -5)
            .attr("transform", "rotate(-20)")
            .style("text-anchor", "end");
        chart.objs.g.select('.x.axis .label').attr("x", chart.width / 2);
        chart.objs.g.select('.y.axis').call(chart.objs.yAxis.innerTickSize(-chart.width));
        chart.objs.g.select('.y.axis .label').attr("x", -chart.height / 2);
        chart.objs.chartDiv.select('svg').attr("width", chart.width + (chart.margin.left + chart.margin.right)).attr("height", chart.height + (chart.margin.top + chart.margin.bottom));

        return chart;
    };

    /**
     * Prepare the chart html elements
     */
    !function prepareChart() {
        // Build main div and chart div
        chart.objs.mainDiv = d3.select(chart.settings.selector)
            .style("max-width", chart.divWidth + "px");
        // Add all the divs to make it centered and responsive
        chart.objs.mainDiv.append("div")
            .attr("class", "inner-wrapper")
            .style("padding-bottom", (chart.divHeight / chart.divWidth) * 100 + "%")
            .append("div").attr("class", "outer-box")
            .append("div").attr("class", "inner-box");
        // Capture the inner div for the chart (where the chart actually is)
        chart.selector = chart.settings.selector + " .inner-box";
        chart.objs.chartDiv = d3.select(chart.selector);
        d3.select(window).on('resize.' + chart.selector, chart.update);

        // Create the svg
        chart.objs.g = chart.objs.chartDiv.append("svg")
            .attr("class", "chart-area")
            .attr("width", chart.width + (chart.margin.left + chart.margin.right))
            .attr("height", chart.height + (chart.margin.top + chart.margin.bottom))
            .append("g")
            .attr("transform", "translate(" + chart.margin.left + "," + chart.margin.top + ")");

        // Create axes
        chart.objs.axes = chart.objs.g.append("g").attr("class", "axis");
        chart.objs.axes.append("g")
            .attr("class", "x axis")
            .attr("transform", "translate(0," + chart.height + ")")
            .call(chart.objs.xAxis);
        chart.objs.axes.append("g")
            .attr("class", "y axis")
            .call(chart.objs.yAxis)
            .append("text")
            .attr("class", "label")
            .attr("transform", "rotate(-90)")
            .attr("y", -42)
            .attr("x", -chart.height / 2)
            .attr("dy", "-1em")
            .style("text-anchor", "middle")
            .text(chart.yAxisLable);

        // Create tooltip div
        chart.objs.tooltip = chart.objs.mainDiv.append('div').attr('class', 'tooltip');
        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].g = chart.objs.g.append("g").attr("class", "group");
            chart.groupObjs[cName].g.on("mouseover", function () {
                chart.objs.tooltip
                    .style("display", null)
                    .style("padding", "3px")
                    .style("left", (d3.event.pageX) + "px")
                    .style("top", (d3.event.pageY - 28) + "px");
            }).on("mouseout", function () {
                chart.objs.tooltip.style("display", "none");
                chart.objs.tooltip.style("padding", "0");
            }).on("mousemove", tooltipHover(cName, chart.groupObjs[cName].metrics))
        }
        chart.update();
    }();

    /**
     * Render a violin plot on the current chart
     * @param options
     * @param [options.showViolinPlot=true] True or False, show the violin plot
     * @param [options.resolution=calculated based on values]
     * @param [options.width=90] The max percent of the group rangeBand that the violin can be
     * @param [options.interpolation=''] How to render the violin
     * @param [options.colors=chart default] The color mapping for the violin plot
     * @returns {*} The chart object
     */
    chart.renderViolinPlot = function (options) {
        chart.violinPlots = {};
        //chart.violinPlots.plots = {};

        var defaultOptions = {
            show:true,
            showViolinPlot:true,
            resolution:null,
            width:65,
            interpolation:'basis-open',
            colors:chart.colorFunct};
        chart.violinPlots.options  = shallowCopy(defaultOptions);
        for (var option in options) {chart.violinPlots.options[option] = options[option]}
        var vOpts = chart.violinPlots.options;

        // Create violin plot objects
        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].violin = {};
            chart.groupObjs[cName].violin.objs = {};
            chart.groupObjs[cName].violin.histogramFunct = d3.layout.histogram().frequency(1);
        }

        /**
         * Calculate the ideal number of bins from the cGroup's values
         * @param cName
         * @returns {number} Number of bins
         */
        function calcNumBins(cName) {
            var iqr;
            if (chart.boxPlots) {
                iqr = chart.groupObjs[cName].metrics.iqr
            } else {
                var quartile1 = d3.quantile(chart.groupObjs[cName].values, 0.25);
                var quartile3 = d3.quantile(chart.groupObjs[cName].values, 0.75);
                iqr = quartile3 - quartile1;
            }
            return Math.max(Math.round(2 * (iqr / Math.pow(chart.groupObjs[cName].values.length, 1 / 3))), 10)
        }
        
        /**
         * Take a new set of options and redraw the violin
         * @param updateOptions
         */
        chart.violinPlots.change = function (updateOptions) {
            if (updateOptions) {for (var key in updateOptions) {vOpts[key] = updateOptions[key]}}

            for (var cName in chart.groupObjs) {chart.groupObjs[cName].violin.objs.g.remove()}
            chart.violinPlots.prepareViolin();
            chart.violinPlots.update()
        };

        chart.violinPlots.reset = function () {chart.violinPlots.change(defaultOptions)};
        chart.violinPlots.show = function (opts) {
            if (opts!==undefined) {
                opts.show=true;
                if (opts.reset) {chart.violinPlots.reset()}
            } else {opts = {show:true};}
            chart.violinPlots.change(opts)};
        chart.violinPlots.hide = function (opts) {
            if (opts!==undefined) {
                opts.show=false;
                if (opts.reset) {chart.violinPlots.reset()}
            } else {opts = {show:false};}
            chart.violinPlots.change(opts)};
        
        /**
         * Update the violin obj values
         */
        chart.violinPlots.update = function () {
            var cName, cViolinPlot;

            for (cName in chart.groupObjs) {
                cViolinPlot = chart.groupObjs[cName].violin;

                if (vOpts.resolution) {
                    cViolinPlot.histogramFunct.bins(vOpts.resolution);
                } else {
                    cViolinPlot.histogramFunct.bins(calcNumBins(cName));
                }

                cViolinPlot.histogramData = cViolinPlot.histogramFunct(chart.groupObjs[cName].values);

                // Get the violin width
                var objBounds = getObjWidth(vOpts.width, cName);

                var width = (objBounds.right - objBounds.left) / 2;

                // Build the violins sideways, so use the yScale for the xScale and make a new yScale
                var xVScale = chart.yScale.copy();
                var yVScale = d3.scale.linear()
                    .range([width, 0])
                    .domain([0,d3.max(cViolinPlot.histogramData, function (d) {return d.y;})])
                    .clamp(true);

                var area = d3.svg.area()
                    .interpolate(vOpts.interpolation)
                    .x(function (d) {return xVScale(d.x);})
                    .y0(width)
                    .y1(function (d) {return yVScale(d.y);});

                var line = d3.svg.line()
                    .interpolate(vOpts.interpolation)
                    .x(function (d) {return xVScale(d.x);})
                    .y(function (d) {return yVScale(d.y)});


                if (cViolinPlot.objs.left.area) {
                    cViolinPlot.objs.left.area
                        .datum(cViolinPlot.histogramData)
                        .attr("d", area);
                    cViolinPlot.objs.left.line
                        .datum(cViolinPlot.histogramData)
                        .attr("d", line);

                    cViolinPlot.objs.right.area
                        .datum(cViolinPlot.histogramData)
                        .attr("d", area);
                    cViolinPlot.objs.right.line
                        .datum(cViolinPlot.histogramData)
                        .attr("d", line);
                }

                // Rotate the violins
                cViolinPlot.objs.left.g.attr("transform", "rotate(90,0,0)   translate(0,-" + objBounds.left + ")  scale(1,-1)");
                cViolinPlot.objs.right.g.attr("transform", "rotate(90,0,0)  translate(0,-" + objBounds.right + ")");
            }
        };

        /**
         * Create the svg elements for the violin plot
         */
        chart.violinPlots.prepareViolin = function() {
            var cName, cViolinPlot;

            if (vOpts.colors) {
                chart.violinPlots.color = getColorFunct(vOpts.colors);
            } else {
                chart.violinPlots.color = chart.colorFunct
            }
            
            if (vOpts.show==false) {return}
            
            for (cName in chart.groupObjs) {
                cViolinPlot = chart.groupObjs[cName].violin;

                cViolinPlot.objs.g = chart.groupObjs[cName].g.append("g").attr("class", "violin-plot");
                cViolinPlot.objs.left = {area: null, line: null, g: null};
                cViolinPlot.objs.right = {area: null, line: null, g: null};

                cViolinPlot.objs.left.g = cViolinPlot.objs.g.append("g");
                cViolinPlot.objs.right.g = cViolinPlot.objs.g.append("g");

                if (vOpts.showViolinPlot !== false) {
                    //Area
                    cViolinPlot.objs.left.area = cViolinPlot.objs.left.g.append("path")
                        .attr("class", "area")
                        .style("fill", chart.violinPlots.color(cName));
                    cViolinPlot.objs.right.area = cViolinPlot.objs.right.g.append("path")
                        .attr("class", "area")
                        .style("fill", chart.violinPlots.color(cName));

                    //Lines
                    cViolinPlot.objs.left.line = cViolinPlot.objs.left.g.append("path")
                        .attr("class", "line")
                        .attr("fill", 'none')
                        .style("stroke", chart.violinPlots.color(cName));
                    cViolinPlot.objs.right.line = cViolinPlot.objs.right.g.append("path")
                        .attr("class", "line")
                        .attr("fill", 'none')
                        .style("stroke", chart.violinPlots.color(cName));
                }

            }

        };
        chart.violinPlots.prepareViolin();

        d3.select(window).on('resize.' + chart.selector + '.violinPlot', chart.violinPlots.update);
        chart.violinPlots.update();
        return chart;
    };

    /**
     * Render a box plot on the current chart
     * @param options
     * @param [options.show=true] Toggle the whole plot on and off
     * @param [options.showBox=true] Show the box part of the box plot
     * @param [options.showWhiskers=true] Show the whiskers
     * @param [options.showMedian=true] Show the median line
     * @param [options.showMean=false] Show the mean line
     * @param [options.medianCSize=3] The size of the circle on the median
     * @param [options.showOutliers=true] Plot outliers
     * @param [options.boxwidth=30] The max percent of the group rangeBand that the box can be
     * @param [options.lineWidth=boxWidth] The max percent of the group rangeBand that the line can be
     * @param [options.outlierScatter=false] Spread out the outliers so they don't all overlap (in development)
     * @param [options.outlierCSize=2] Size of the outliers
     * @param [options.colors=chart default] The color mapping for the box plot
     * @returns {*} The chart object
     */
    chart.renderBoxPlot = function (options) {
        chart.boxPlots = {};

        // Defaults
        var defaultOptions = {
            show:true,
            showBox:true,
            showWhiskers:true,
            showMedian:true,
            showMean:false,
            medianCSize:3.5,
            showOutliers:true,
            boxWidth:30,
            lineWidth:null,
            scatterOutliers:false,
            outlierCSize:2.5,
            colors:chart.colorFunct};
        chart.boxPlots.options = shallowCopy(defaultOptions);
        for (var option in options) {chart.boxPlots.options[option] = options[option]}
        var bOpts = chart.boxPlots.options;
        
        //Create box plot objects
        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].boxPlot = {};
            chart.groupObjs[cName].boxPlot.objs = {};
        }


        /**
         * Calculates all the outlier points for each group
         */
        !function calcAllOutliers() {

            /**
             * Create lists of the outliers for each content group
             * @param cGroup The object to modify
             * @return null Modifies the object in place
             */
            function calcOutliers(cGroup) {
                var cExtremes = [];
                var cOutliers = [];
                var cOut, idx;
                for (idx = 0; idx <= cGroup.values.length; idx++) {
                    cOut = {value: cGroup.values[idx]};

                    if (cOut.value < cGroup.metrics.lowerInnerFence) {
                        if (cOut.value < cGroup.metrics.lowerOuterFence) {
                            cExtremes.push(cOut);
                        } else {
                            cOutliers.push(cOut);
                        }
                    } else if (cOut.value > cGroup.metrics.upperInnerFence) {
                        if (cOut.value > cGroup.metrics.upperOuterFence) {
                            cExtremes.push(cOut);
                        } else {
                            cOutliers.push(cOut);
                        }
                    }
                }
                cGroup.boxPlot.objs.outliers = cOutliers;
                cGroup.boxPlot.objs.extremes = cExtremes;
            }

            for (var cName in chart.groupObjs) {
                calcOutliers(chart.groupObjs[cName]);
            }
        }();

        /**
         * Take updated options and redraw the box plot
         * @param updateOptions
         */
        chart.boxPlots.change = function (updateOptions) {
            if (updateOptions) {for (var key in updateOptions) {bOpts[key] = updateOptions[key]}}

            for (var cName in chart.groupObjs) {chart.groupObjs[cName].boxPlot.objs.g.remove()}
            chart.boxPlots.prepareBoxPlot();
            chart.boxPlots.update()
        };
        
        chart.boxPlots.reset = function () {chart.boxPlots.change(defaultOptions)};
        chart.boxPlots.show = function (opts) {
            if (opts!==undefined) {
                opts.show=true;
                if (opts.reset) {chart.boxPlots.reset()}
            } else {opts = {show:true};}
            chart.boxPlots.change(opts)};
        chart.boxPlots.hide = function (opts) {
            if (opts!==undefined) {
                opts.show=false;
                if (opts.reset) {chart.boxPlots.reset()}
            } else {opts = {show:false};}
            chart.boxPlots.change(opts)};
        
        /**
         * Update the box plot obj values
         */
        chart.boxPlots.update = function () {
            var cName, cBoxPlot;

            for (cName in chart.groupObjs) {
                cBoxPlot = chart.groupObjs[cName].boxPlot;

                // Get the box width
                var objBounds = getObjWidth(bOpts.boxWidth, cName);
                var width = (objBounds.right - objBounds.left);

                var sMetrics = {}; //temp var for scaled (plottable) metric values
                for (var attr in chart.groupObjs[cName].metrics) {
                    sMetrics[attr] = null;
                    sMetrics[attr] = chart.yScale(chart.groupObjs[cName].metrics[attr]);
                }

                // Box
                if (cBoxPlot.objs.box) {
                    cBoxPlot.objs.box
                        .attr("x", objBounds.left)
                        .attr('width', width)
                        .attr("y", sMetrics.quartile3)
                        .attr("rx", 1)
                        .attr("ry", 1)
                        .attr("height", -sMetrics.quartile3 + sMetrics.quartile1)
                }

                // Lines
                var lineBounds = null;
                if (bOpts.lineWidth) {
                    lineBounds = getObjWidth(bOpts.lineWidth, cName)
                } else {
                    lineBounds = objBounds
                }
                // --Whiskers
                if (cBoxPlot.objs.upperWhisker) {
                    cBoxPlot.objs.upperWhisker.fence
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', sMetrics.upperInnerFence)
                        .attr("y2", sMetrics.upperInnerFence);
                    cBoxPlot.objs.upperWhisker.line
                        .attr("x1", lineBounds.middle)
                        .attr("x2", lineBounds.middle)
                        .attr('y1', sMetrics.quartile3)
                        .attr("y2", sMetrics.upperInnerFence);

                    cBoxPlot.objs.lowerWhisker.fence
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', sMetrics.lowerInnerFence)
                        .attr("y2", sMetrics.lowerInnerFence);
                    cBoxPlot.objs.lowerWhisker.line
                        .attr("x1", lineBounds.middle)
                        .attr("x2", lineBounds.middle)
                        .attr('y1', sMetrics.quartile1)
                        .attr("y2", sMetrics.lowerInnerFence);
                }

                // --Median
                if (cBoxPlot.objs.median) {
                    cBoxPlot.objs.median.line
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', sMetrics.median)
                        .attr("y2", sMetrics.median);
                    cBoxPlot.objs.median.circle
                        .attr("cx", lineBounds.middle)
                        .attr("cy", sMetrics.median)
                }

                // --Mean
                if (cBoxPlot.objs.mean) {
                    cBoxPlot.objs.mean.line
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', sMetrics.mean)
                        .attr("y2", sMetrics.mean);
                    cBoxPlot.objs.mean.circle
                        .attr("cx", lineBounds.middle)
                        .attr("cy", sMetrics.mean);
                }

                // Outliers

                var pt;
                if (cBoxPlot.objs.outliers) {
                    for (pt in cBoxPlot.objs.outliers) {
                        cBoxPlot.objs.outliers[pt].point
                            .attr("cx", objBounds.middle+addJitter(bOpts.scatterOutliers,width))
                            .attr("cy", chart.yScale(cBoxPlot.objs.outliers[pt].value));
                    }
                }
                if (cBoxPlot.objs.extremes) {
                    for (pt in cBoxPlot.objs.extremes) {
                        cBoxPlot.objs.extremes[pt].point
                            .attr("cx", objBounds.middle+addJitter(bOpts.scatterOutliers,width))
                            .attr("cy", chart.yScale(cBoxPlot.objs.extremes[pt].value));
                    }
                }
            }
        };

        /**
         * Create the svg elements for the box plot
         */
        chart.boxPlots.prepareBoxPlot = function() {
            var cName, cBoxPlot;

            if (bOpts.colors) {
                chart.boxPlots.colorFunct = getColorFunct(bOpts.colors);
            } else {
                chart.boxPlots.colorFunct = chart.colorFunct
            }
            
            if (bOpts.show==false) {return}
            
            for (cName in chart.groupObjs) {
                cBoxPlot = chart.groupObjs[cName].boxPlot;

                cBoxPlot.objs.g = chart.groupObjs[cName].g.append("g").attr("class", "box-plot");

                //Plot Box (default show)
                if (bOpts.showBox) {
                    cBoxPlot.objs.box = cBoxPlot.objs.g.append("rect")
                        .attr("class", "box")
                        .style("fill", chart.boxPlots.colorFunct(cName))
                        .style("stroke", chart.boxPlots.colorFunct(cName));
                        //A stroke is added to the box with the group color, it is
                        // hidden by default and can be shown through css with stroke-width
                }

                //Plot Median (default show)
                if (bOpts.showMedian) {
                    cBoxPlot.objs.median = {line: null, circle: null};
                    cBoxPlot.objs.median.line = cBoxPlot.objs.g.append("line")
                        .attr("class", "median");
                    cBoxPlot.objs.median.circle = cBoxPlot.objs.g.append("circle")
                        .attr("class", "median")
                        .attr('r', bOpts.medianCSize)
                        .style("fill", chart.boxPlots.colorFunct(cName));
                }

                // Plot Mean (default no plot)
                if (bOpts.showMean) {
                    cBoxPlot.objs.mean = {line: null, circle: null};
                    cBoxPlot.objs.mean.line = cBoxPlot.objs.g.append("line")
                        .attr("class", "mean");
                    cBoxPlot.objs.mean.circle = cBoxPlot.objs.g.append("circle")
                        .attr("class", "mean")
                        .attr('r', bOpts.medianCSize)
                        .style("fill", chart.boxPlots.colorFunct(cName));
                }

                // Plot Whiskers (default show)
                if (bOpts.showWhiskers) {
                    cBoxPlot.objs.upperWhisker = {fence: null, line: null};
                    cBoxPlot.objs.lowerWhisker = {fence: null, line: null};
                    cBoxPlot.objs.upperWhisker.fence = cBoxPlot.objs.g.append("line")
                        .attr("class", "upper whisker")
                        .style("stroke", chart.boxPlots.colorFunct(cName));
                    cBoxPlot.objs.upperWhisker.line = cBoxPlot.objs.g.append("line")
                        .attr("class", "upper whisker")
                        .style("stroke", chart.boxPlots.colorFunct(cName));

                    cBoxPlot.objs.lowerWhisker.fence = cBoxPlot.objs.g.append("line")
                        .attr("class", "lower whisker")
                        .style("stroke", chart.boxPlots.colorFunct(cName));
                    cBoxPlot.objs.lowerWhisker.line = cBoxPlot.objs.g.append("line")
                        .attr("class", "lower whisker")
                        .style("stroke", chart.boxPlots.colorFunct(cName));
                }

                // Plot outliers (default show)
                if (bOpts.showOutliers) {
                    if (!cBoxPlot.objs.outliers) calcAllOutliers();
                    var pt;
                    if (cBoxPlot.objs.outliers.length) {
                        var outDiv = cBoxPlot.objs.g.append("g").attr("class", "boxplot outliers");
                        for (pt in cBoxPlot.objs.outliers) {
                            cBoxPlot.objs.outliers[pt].point = outDiv.append("circle")
                                .attr("class", "outlier")
                                .attr('r', bOpts.outlierCSize)
                                .style("fill", chart.boxPlots.colorFunct(cName));
                        }
                    }

                    if (cBoxPlot.objs.extremes.length) {
                        var extDiv = cBoxPlot.objs.g.append("g").attr("class", "boxplot extremes");
                        for (pt in cBoxPlot.objs.extremes) {
                            cBoxPlot.objs.extremes[pt].point = extDiv.append("circle")
                                .attr("class", "extreme")
                                .attr('r', bOpts.outlierCSize)
                                .style("stroke", chart.boxPlots.colorFunct(cName));
                        }
                    }
                }


            }
        };
        chart.boxPlots.prepareBoxPlot();

        d3.select(window).on('resize.' + chart.selector + '.boxPlot', chart.boxPlots.update);
        chart.boxPlots.update();
        return chart;

    };

    /**
     * Render a notched box on the current chart
     * @param options
     * @param [options.show=true] Toggle the whole plot on and off
     * @param [options.showNotchBox=true] Show the notch box
     * @param [options.showLines=false] Show lines at the confidence intervals
     * @param [options.boxWidth=35] The width of the widest part of the box
     * @param [options.medianWidth=20] The width of the narrowist part of the box
     * @param [options.lineWidth=50] The width of the confidence interval lines
     * @param [options.notchStyle=null] null=traditional style, 'box' cuts out the whole notch in right angles
     * @param [options.colors=chart default] The color mapping for the notch boxes
     * @returns {*} The chart object
     */
    chart.renderNotchBoxes = function (options) {
        chart.notchBoxes = {};

        //Defaults
        var defaultOptions = {
                            show:true,
                            showNotchBox:true,
                            showLines:false,
                            boxWidth:35,
                            medianWidth:20,
                            lineWidth:50,
                            notchStyle:null,
                            colors:null};
        chart.notchBoxes.options = shallowCopy(defaultOptions);
        for (var option in options) {chart.notchBoxes.options[option] = options[option]}
        var nOpts = chart.notchBoxes.options;

        //Create notch objects
        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].notchBox = {};
            chart.groupObjs[cName].notchBox.objs = {};
        }

        /**
         * Makes the svg path string for a notched box
         * @param cNotch Current notch box object
         * @param notchBounds objBound object
         * @returns {string} A string in the proper format for a svg polygon
         */
        function makeNotchBox(cNotch, notchBounds) {
            var scaledValues = [];
            if (nOpts.notchStyle=='box') {
                scaledValues = [
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.quartile1)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.medianLeft, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.medianLeft, chart.yScale(cNotch.metrics.median)],
                    [notchBounds.medianLeft, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.quartile3)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.quartile3)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.medianRight, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.medianRight, chart.yScale(cNotch.metrics.median)],
                    [notchBounds.medianRight, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.quartile1)]
                ];
            } else {
                scaledValues = [
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.quartile1)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.medianLeft, chart.yScale(cNotch.metrics.median)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.boxLeft, chart.yScale(cNotch.metrics.quartile3)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.quartile3)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.upperNotch)],
                    [notchBounds.medianRight, chart.yScale(cNotch.metrics.median)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.lowerNotch)],
                    [notchBounds.boxRight, chart.yScale(cNotch.metrics.quartile1)]
                ];
            }
            return scaledValues.map(function(d) { return [d[0],d[1]].join(","); }).join(" ");
        }

        /**
         * Calculate the confidence intervals
         */
        !function calcNotches() {
            var cNotch,modifier;
            for (var cName in chart.groupObjs) {
                cNotch = chart.groupObjs[cName];
                modifier = (1.57 * (cNotch.metrics.iqr/Math.sqrt(cNotch.values.length)));
                cNotch.metrics.upperNotch = cNotch.metrics.median + modifier;
                cNotch.metrics.lowerNotch = cNotch.metrics.median - modifier;
            }
        }();

        /**
         * Take a new set of options and redraw the notch boxes
         * @param updateOptions
         */
        chart.notchBoxes.change = function(updateOptions) {
            if (updateOptions) {for (var key in updateOptions) {nOpts[key] = updateOptions[key]}}

            for (var cName in chart.groupObjs) {chart.groupObjs[cName].notchBox.objs.g.remove()}
            chart.notchBoxes.prepareNotchBoxes();
            chart.notchBoxes.update();
        };

        chart.notchBoxes.reset = function () {chart.notchBoxes.change(defaultOptions)};
        chart.notchBoxes.show = function (opts) {
            if (opts!==undefined) {
                opts.show=true;
                if (opts.reset) {chart.notchBoxes.reset()}
            } else {opts = {show:true};}
            chart.notchBoxes.change(opts)};
        chart.notchBoxes.hide = function (opts) {
            if (opts!==undefined) {
                opts.show=false;
                if (opts.reset) {chart.notchBoxes.reset()}
            } else {opts = {show:false};}
            chart.notchBoxes.change(opts)};
        
        /**
         * Update the notch box obj values
         */
        chart.notchBoxes.update = function () {
            var cName, cGroup;

            for (cName in chart.groupObjs) {
                cGroup = chart.groupObjs[cName];

                // Get the box size
                var boxBounds = getObjWidth(nOpts.boxWidth, cName);
                var medianBounds = getObjWidth(nOpts.medianWidth, cName);

                var notchBounds = {boxLeft:boxBounds.left,
                                    boxRight:boxBounds.right,
                                    middle:boxBounds.middle,
                                    medianLeft:medianBounds.left,
                                    medianRight:medianBounds.right};

                // Notch Box
                if (cGroup.notchBox.objs.notch) {
                    cGroup.notchBox.objs.notch
                        .attr("points",makeNotchBox(cGroup, notchBounds));
                }
                if (cGroup.notchBox.objs.upperLine) {
                    var lineBounds = null;
                    if (nOpts.lineWidth) {
                        lineBounds = getObjWidth(nOpts.lineWidth, cName)
                    } else {
                        lineBounds = objBounds
                    }

                    var confidenceLines = {
                        upper:chart.yScale(cGroup.metrics.upperNotch),
                        lower:chart.yScale(cGroup.metrics.lowerNotch)
                    };
                    cGroup.notchBox.objs.upperLine
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', confidenceLines.upper)
                        .attr("y2", confidenceLines.upper);
                    cGroup.notchBox.objs.lowerLine
                        .attr("x1", lineBounds.left)
                        .attr("x2", lineBounds.right)
                        .attr('y1', confidenceLines.lower)
                        .attr("y2", confidenceLines.lower);
                }
            }
        };

        /**
         * Create the svg elements for the notch boxes
         */
        chart.notchBoxes.prepareNotchBoxes = function()  {
            var cName, cNotch;

            if (nOpts && nOpts.colors) {
                chart.notchBoxes.colorFunct = getColorFunct(nOpts.colors);
            } else {
                chart.notchBoxes.colorFunct = chart.colorFunct
            }
    
            if (nOpts.show==false) {return}
            
            for (cName in chart.groupObjs) {
                cNotch = chart.groupObjs[cName].notchBox;

                cNotch.objs.g = chart.groupObjs[cName].g.append("g").attr("class", "notch-plot");

                // Plot Box (default show)
                if (nOpts.showNotchBox) {
                    cNotch.objs.notch = cNotch.objs.g.append("polygon")
                        .attr("class", "notch")
                        .style("fill", chart.notchBoxes.colorFunct(cName))
                        .style("stroke", chart.notchBoxes.colorFunct(cName));
                        //A stroke is added to the notch with the group color, it is
                        // hidden by default and can be shown through css with stroke-width
                }

                //Plot Confidence Lines (default hide)
                if (nOpts.showLines) {
                    cNotch.objs.upperLine = cNotch.objs.g.append("line")
                        .attr("class", "upper confidence line")
                        .style("stroke", chart.notchBoxes.colorFunct(cName));

                    cNotch.objs.lowerLine = cNotch.objs.g.append("line")
                        .attr("class", "lower confidence line")
                        .style("stroke", chart.notchBoxes.colorFunct(cName));
                }
            }
        };
        chart.notchBoxes.prepareNotchBoxes();

        d3.select(window).on('resize.' + chart.selector + '.notchBox', chart.notchBoxes.update);
        chart.notchBoxes.update();
        return chart;
    };

    /**
     * Render a raw data in various forms
     * @param options
     * @param [options.show=true] Toggle the whole plot on and off
     * @param [options.showPlot=false] True or false, show points
     * @param [options.plotType='none'] Options: no scatter = (false or 'none'); scatter points= (true or [amount=% of width (default=10)]); beeswarm points = ('beeswarm')
     * @param [options.pointSize=6] Diameter of the circle in pizels (not the radius)
     * @param [options.showLines=['median']] Can equal any of the metrics lines
     * @param [options.showbeanLines=false] Options: no lines = false
     * @param [options.beanWidth=20] % width
     * @param [options.colors=chart default]
     * @returns {*} The chart object
     *
     */
    chart.renderDataPlots = function (options) {
        chart.dataPlots = {};


        //Defaults
        var defaultOptions = {
                            show:true,
                            showPlot:false,
                            plotType:'none',
                            pointSize:6,
                            showLines:false,//['median'],
                            showBeanLines:false,
                            beanWidth:20,
                            colors:null};
        chart.dataPlots.options = shallowCopy(defaultOptions)
        for (var option in options) {chart.dataPlots.options[option] = options[option]}
        var dOpts = chart.dataPlots.options;

        //Create notch objects
        for (var cName in chart.groupObjs) {
            chart.groupObjs[cName].dataPlots = {};
            chart.groupObjs[cName].dataPlots.objs = {};
        }
        // The lines don't fit into a group bucket so they live under the dataPlot object
        chart.dataPlots.objs = {};

        /**
         * Take updated options and redraw the data plots
         * @param updateOptions
         */
        chart.dataPlots.change = function (updateOptions) {
            if (updateOptions) {for (var key in updateOptions) {dOpts[key] = updateOptions[key]}}

            chart.dataPlots.objs.g.remove();
            for (var cName in chart.groupObjs) {chart.groupObjs[cName].dataPlots.objs.g.remove()}
            chart.dataPlots.preparePlots();
            chart.dataPlots.update()
        };
        
        chart.dataPlots.reset = function () {chart.dataPlots.change(defaultOptions)};
        chart.dataPlots.show = function (opts) {
            if (opts!==undefined) {
                opts.show=true;
                if (opts.reset) {chart.dataPlots.reset()}
            } else {opts = {show:true};}
            chart.dataPlots.change(opts)};
        chart.dataPlots.hide = function (opts) {
            if (opts!==undefined) {
                opts.show=false;
                if (opts.reset) {chart.dataPlots.reset()}
            } else {opts = {show:false};}
            chart.dataPlots.change(opts)};
        
        /**
         * Update the data plot obj values
         */
        chart.dataPlots.update = function () {
            var cName, cGroup, cPlot;

            // Metrics lines
            if (chart.dataPlots.objs.g) {
                var halfBand = chart.xScale.rangeBand()/2; // find the middle of each band
                for (var cMetric in chart.dataPlots.objs.lines) {
                    chart.dataPlots.objs.lines[cMetric].line
                        .x(function (d) {return chart.xScale(d.x)+halfBand});
                    chart.dataPlots.objs.lines[cMetric].g
                        .datum(chart.dataPlots.objs.lines[cMetric].values)
                        .attr('d',chart.dataPlots.objs.lines[cMetric].line);
                }
            }


            for (cName in chart.groupObjs) {
                cGroup = chart.groupObjs[cName];
                cPlot = cGroup.dataPlots;

                if (cPlot.objs.points) {
                    if (dOpts.plotType=='beeswarm') {
                        var swarmBounds = getObjWidth(100, cName);
                        var yPtScale = chart.yScale.copy()
                            .range([Math.floor(chart.yScale.range()[0]/dOpts.pointSize),0])
                            .interpolate(d3.interpolateRound)
                            .domain(chart.yScale.domain());
                        var maxWidth = Math.floor(chart.xScale.rangeBand()/dOpts.pointSize);
                        var ptsObj = {};
                        var cYBucket = null;
                        //  Bucket points
                        for (var pt = 0; pt<cGroup.values.length; pt++) {
                            cYBucket = yPtScale(cGroup.values[pt]);
                            if (ptsObj.hasOwnProperty(cYBucket)!==true) {ptsObj[cYBucket]=[];}
                            ptsObj[cYBucket].push(cPlot.objs.points.pts[pt]
                                .attr("cx", swarmBounds.middle)
                                .attr("cy", yPtScale(cGroup.values[pt])*dOpts.pointSize));
                        }
                        //  Plot buckets
                        var rightMax = Math.min(swarmBounds.right-dOpts.pointSize);
                        for (var row in ptsObj) {
                            var leftMin = swarmBounds.left+(Math.max((maxWidth - ptsObj[row].length)/2, 0)*dOpts.pointSize);
                            var col = 0;
                            for (pt in ptsObj[row]) {
                                ptsObj[row][pt].attr("cx", Math.min(leftMin+col*dOpts.pointSize,rightMax)+dOpts.pointSize/2);
                                col++
                            }
                        }
                    } else { // For scatter points and points with no scatter
                        var plotBounds = null,
                            scatterWidth=0,
                            width= 0;
                        if (dOpts.plotType=='scatter' || typeof dOpts.plotType=='number') {
                            //Default scatter percentage is 20% of box width
                            scatterWidth = typeof dOpts.plotType == 'number' ? dOpts.plotType : 20;
                        }

                        plotBounds = getObjWidth(scatterWidth, cName);
                        width = plotBounds.right - plotBounds.left;

                        for (var pt = 0; pt<cGroup.values.length; pt++) {
                            cPlot.objs.points.pts[pt]
                                .attr("cx", plotBounds.middle+addJitter(true,width))
                                .attr("cy", chart.yScale(cGroup.values[pt]));
                        }
                    }
                }


                if (cPlot.objs.bean) {
                    var beanBounds = getObjWidth(dOpts.beanWidth, cName);
                    for (var pt = 0; pt<cGroup.values.length; pt++) {
                        cPlot.objs.bean.lines[pt]
                            .attr("x1", beanBounds.left)
                            .attr("x2", beanBounds.right)
                            .attr('y1', chart.yScale(cGroup.values[pt]))
                            .attr("y2", chart.yScale(cGroup.values[pt]));
                    }
                }
            }
        };

        /**
         * Create the svg elements for the data plots
         */
        chart.dataPlots.preparePlots = function () {
            var cName, cPlot;

            if (dOpts && dOpts.colors) {
                chart.dataPlots.colorFunct = getColorFunct(dOpts.colors);
            } else {
                chart.dataPlots.colorFunct = chart.colorFunct
            }
            
            if (dOpts.show==false) {return}

            // Metrics lines
            chart.dataPlots.objs.g = chart.objs.g.append("g").attr("class", "metrics-lines");
            if (dOpts.showLines && dOpts.showLines.length > 0) {
                chart.dataPlots.objs.lines = {};
                var cMetric;
                for (var line in dOpts.showLines) {
                    cMetric = dOpts.showLines[line];
                    chart.dataPlots.objs.lines[cMetric] = {};
                    chart.dataPlots.objs.lines[cMetric].values = [];
                    for (var cGroup in chart.groupObjs) {
                        chart.dataPlots.objs.lines[cMetric].values.push({x:cGroup, y:chart.groupObjs[cGroup].metrics[cMetric]})
                    }
                    chart.dataPlots.objs.lines[cMetric].line = d3.svg.line()
                        .interpolate("cardinal")
                        .y(function (d) {return chart.yScale(d.y)});
                    chart.dataPlots.objs.lines[cMetric].g = chart.dataPlots.objs.g.append("path")
                        .attr("class", "line "+cMetric)
                        .attr("data-metric", cMetric)
                        .style("fill", 'none')
                        .style("stroke", chart.colorFunct(cMetric));
                }

            }


            for (cName in chart.groupObjs) {

                cPlot = chart.groupObjs[cName].dataPlots;
                cPlot.objs.g = chart.groupObjs[cName].g.append("g").attr("class", "data-plot");

                // Points Plot
                if (dOpts.showPlot) {
                    cPlot.objs.points = {g: null, pts: []};
                    cPlot.objs.points.g = cPlot.objs.g.append("g").attr("class", "points-plot");
                    for (var pt = 0; pt < chart.groupObjs[cName].values.length; pt++) {
                        cPlot.objs.points.pts.push(cPlot.objs.points.g.append("circle")
                            .attr("class", "point")
                            .attr('r', dOpts.pointSize/2)// Options is diameter, r takes radius so divide by 2
                            .style("fill", chart.dataPlots.colorFunct(cName)));
                    }
                }


                // Bean lines
                if (dOpts.showBeanLines) {
                    cPlot.objs.bean = {g: null, lines: []};
                    cPlot.objs.bean.g = cPlot.objs.g.append("g").attr("class", "bean-plot");
                    for (var pt = 0; pt < chart.groupObjs[cName].values.length; pt++) {
                    cPlot.objs.bean.lines.push(cPlot.objs.bean.g.append("line")
                        .attr("class", "bean line")
                        .style("stroke-width", '1')
                        .style("stroke", chart.dataPlots.colorFunct(cName)));
                    }
                }
            }

        };
        chart.dataPlots.preparePlots();

        d3.select(window).on('resize.' + chart.selector + '.dataPlot', chart.dataPlots.update);
        chart.dataPlots.update();
        return chart;
    };

    return chart;
}
