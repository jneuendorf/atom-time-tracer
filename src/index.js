'use babel'

import throttle from 'lodash.throttle'
import moment from 'moment'

import StatusBarTile from './status-bar-tile'
import Commands from './commands'
import {config, get as getSetting} from './config'
import {
    getTimeracerConfig,
    replacePlaceholders,
    runCommand,
    tryRunCommand,
    getWindowId,
    setWindowId,
    defaultColorGenerator,
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
                preferedChartColors: defaultColorGenerator(preferedChartColors),
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
        const success = await tryRunCommand(command, {
            stderrNotificationText: stderr => {
                return `Something was printed to stderr while starting time tracking: ${stderr}`
            },
            errorNotificationTex: error => {
                return `Failed to start time tracking. Reason: ${error.message}`
            },
            shouldIgnoreError: error => {
                return error.message.toLowerCase().includes('already started')
            }
        })
        if (success) {
            this.isTracking = true
        }
    }

    async stop() {
        if (!this.isTracking) {
            return
        }

        console.log('stopping......', atom.getCurrentWindow().getTitle())
        const command = this._getCommand('stop')
        const success = await tryRunCommand(command, {
            stderrNotificationText: stderr => {
                return `Something was printed to stderr while stopping time tracking: ${stderr}`
            },
            errorNotificationTex: error => {
                return `Failed to stop time tracking. Reason: ${error.message}`
            },
            shouldIgnoreError: error => {
                return error.message.toLowerCase().includes('no project started')
            }
        })
        if (success) {
            this.isTracking = false
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
        let reportData
        try {
            reportData = JSON.parse(stdout)
        }
        catch (error) {
            atom.notifications.addError(
                'Invalid report data. Your log command must return valid JSON.'
            )
            return
        }

        const {start, stop, tags} = reportData
        if (moment(start).isValid() && moment(stop).isValid() && Array.isArray(tags)) {
            this.reportData = reportData
            const prevActivePane = atom.workspace.getActivePane()
            const options = {searchAllPanes: true}
            if (this.settings.ui.openReportInSplitPane) {
                options.split = 'right'
            }
            await atom.workspace.open(TIME_TRACER_REPORT_URI, options)
            prevActivePane.activate()
        }
        else {
            atom.notifications.addError(
                'Invalid report data. Expected shape {start, stop, tags} where start and '
                + 'stop and momentjs compatible and tags is an array of strings.'
            )
        }
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
