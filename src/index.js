'use babel'

import path from 'path'
import {powerSaveBlocker} from 'remote'

import throttle from 'lodash.throttle'

import StatusBarTile from './status-bar-tile'
import Commands from './commands'
import * as Config from './config'
import * as Settings from './settings'
import {
    replacePlaceholders,
    runCommand,
    runCommandDetached,
    tryRunCommand,
    getWindowId,
    setWindowId,
    log,
    PROJECT_DIR,
} from './utils'


class TimeTracer {
    config = Config.schema

    activationPromise = null
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

    activate(state) {
        this.activationPromise = (
            new Promise((resolve, reject) => {
                Settings.getInstance(this.onDidChangeSettings)
                .then(settings => {
                    this.settings = settings
                    resolve()
                })
                .catch(error => {
                    reject(error)
                })
            })
            .then(() => {
                this.currentWindow = atom.getCurrentWindow()
                this.currentWindow.on('focus', this.handleFocusWindow)

                // The file watcher is used for outside-of-Atom file changes.
                this.fileWatcher = atom.project.onDidChangeFiles(this.handleActivity)
                const regardedEvents = this.settings.get('tracking.regardedEvents')
                for (const eventType of regardedEvents) {
                    document.body.addEventListener(
                        eventType,
                        this.handleActivity,
                    )
                }

                if (this.settings.get('tracking.startOnOpen')) {
                    // Don't wait.
                    this.handleActivity()
                }

                atom.commands.add('atom-workspace', Commands.boundTo(this))

                // Check if machine sleep can be handled.
                const {sleepWatcher, stop} = this.settings.get('tool')
                if (!sleepWatcher) {
                    atom.notifications.addWarning(
                        `Couldn't find the \`sleep watcher\` binary at \`${sleepWatcher}\`. Check the settings!`,
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
                        Other project than <code>${this.settings.get('name')}</code>?
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
            })
        )
    }

    deactivate() {
        this.stop()
        this.sleepWatcherProcess && this.sleepWatcherProcess.kill()
        this.fileWatcher.dispose()
        this.statusBarTile && this.statusBarTile.destroy()
        this.settings.dispose()
        this.meetingOverlay.remove()
        const regardedEvents = this.settings.get('tracking.regardedEvents')
        for (const eventType of regardedEvents) {
            document.body.removeEventListener(
                eventType,
                this.handleActivity,
            )
        }
    }

    async consumeStatusBar(statusBar) {
        await this.activationPromise
        if (this.settings.get('ui.showInStatusBar')) {
            this.statusBarTile = new StatusBarTile(statusBar, this)
        }
    }

    onDidChangeSettings = async () => {
        await this.stop()
        await this.start()
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
                const regex = new RegExp(this.settings.get('ui.ignoredCommandErrorsRegex'), 'i')
                return regex.test(error.message)
            }
        })
        if (success) {
            const onStart = this.settings.get('onStart')
            if (onStart) {
                try {
                    onStart(this._getPlaceholderData())
                }
                catch (error) {
                    atom.notifications.addWarning(
                        `The following error occured in the 'onStart' callback: `
                        + ` ${error.message}`
                    )
                }
            }
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
                const regex = new RegExp(this.settings.get('ui.ignoredCommandErrorsRegex'), 'i')
                return regex.test(error.message)
            }
        })
        if (success) {
            const onStop = this.settings.get('onStop')
            if (onStop) {
                try {
                    onStop(this._getPlaceholderData())
                }
                catch (error) {
                    atom.notifications.addWarning(
                        `The following error occured in the 'onStop' callback: `
                        + ` ${error.message}`
                    )
                }
            }
            this.isTracking = false
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
                    this.startMeeting(this.settings.get('name'))
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
        this.settings.backup()
        // Set custom project name.
        this.settings.setMultiple({
            name: projectName,
            'tracking.waitTillAutoStop': Infinity,
            'tags': [...this.settings.get('tags'), 'meeting'],
        })

        this.updateStatusBar({projectName})
        atom.notifications.addInfo(
            `I am now tracking your meeting for '${projectName}'. `
            + `Hit the button when you're done and have a nice meeting! ;)`
        )
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    }

    stopMeeting = async event => {
        this.settings.restore()

        await this.hideMeetingOverlay()
        this.updateStatusBar({projectName: this.settings.get('name')})
        await this.start()
        powerSaveBlocker.stop(this.powerSaveBlockerId)
    }

    async resetTimer() {
        clearTimeout(this.timer)
        clearInterval(this.statusBarInterval)

        const now = Date.now()
        const waitTillAutoStop = this.settings.get('tracking.waitTillAutoStop')
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
        const command = this.settings.get(`tool.${type}`)
        const {project, tags, branches, path} = this._getPlaceholderData()
        return replacePlaceholders(command, {
            '%project': project,
            '%tags': tags.map(tag => `+${tag}`).join(' '),
            '%branches': branches.join(' '),
            '%path': path,
        })
    }

    _getPlaceholderData() {
        return {
            project: this.settings.get('name'),
            tags: this.settings.get('tags'),
            branches: (
                atom.project
                .getRepositories()
                .filter(repo => repo)
                .map(repo => repo.getShortHead())
            ),
            path: atom.project.getPaths()[0],
        }
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
