'use babel'

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
    getTagColor,
} from './utils'


const TIME_TRACER_REPORT_URI = 'time-tracer://report'
// Lazily imported in Atom opener.
let TimeTracerReportView


class TimeTracer {
    config = config
    lastEdit = 0
    timer = null
    statusBarInterval = null
    isTracking = false
    reportData = null

    _throttledHandleActivity = null

    async activate(state) {
        let didActivate
        this.activationPromise = new Promise((resolve, reject) => {
            didActivate = resolve
        })
        const {
            tracking={},
            tool={},
            ui: {preferedChartColors, ...ui},
            ...general
        } = await getTimeracerConfig()
        // TODO: subscribe to config changes (https://atom.io/docs/api/v1.28.2/Config#instance-onDidChange)
        this.settings = {
            ...general,
            tracking: {
                startOnOpen: getSetting('tracking.startOnOpen'),
                waitTillAutoStop: getSetting('tracking.waitTillAutoStop'),
                regardedEvents: getSetting('tracking.regardedEvents').split(' '),
                ...tracking,
            },
            tool: {
                start: getSetting('tool.start'),
                stop: getSetting('tool.stop'),
                report: getSetting('tool.report'),
                log: getSetting('tool.log'),
                ...tool,
            },
            ui: {
                showInStatusBar: getSetting('ui.showInStatusBar'),
                hoursPerWorkDay: getSetting('ui.hoursPerWorkDay'),
                openReportInSplitPane: getSetting('ui.openReportInSplitPane'),
                preferedChartColors: (() => {
                    let index = 0
                    const colors = preferedChartColors.split(' ')
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
                ...ui,
            },
        }

        this.currentWindow = atom.getCurrentWindow()
        this.currentWindow.on('focus', this.handleFocusWindow)

        // The file watcher is used for outside-of-Atom file changes.
        this.fileWatcher = atom.project.onDidChangeFiles(this.handleActivity)
        for (const eventType of this.settings.tracking.regardedEvents) {
            document.body.addEventListener(
                eventType,
                this.handleActivity,
            )
        }

        if (getSetting('tracking.startOnOpen')) {
            this.handleActivity()
        }

        atom.commands.add('atom-workspace', Commands.boundTo(this))
        atom.workspace.addOpener(uri => {
            if (uri === TIME_TRACER_REPORT_URI) {
                if (!TimeTracerReportView) {
                    TimeTracerReportView = require('./time-tracer-report-view')
                }
                return new TimeTracerReportView(
                    this.settings,
                    this.reportData,
                )
            }
        })
        didActivate()
    }

    deactivate() {
        this.stop()
        this.fileWatcher.dispose()
        this.statusBarTile && this.statusBarTile.destroy()
        for (const eventType of this.settings.tracking.regardedEvents) {
            document.body.removeEventListener(
                eventType,
                this.handleActivity,
            )
        }
    }

    async consumeStatusBar(statusBar) {
        await this.activationPromise
        if (this.settings.ui.showInStatusBar) {
            this.statusBarTile = new StatusBarTile(statusBar, this)
        }
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

        const now = Date.now()
        const {waitTillAutoStop} = this.settings.tracking
        const msTillAutoStop = waitTillAutoStop * 1000
        if (now - this.lastEdit > msTillAutoStop && this.lastEdit > 0) {
            this.stop()
            this.updateStatusBar({percent: 0})
        }
        else {
            this.timer = setTimeout(() => this.resetTimer(), msTillAutoStop)
            this.updateStatusBar({percent: 1})
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

    report = async() => {
        const command = this._getCommand('log')
        const {stdout} = await runCommand(command)
        // this.assertShape(reportData)
        // console.log(reportData)
        this.reportData = JSON.parse(stdout)

        const prevActivePane = atom.workspace.getActivePane()
        const options = {searchAllPanes: true}
        if (this.settings.ui.openReportInSplitPane) {
            options.split = 'right'
        }
        await atom.workspace.open(TIME_TRACER_REPORT_URI, options)
        prevActivePane.activate()
    }

    async getSeconds() {
        const command = this._getCommand('report')
        const {stdout} = await runCommand(command)
        const reportData = JSON.parse(stdout)
        return reportData.time

    }

    _getCommand(type) {
        return replacePlaceholders(this.settings.tool[type], {
            '%project': this.settings.name,
            '%tags': this.settings.tags,
            '%branches': (
                atom.project
                .getRepositories()
                .filter(repo => repo)
                .map(repo => repo.getShortHead())
                .join(' ')
            ),
            '%path': atom.project.getPaths()[0],
        })
    }

    // throttled for i.e. scrolling
    handleActivity = async event => {
        if (!this._throttledHandleActivity) {
            this._throttledHandleActivity = throttle(
                async event => {
                    console.log('handling user activity....', event && event.type)
                    await this.start()
                    this.resetTimer()
                },
                5000,
                {leading: true, trailing: false}
            )
        }
        return await this._throttledHandleActivity(event)
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
        this.statusBarTile && this.statusBarTile.render(props)
    }
}

export default new TimeTracer()
