'use babel'

import path from 'path'
import {powerSaveBlocker} from 'remote'

import throttle from 'lodash.throttle'

import StatusBarTile from './status-bar-tile'
import Commands from './commands'
import {config, get as getSetting} from './config'
import {
    getDirectoryWithTimeTracerConfig,
    getTimeTracerConfig,
    replacePlaceholders,
    runCommand,
    runCommandDetached,
    tryRunCommand,
    getWindowId,
    setWindowId,
    defaultColorGenerator,
    reportDataIsValid,
    log,
    findBinaryPath,
    osType,
    PROJECT_DIR,
} from './utils'


const TIME_TRACER_REPORT_URI = 'time-tracer://report'
// Lazily imported in Atom opener.
let TimeTracerReportView


class TimeTracer {
    config = config
    lastEditTimestamp = 0
    timer = null
    statusBarInterval = null
    isTracking = false
    reportData = null
    sleepWatcherProcess = null
    meetingOverlay = null
    meetingInterval = null
    powerSaveBlockerId = null

    _throttledHandleActivity = null

    async activate(state) {
        let didLoadConfig
        this.loadConfigPromise = new Promise((resolve, reject) => {
            didLoadConfig = resolve
        })

        const directory = await getDirectoryWithTimeTracerConfig()
        const {
            tracking={},
            tool={},
            ui: {preferedChartColors, ...ui}={},
            ...general
        } = await getTimeTracerConfig(directory)
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
                sleepWatcher: await findBinaryPath(
                    getSetting('tool.sleepWatcher').replace('%os', osType())
                ),
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
        didLoadConfig()

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
            // Don't wait.
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

        // Check if machine sleep can be handled.
        const {tool: {sleepWatcher, stop}} = this.settings
        if (!sleepWatcher) {
            const sleepWatcherSetting = (
                getSetting('tool.sleepWatcher')
                .replace('%os', osType())
            )
            atom.notifications.addWarning(
                `Couldn't find the \`sleep watcher\` binary at \`${sleepWatcherSetting}\`. Check the settings!`,
                {dismissable: true},
            )
        }
        else {
            const setWindowIdScript = path.join(
                PROJECT_DIR,
                'scripts',
                'set-window-id.js',
            )
            this.sleepWatcherProcess = runCommandDetached(
                `${sleepWatcher} 'node ${setWindowIdScript} -1; ${stop}'`,
                error => atom.notifications.addError(
                    `Could not start sleep watcher process. Reason: ${error.message}`,
                    {dismissable: true},
                )
            )
        }

        const meetingOverlay = document.createElement('div')
        meetingOverlay.classList.add('time-tracer-meeting')
        meetingOverlay.innerHTML = `<div class='note'>
            <h1>
                I'll keep tracking your time<br />
                with a <code>meeting</code> tag.
            </h1>
            <h3>Grab a &#x2615; and enjoy your meeting. &#x1F642;</h3>
            <br />
            <button class='btn done'>Done Meeting</button>
            <br />
            <br />
            <br />
            <div class='text-smaller'>
                Other project than <code>${this.settings.name}</code>?
            </div>
            <input class='input-text project-name' type='text' />
        </div>`
        const listener = event => {
            this.meetingInterval = clearInterval(this.meetingInterval)
            if (event.key === 'Enter') {
                const input = event.target.value
                this.startMeeting(input)
            }
        }
        const input = meetingOverlay.querySelector('.project-name')
        input.addEventListener('keyup', listener)
        meetingOverlay.querySelector('.btn.done').addEventListener(
            'click',
            this.stopMeeting,
        )
        atom.views.getView(atom.workspace).appendChild(meetingOverlay)
        this.meetingOverlay = meetingOverlay
    }

    deactivate() {
        this.stop()
        this.sleepWatcherProcess && this.sleepWatcherProcess.kill()
        this.fileWatcher.dispose()
        this.statusBarTile && this.statusBarTile.destroy()
        this.meetingOverlay.remove()
        for (const eventType of this.settings.tracking.regardedEvents) {
            document.body.removeEventListener(
                eventType,
                this.handleActivity,
            )
        }
    }

    async consumeStatusBar(statusBar) {
        await this.loadConfigPromise
        if (this.settings.ui.showInStatusBar) {
            this.statusBarTile = new StatusBarTile(statusBar, this)
        }
    }

    async start() {
        if (this.isTracking || atom.project.getPaths().length === 0) {
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
                const regex = new RegExp(getSetting('ui.ignoredCommandErrorsRegex'), 'i')
                return regex.test(error.message)
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

        const command = this._getCommand('stop')
        const success = await tryRunCommand(command, {
            stderrNotificationText: stderr => {
                return `Something was printed to stderr while stopping time tracking: ${stderr}`
            },
            errorNotificationTex: error => {
                return `Failed to stop time tracking. Reason: ${error.message}`
            },
            shouldIgnoreError: error => {
                const regex = new RegExp(getSetting('ui.ignoredCommandErrorsRegex'), 'i')
                return regex.test(error.message)
            }
        })
        if (success) {
            this.isTracking = false
        }
    }

    report = async() => {
        const command = this._getCommand('log')
        const {stdout} = await runCommand(command)
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

        if (reportDataIsValid(reportData)) {
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

    showMeetingOverlay() {
        let remainingSeconds = 10
        const placeholder = 'Enter it here'
        const button = this.meetingOverlay.querySelector('.btn.done')
        const input = this.meetingOverlay.querySelector('.project-name')

        // Initialize state
        button.disabled = true
        input.placeholder = `${placeholder} (${remainingSeconds})`
        input.value = ''
        input.disabled = false

        this.meetingInterval = setInterval(
            () => {
                if (remainingSeconds > 0) {
                    input.placeholder = `${placeholder} (${remainingSeconds})`
                    remainingSeconds--
                }
                else {
                    this.meetingInterval = clearInterval(this.meetingInterval)
                    this.startMeeting(this.settings.name)
                }
            },
            1000
        )
        this.meetingOverlay.classList.add('visible')
        atom.views.getView(atom.workspace).classList.add('has-meeting-overlay')
    }

    async hideMeetingOverlay() {
        this.meetingInterval = clearInterval(this.meetingInterval)
        await this.stop()
        this.meetingOverlay.classList.remove('visible')
        atom.views.getView(atom.workspace).classList.remove('has-meeting-overlay')
    }

    async startMeeting(projectName) {
        // Handle UI state of the 'this.meetingOverlay'.
        const button = this.meetingOverlay.querySelector('.btn.done')
        const input = this.meetingOverlay.querySelector('.project-name')
        button.disabled = false
        input.disabled = true
        input.placeholder = projectName

        // Create backup of changed settings to restore them later.
        this.settings.tracking._waitTillAutoStop = this.settings.tracking.waitTillAutoStop
        this.settings._name = this.settings.name
        this.settings._tags = this.settings.tags
        // Set custom project name.
        this.settings.name = projectName
        this.settings.tracking.waitTillAutoStop = Infinity
        this.settings.tags = [...this.settings.tags, 'meeting']
        await this.stop()
        await this.start()
        this.updateStatusBar({projectName})
        atom.notifications.addInfo(
            `I am now tracking your meeting for '${projectName}'. `
            + `Hit the button when you're done and have a nice meeting! ;)`
        )
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    }

    stopMeeting = async event => {
        // Restore original settings.
        this.settings.tracking.waitTillAutoStop = this.settings.tracking._waitTillAutoStop
        this.settings.name = this.settings._name
        this.settings.tags = this.settings._tags

        await this.hideMeetingOverlay()
        this.updateStatusBar({projectName: this.settings.name})
        await this.start()
        powerSaveBlocker.stop(this.powerSaveBlockerId)
    }

    async resetTimer() {
        clearTimeout(this.timer)
        clearInterval(this.statusBarInterval)

        const now = Date.now()
        const {waitTillAutoStop} = this.settings.tracking
        const msTillAutoStop = waitTillAutoStop * 1000
        const idle = (
            now - this.lastEditTimestamp >= msTillAutoStop
            && this.lastEditTimestamp > 0
        )
        if (idle) {
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
        this.lastEditTimestamp = now
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
            '%tags': this.settings.tags.map(tag => `+${tag}`).join(' '),
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
                    log('handling user activity....', event && event.type)
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
            if (prevWindowId >= 0) {
                log('prev window was another Atom window!')
                // The stop command must stop everything including other projects'
                // trackings.
                await this.stop()
                await setWindowId(currentWindowId)
                await this.handleActivity()
            }
            else {
                log('woke up from sleep')
                clearInterval(this.statusBarInterval)
                if (this._throttledHandleActivity) {
                    this._throttledHandleActivity.cancel()
                }
                this.updateStatusBar({percent: 0})
                // prevWindowId === -1 => restore the actual window ID.
                await setWindowId(currentWindowId)
            }
        }
        // else: Prev window was another App than Atom. We don't do anything.
        else {
            log('prev window was another app or another Atom window without \'time-tracer\' loaded!')
        }
    }

    updateStatusBar(props) {
        this.statusBarTile && this.statusBarTile.render(props)
    }
}

export default new TimeTracer()
