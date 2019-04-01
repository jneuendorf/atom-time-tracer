'use babel'

import {CompositeDisposable} from 'atom'
import deepmerge from 'deepmerge'
import mapObject from 'map-obj'

import * as Config from './config'
import {
    getDirectoryWithTimeTracerConfig,
    getTimeTracerConfig,
    findBinaryPath,
    osType,
} from './utils'


/**
 * Represents the current config state caused by the config
 * (from the settings panel).
*/
class Settings {
    settings = null
    backup = null
    keyPaths = []
    disposables = new CompositeDisposable()
    didChangeCallbacks = []
    directory = null

    observeConfigChanges() {
        this.keyPaths.forEach(keyPath => {
            this.disposables.add(atom.config.onDidChange(
                keyPath,
                ({newValue, oldValue}) => {
                    this.handleDidChange(keyPath, newValue, oldValue)
                }
            ))
        })
    }

    async observeGitBranchChanges(directory) {
        const git = await atom.project.repositoryForDirectory(directory)
        let _prevBranch
        this.disposables.add(git.onDidChangeStatuses(() => {
            const branch = git.getShortHead()
            if (branch !== _prevBranch) {
                // TODO
                console.log('branch has changed from', _prevBranch, 'to', branch)
                // just restart - branches placeholder is generated again
                // if (this.settings.tracking.branchesAsTags) {
                //     this.updateSettings({tags: })
                // }
            }
            _prevBranch = branch
        }))

    }

    onDidChange(...callbacks) {
        this.didChangeCallbacks.push(...callbacks)
    }

    handleDidChange = (keyPath, newValue, oldValue) => {
        for (const callback of this.didChangeCallbacks) {
            callback(keyPath, newValue, oldValue)
        }
    }

    dispose() {
        this.disposables.dispose()
    }

    loadFromConfig() {
        let topLevelKey
        return mapObject(
            Config.schema,
            (key, value) => {
                // Top level
                if ('properties' in value) {
                    // NOTE: This works because 'map-obj' uses
                    //       depth-first preorder traversal.
                    topLevelKey = key
                    return [key, value.properties]
                }
                // 2nd level
                else {
                    const keyPath = `${topLevelKey}.${key}`
                    this.keyPaths.push(keyPath)
                    return [key, Config.get(keyPath)]
                }
            },
            {deep: true},
        )
    }

    // Postprocess raw values from config.
    async loadGeneralSettings() {
        const settingsFromConfig = this.loadFromConfig()
        const sleepWatcher = await findBinaryPath(
            settingsFromConfig.tool.sleepWatcher.replace('%os', osType())
        )
        return deepmerge(settingsFromConfig, {
            tool: {sleepWatcher},
        })
    }

    async load() {
        const generalSettings = await this.loadGeneralSettings()
        const {configFile, directory} = await getDirectoryWithTimeTracerConfig()
        const projectSettings = await getTimeTracerConfig(configFile)
        this.settings = deepmerge(generalSettings, projectSettings)

        this.disposables.dispose()
        this.observeConfigChanges()
        if (directory) {
            this.observeGitBranchChanges(directory)
        }
    }

    get(keyPath) {
        let result = this.settings
        for (const key of keyPath.split('.')) {
            result = result[key]
        }
        return result
    }

    _set(keyPath, value) {
        const [key, ...path] = keyPath.split('.').reverse()
        let target = this.settings
        for (const k of path) {
            target = target[k]
        }
        target[key] = value
    }

    set(keyPath, value) {
        this._set(keyPath, value)
        this.handleDidChange()
    }

    setMultiple(object) {
        for (const [keyPath, value] of Object.entries(object)) {
            this._set(keyPath, value)
        }
        this.handleDidChange()
    }

    backup() {
        this.backup = deepmerge({}, this.settings)
    }

    restore() {
        if (this.backup) {
            this.settings = deepmerge({}, this.backup)
            this.handleDidChange()
        }
        else {
            throw new Error('Cannot restore because no settings backup exists.')
        }
    }
}


export const getInstance = async onDidChange => {
    const settings = new Settings()
    await settings.load()
    settings.onDidChange(onDidChange)
    return settings
}
