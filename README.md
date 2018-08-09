# atom-time-tracer

Atomatic time tracking powered by any command line tool (default is [watson](http://tailordev.github.io/Watson/)) for Atom.
No more forgetting to start the timer!

## Installation

```bash
apm install time-tracer
```

## Usage

This package tracks your interactions in Atom.
Whenever you do something actively a timer is started.
The timer stops if you haven't done anything in a while.

Since everything is configurable you can use this package with any time
tracking tool you want.
Most of the configuration is done in Atom's settings panel.
But project-specific settings can be defined in a `timetracer.config.js` file.
See [the example config](https://github.com/jneuendorf/atom-time-tracer/blob/master/timetracer.config.js)
for details.

### Status bar

Unless disabled, there is a status bar tile which shows a watch and the time until the timer
will be stopped (using a mini pie chart).
On hover the time spent on the project is displayed. 
On click a chart is displayed showing how much you worked on what tags.

![Status bar tile screenshot](./img/status-bar-tile.png)