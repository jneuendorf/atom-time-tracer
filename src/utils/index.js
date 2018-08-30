'use babel'

const {
    PROJECT_DIR,
    WINDOW_ID_FILE,
    getWindowId,
    setWindowId,
} = require('./cjs')
// Export variables with explicit names so the linter knows utils includes
// all these.
export {
    PROJECT_DIR,
    WINDOW_ID_FILE,
    getWindowId,
    setWindowId,
}

export * from './es6'
