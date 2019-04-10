'use babel'

import path from 'path'
import {exec} from 'child_process'
import os from 'os'

import fs from 'fs-extra'

import {PROJECT_DIR} from './cjs'


export const log = (
    atom.inDevMode()
    ? (...args) => console.log(...args)
    : () => {}
)
export const error = (
    atom.inDevMode()
    ? (...args) => console.error(...args)
    : () => {}
)

export const getDirectoryWithTimeTracerConfig = async () => {
    const directories = atom.project.getDirectories()
    const results = await Promise.all(
        directories
        .map(directory => {
            const configFile = path.join(directory.getPath(), 'timetracer.config.js')
            return (
                fs.pathExists(configFile)
                .then(exists => ({exists, directory, configFile}))
            )
        })
    )
    const positives = results.filter(({exists}) => exists)
    if (positives.length === 0) {
        return {exists: false, directory: null, configFile: null}
    }
    else if (positives.length === 1) {
        return positives[0]
    }
    else {
        throw new Error('Found multipe config files. Make sure there is only 1 `timetracer.config.js` file across all project folders in the current Atom window!')
    }
}

export const getTimeTracerConfig = async configFile => {
    const defaultConfig = {
        name: getProjectName(),
        tags: [],
    }
    if (!configFile) {
        log('using NO config file...')
        return defaultConfig
    }

    let config
    try {
        log('using', configFile)
        config = {
            ...defaultConfig,
            ...require(configFile),
        }
    }
    catch (err) {
        log('using default config because of error')
        error(err.message)
        config = defaultConfig
    }
    return config
}
const getProjectName = () => {
    return (
        atom.project.getPaths()
        .map(projectPath => path.basename(projectPath))
        .join('__')
    )
}

export const findBinaryPath = async pathOrName => {
    // relative or absolute path
    if (pathOrName.includes(path.sep)) {
        const resolvedPath = path.resolve(PROJECT_DIR, pathOrName)
        if (await fs.pathExists(resolvedPath)) {
            return resolvedPath
        }
        else {
            return null
        }
    }
    // binary name
    else {
        // Based on https://github.com/springernature/hasbin/blob/5af037b8e28c7de6c35187e0dcc44cd2dc75e9cc/lib/hasbin.js#L55-L65
        const envPath = process.env.PATH || ''
        const envExtParts = (process.env.PATHEXT || '').split(path.delimiter)
        const possiblePaths = (
            envPath.replace(/["]+/g, '').split(path.delimiter)
            .map(chunk => envExtParts.map(ext => path.join(chunk, pathOrName + ext)))
            .reduce((a, b) => a.concat(b))
        )
        for (const possiblePath of possiblePaths) {
            if (await fs.pathExists(possiblePath)) {
                return possiblePath
            }
        }
        return null
    }
}

export const osType = () => {
    const kernelType = os.type()
    switch (kernelType) {
        case 'Darwin':
            return 'mac'
        case 'Linux':
            return 'linux'
        case 'Windows_NT':
            return 'windows'
        default:
            return kernelType
    }
}

export const replacePlaceholders = (str, replacements) => {
    return str.replace(/((%project)|(%tags)|(%branches)|(%path))/g, match => {
        return replacements[match]
    })
}

// TODO: Use https://atom.io/docs/api/v1.28.2/BufferedProcess ?
export const runCommand = command => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error)
            }
            else {
                resolve({stdout, stderr})
            }
        })
    })
}

// Can't wait for the process to end.
export const runCommandDetached = (command, handleError) => {
    log(command)
    return exec(command, (error, stdout, stderr) => {
        if (error) {
            handleError && handleError(error)
        }
        else {
            log('successfully started sleep watcher', stdout)
        }
    })
}

export const tryRunCommand = async (command, options={}) => {
    const {
        stderrNotificationText=(stderr => stderr),
        stderrDismissable=false,
        errorNotificationText=(error => error.message),
        errorDismissable=false,
        shouldIgnoreError=(error => false)
    } = options
    try {
        const {stdout, stderr} = await runCommand(command)
        if (stderr) {
            log('stderr:', stderr)
            atom.notifications.addWarning(
                stderrNotificationText(stderr),
                {dismissable: stderrDismissable},
            )
            return false
        }
        else {
            log('stdout:', stdout)
            return true
        }
    }
    catch (error) {
        if (shouldIgnoreError(error)) {
            return true
        }
        atom.notifications.addError(
            errorNotificationText(error),
            {dismissable: errorDismissable},
        )
        return false
    }
}
