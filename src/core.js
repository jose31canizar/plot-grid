/**
 * Abstract plot-grid class, with no specific renderer
 *
 * @module  plot-grid/src/core
 */

'use strict';

const Component = require('gl-component');
const inherits = require('inherits');
const isBrowser = require('is-browser');
const extend = require('just-extend');
const range = require('just-range');
const pick = require('just-pick');
const clamp = require('mumath/clamp');
const panzoom = require('pan-zoom');
const alpha = require('color-alpha');
const isObj = require('is-plain-obj');
const parseUnit = require('parse-unit');
const toPx = require('to-px');
const types = require('./types');


module.exports = Grid;


Grid.types = types;


inherits(Grid, Component);


//constructor
function Grid (opts) {
	if (!(this instanceof Grid)) return new Grid(opts);

	if (!isBrowser) return;

	Component.call(this, extend(pick(this, [
		'container', 'viewport', 'context', 'autostart'
	]), opts));

	//set default coords as xy
	if (opts.r == null && opts.a == null && opts.y == null && opts.x == null) {
		opts.x = true;
		opts.y = true;
	}

	//create x/y/r
	this.x = extend({disabled: true}, Grid.prototype.x, opts.x);
	this.y = extend({disabled: true}, Grid.prototype.y, opts.y);
	this.r = extend({disabled: true}, Grid.prototype.r, opts.r);
	this.a = extend({disabled: true}, Grid.prototype.a, opts.a);

	//enable proper lines
	if (opts.x !== undefined) this.x.disabled = !opts.x;
	if (opts.y !== undefined) this.y.disabled = !opts.y;
	if (opts.r !== undefined) this.r.disabled = !opts.r;
	if (opts.a !== undefined) this.a.disabled = !opts.a;

	//create rendering state
	this.state = {};

	this.update(opts);

	this.on('resize', () => this.update());

	//enable interactions
	if (this.container && this.canvas) {
		//FIXME: make sure that interaction happens within actual viewport
		panzoom(this.canvas, (e) => {
			let [left, top, width, height] = this.viewport;

			//shift start
			let zoom = clamp(-e.dz, -height*.75, height*.75)/height;

			let x = {offset: this.x.offset, scale: this.x.scale},
				y = {offset: this.y.offset, scale: this.y.scale};

			//pan
			if (!this.x.disabled) {
				let oX = this.x && this.x.origin || 0;
				if (this.x.pan) {
					x.offset -= this.x.scale * e.dx;
				}
				if (this.x.zoom !== false) {
					let tx = (e.x-left)/width - oX;
					let prevScale = x.scale;
					x.scale *= (1 - zoom);
					x.scale = clamp(x.scale, this.x.minScale, this.x.maxScale);
					x.offset -= width*(x.scale - prevScale) * tx;
				}
			}
			if (!this.y.disabled) {
				let oY = this.y && this.y.origin || 0;
				if (this.y.pan) {
					y.offset += y.scale * e.dy;
				}
				if (this.y.zoom !== false) {
					let ty = oY-(e.y-top)/height;
					let prevScale = y.scale;
					y.scale *= (1 - zoom);
					y.scale = clamp(y.scale, this.y.minScale, this.y.maxScale);
					y.offset -= height*(y.scale - prevScale) * ty;
				}
			}

			this.update({x, y});
		});
	}
}


//re-evaluate lines, calc options for renderer
Grid.prototype.update = function (opts) {
	if (opts) {
		//take over types properties
		if  (opts.x && opts.x.type) extend(opts.x, Grid.types[opts.x.type]);
		if  (opts.y && opts.y.type) extend(opts.y, Grid.types[opts.y.type]);
		if  (opts.r && opts.r.type) extend(opts.r, Grid.types[opts.r.type]);
		if  (opts.a && opts.a.type) extend(opts.a, Grid.types[opts.a.type]);

		//extend props
		if (opts.x) extend(this.x, opts.x);
		if (opts.y) extend(this.y, opts.y);
		if (opts.r) extend(this.r, opts.r);
		if (opts.a) extend(this.a, opts.a);
	}

	//normalize, make sure range/offset are not off the limits
	if (!this.x.disabled) {
		let range = this.x.getRange({viewport: this.viewport, lines: this.x});
		this.x.offset = clamp(this.x.offset, this.x.min, Math.max(this.x.max - range, this.x.min));
	}

	if (!this.y.disabled) {
		let range = this.y.getRange({viewport: this.viewport, lines: this.y});
		this.y.offset = clamp(this.y.offset, this.y.min, Math.max(this.y.max - range, this.y.min));
	}

	//recalc state
	this.state.x = this.calcLines(this.x, this.viewport, this);
	this.state.y = this.calcLines(this.y, this.viewport, this);

	this.state.x.opposite = this.state.y;
	this.state.y.opposite = this.state.x;

	this.emit('update', opts);

	this.render();

	return this;
}


//get state object with calculated params, ready for rendering
Grid.prototype.calcLines = function (lines, vp) {
	let state = {
		lines: lines,
		viewport: vp,
		grid: this
	};

	//calculate real offset/range
	state.range = lines.getRange(state);
	state.offset = clamp(
		lines.offset - state.range * clamp(lines.origin, 0, 1),
		Math.max(lines.min, -Number.MAX_VALUE+1), Math.min(lines.max, Number.MAX_VALUE) - state.range
	);

	//calc style
	state.axisColor = typeof lines.axisColor === 'number' ? alpha(lines.color, lines.axisColor) : lines.axisColor || lines.color;
	state.axisWidth = lines.axisWidth || lines.lineWidth;
	state.lineWidth = lines.lineWidth;
	state.tickAlign = lines.tickAlign;
	state.labelColor = state.color;
	state.lineColor = typeof lines.lineColor === 'number' ? alpha(lines.color, lines.lineColor) : lines.lineColor || lines.color;
	state.sublineColor = typeof lines.sublineColor === 'number' ? alpha(lines.color, lines.sublineColor) : lines.sublineColor || lines.color;
	state.tick = lines.tick;
	state.subtick = lines.subtick;

	//get padding
	if (typeof lines.padding === 'number') {
		state.padding = Array(4).fill(lines.padding);
	}
	else if (lines.padding instanceof Function) {
		state.padding = lines.padding(state);
	}
	else {
		state.padding = lines.padding;
	}

	//calc font
	if (typeof lines.fontSize === 'number') {
		state.fontSize = lines.fontSize
	}
	else {
		let units = parseUnit(lines.fontSize);
		state.fontSize = units[0] * toPx(units[1]);
	}
	state.fontFamily = lines.fontFamily || 'sans-serif';

	//get lines stops
	let values;
	if (lines.lines instanceof Function) {
		values = lines.lines(state);
	}
	else {
		values = lines.lines || [];
	}
	state.values = values;

	let subvalues;
	if (lines.sublines instanceof Function) {
		subvalues = lines.sublines(state);
	}
	//draw sublines only when they are not disabled
	else if ((lines.sublines === true || lines.sublines === undefined) && (lines.lines instanceof Function)) {
		let scale = state.scale;
		state.scale = scale/3;
		//FIXME: if sublines return object?
		subvalues = lines.lines(state).filter(v => {
			return values.indexOf(v) >= 0;
		});
		state.scale = scale;
	}
	else {
		subvalues = lines.sublines;
	}
	state.subvalues = subvalues;

	//calc labels
	let labels;
	if (lines.labels === true) labels = values;
	else if (lines.labels instanceof Function) {
		labels = lines.labels(state);
	}
	else if (Array.isArray(lines.labels)) {
		labels = lines.labels;
	}
	else {
		labels = Array(values.length).fill(null);
	}
	state.labels = labels;

	//convert hashmap ticks/labels to values + colors
	if (isObj(labels)) {
		state.labels = Array(values.length).fill(null);
		for (let value in labels) {
			state.labels.push(labels[value]);
			state.values.push(parseFloat(value));
		}
	}

	return state;
};



//default values
Grid.prototype.defaults = extend({
	type: 'linear',
	name: '',
	units: '',

	//visible range params
	min: -Infinity,
	max: Infinity,
	offset: 0,
	origin: .5,
	scale: 1,
	minScale: Number.EPSILON || 1.19209290e-7,
	maxScale: Number.MAX_VALUE || 1e100,
	zoom: true,
	pan: true,

	//labels
	labels: true,
	fontSize: '10pt',
	fontFamily: 'sans-serif',
	padding: 0,
	color: 'rgb(0,0,0,1)',

	//lines params
	lines: true,
	sublines: true,
	tick: 8,
	subtick: 0,
	tickAlign: .5,
	lineWidth: 1,
	distance: 120,
	style: 'lines',
	lineColor: .4,
	sublineColor: .1,

	//axis params
	axis: true,
	axisOrigin: 0,
	axisWidth: 2,
	axisColor: 1,

	//stub methods
	//return coords for the values, redefined by axes
	getCoords: (values, state) => [0,0,0,0],

	//return 0..1 ratio based on value/offset/range, redefined by axes
	getRatio: (value, state) => 0
}, types.linear);


Grid.prototype.x = extend({}, Grid.prototype.defaults, {
	orientation: 'x',
	getCoords: (values, state) => {
		let coords = [];
		if (!values) return coords;
		for (let i = 0; i < values.length; i++) {
			let t = state.lines.getRatio(values[i], state);
			coords.push(t);
			coords.push(0);
			coords.push(t);
			coords.push(1);
		}
		return coords;
	},
	getRange: state => {
		return state.viewport[2] * state.lines.scale;
	},
	//FIXME: handle infinity case here
	getRatio: (value, state) => {
		return (value - state.offset) / state.range
	}
});
Grid.prototype.y = extend({}, Grid.prototype.defaults, {
	orientation: 'y',
	getCoords: (values, state) => {
		let coords = [];
		if (!values) return coords;
		for (let i = 0; i < values.length; i++) {
			let t = state.lines.getRatio(values[i], state);
			coords.push(0);
			coords.push(t);
			coords.push(1);
			coords.push(t);
		}
		return coords;
	},
	getRange: state => {
		return state.viewport[3] * state.lines.scale;
	},
	getRatio: (value, state) => {
		return 1 - (value - state.offset) / state.range
	}
});
Grid.prototype.r = extend({}, Grid.prototype.defaults, {
	orientation: 'r'
});
Grid.prototype.a = extend({}, Grid.prototype.defaults, {
	orientation: 'a'
});
