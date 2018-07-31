'use babel'

import Chart from 'chart.js/dist/Chart.bundle.min.js'
import moment from 'moment'
import throttle from 'lodash.throttle'

import StatusBarTile from './status-bar-tile'
import Commands from './commands'
import {config, get as getSetting} from './config'
import {
    getTimeracerConfig,
    replacePlaceholders,
    runCommand,
    getWindowId,
    setWindowId,
    setMinus,
    getTagColor,
} from './utils'


class TimeTracer {
    config = config
    lastEdit = 0
    timer = null
    statusBarInterval = null
    isTracking = false
    // stoppedAfterTimeout = false

    _throttledHandleActivity = null

    async activate(state) {
        const timetracerConfig = await getTimeracerConfig()
        const chartColors = getSetting('tracking.preferedChartColors')
        this.settings = {
            ...timetracerConfig,
            tracking: {
                startOnOpen: getSetting('tracking.startOnOpen'),
                waitTillAutoStop: getSetting('tracking.waitTillAutoStop'),
                regardedEvents: getSetting('tracking.regardedEvents').split(' '),
                // parallel: getSetting('tracking.parallel'),
                chartColors: (() => {
                    let index = 0
                    const colors = chartColors.split(' ')
                    const usedIndices = {}
                    return tag => {
                        let color
                        if (usedIndices.hasOwnProperty(tag)) {
                            color = colors[usedIndices[tag]]
                        }
                        else {
                            const i = index++
                            usedIndices[tag] = i
                            color = colors[i]
                        }
                        if (!color) {
                            color = getTagColor(tag)
                        }
                        return color
                    }
                })(),
            },
            tool: {
                start: getSetting('tool.start'),
                stop: getSetting('tool.stop'),
                report: getSetting('tool.report'),
                log: getSetting('tool.log'),
            },
        }
        console.log(this.settings)

        this.currentWindow = atom.getCurrentWindow()
        this.currentWindow.on('focus', this.handleFocusWindow)
        // this.currentWindow.on('closed', this.stop)

        this.fileWatcher = atom.project.onDidChangeFiles(this.handleActivity)
        for (const eventType of this.settings.tracking.regardedEvents) {
            document.addEventListener(
                eventType,
                this.handleActivity,
            )
        }

        if (getSetting('tracking.startOnOpen')) {
            this.handleActivity()
        }

        atom.commands.add('atom-workspace', Commands.boundTo(this))
    }

    deactivate() {
        this.stop()
        this.fileWatcher.dispose()
        this.statusBarTile.destroy()
        for (const eventType of this.settings.tracking.regardedEvents) {
            document.removeEventListener(
                eventType,
                this.handleActivity,
            )
        }
    }

    consumeStatusBar(statusBar) {
        this.statusBarTile = new StatusBarTile(statusBar)
    }

    async start() {
        if (this.isTracking) {
            return
        }

        const command = this._getCommand('start')
        try {
            const {stdout, stderr} = await runCommand(command)
            if (stderr) {
                console.warn(stderr)
                atom.notifications.addWarning(
                    `Time tracking started without an error but something was printed to 'stderr': ${stderr}`,
                    {dismissable: true}
                )
            }
            else {
                console.log('stdout:', stdout)
                this.isTracking = true
                // this.stoppedAfterTimeout = false
            }
        }
        catch (error) {
            atom.notifications.addError(
                `Failed to start time tracking. Reason: ${error.message}`,
                {dismissable: true},
            )
        }
    }

    async stop() {
        if (!this.isTracking) {
            return
        }

        console.log('stopping......', atom.getCurrentWindow().getTitle())
        const command = this._getCommand('stop')
        try {
            const {stdout, stderr} = await runCommand(command)
            if (stderr) {
                console.warn(stderr)
                atom.notifications.addWarning(
                    `Time tracking stopped without an error but something was printed to 'stderr': ${stderr}`,
                    {dismissable: true}
                )
            }
            else {
                console.log('stdout:', stdout)
                this.isTracking = false
            }
        }
        catch (error) {
            atom.notifications.addError(
                `Failed to stop time tracking. Reason: ${error.message}`,
                {dismissable: true},
            )
        }
    }

    async resetTimer() {
        clearTimeout(this.timer)
        clearInterval(this.statusBarInterval)

        const seconds = await this.getSeconds()

        const now = Date.now()
        const {waitTillAutoStop} = this.settings.tracking
        const msTillAutoStop = waitTillAutoStop * 1000
        if (now - this.lastEdit > msTillAutoStop && this.lastEdit > 0) {
            this.stop()
            // this.stoppedAfterTimeout = true
            this.updateStatusBar({seconds, percent: 0})
        }
        else {
            this.timer = setTimeout(() => this.resetTimer(), msTillAutoStop)
            this.updateStatusBar({seconds, percent: 1})
            const tickMs = Math.max(1000, msTillAutoStop / 100)
            let elapsed = 0
            this.statusBarInterval = setInterval(() => {
                elapsed += tickMs
                const percent = elapsed / msTillAutoStop
                if (percent > 1) {
                    clearInterval(this.statusBarInterval)
                }
                this.updateStatusBar({percent: 1 - percent})
            }, tickMs)
        }
        this.lastEdit = now
    }

    async report() {
        const command = this._getCommand('log')
        const {stdout} = await runCommand(command)
        const reportData = JSON.parse(stdout)
        // this.assertShape(reportData)
        // console.log(reportData)

        const dataByTag = {}
        const xValues = new Set()
        const xValuesByTag = {}
        reportData.forEach(datum => {
            const {start, stop, tags} = datum
            const x = moment(start).format('YYYY-MM-DD')
            const y = moment.duration(moment(stop).diff(start)).asHours()
            for (const tag of tags) {
                if (!dataByTag[tag]) {
                    dataByTag[tag] = new Map()
                    xValuesByTag[tag] = new Set()
                }
                if (dataByTag[tag].has(x)) {
                    dataByTag[tag].set(x, dataByTag[tag].get(x) + y)
                }
                else {
                    dataByTag[tag].set(x, y)
                }
                xValues.add(x)
                xValuesByTag[tag].add(x)
            }
        })
        // Fill in empty values
        for (const [tag, tagData] of Object.entries(dataByTag)) {
            for (const missingX of setMinus(xValues, xValuesByTag[tag])) {
                console.log('filled', missingX, 'for', tag)
                tagData.push({x: missingX, y: 0})
            }
        }
        const datasets = Object.entries(dataByTag).map(([tag, tagData]) => {
            const color = this.settings.tracking.chartColors(tag)
            console.log('color:', color)
            return {
                data: [...tagData.entries()].map(([x, y]) => ({x, y})),
                label: tag,
                fill: false,
                backgroundColor: color,
                borderColor: color,
                borderWidth: 1,
            }
        })
        console.log(datasets)
        const canvas = document.createElement('canvas')
        canvas.classList.add('time-tracer', 'report')
        // canvas.width = '75%'
        // canvas.height = '75%'
        document.body.appendChild(canvas)

        const barChart = new Chart(canvas, {
            type: 'bar',
            data: {
                datasets,
            },
            options: {
                title: {
                    display: true,
                    text: this.settings.name,
                },
                scales: {
                    xAxes: [{
                        type: 'time',
                        time: {
                            unit: 'day',
                            unitStepSize: 1,
                            displayFormats: {
                               'day': 'MMM DD',
                           },
                        },
                        stacked: true,
                    }],
                    yAxes: [{
                        stacked: true,
                    }],
                },
            },
        })
        // console.log(barChart)
    }

    async getSeconds() {
        const command = this._getCommand('report')
        const {stdout} = await runCommand(command)
        const reportData = JSON.parse(stdout)
        return reportData.time

    }

    _getCommand(type, changedFiles=[]) {
        return replacePlaceholders(this.settings.tool[type], {
            '%p': this.settings.name,
            '%t': this.settings.tags,
            '%f': this._preprocessChangedFiles(changedFiles),
        })
    }

    _preprocessChangedFiles(changedFiles) {
        if (this.settings.preprocessChangedFiles) {
            return this.settings.preprocessChangedFiles(changedFiles)
        }
        return changedFiles.join(' ')
    }

    // throttled for i.e. scrolling
    handleActivity = async () => {
        if (!this._throttledHandleActivity) {
            this._throttledHandleActivity = throttle(
                async () => {
                    console.log('handling user activity....')
                    await this.start()
                    this.resetTimer()
                },
                5000,
                {leading: true, trailing: false}
            )
        }
        return await this._throttledHandleActivity()
    }

    handleFocusWindow = async () => {
        const prevWindowId = await getWindowId()
        const {id: currentWindowId} = this.currentWindow
        const prevWindowWasAtom = prevWindowId !== currentWindowId
        if (prevWindowWasAtom) {
            console.log('prev window was another atom window!')
            // The stop command must stop everything including other projects'
            // trackings.
            await this.stop()
            await setWindowId(currentWindowId)
            await this.handleActivity()
        }
        // else: Prev window was another App than Atom. We don't do anything.
        else {
            if (atom.inDevMode()) {
                console.log('prev window was another app!')
            }
        }
    }

    updateStatusBar(props) {
        this.statusBarTile.render(props)
    }
}

export default new TimeTracer()
