const path = require('path')
const os = require('os')

const fs = require('fs-extra')


const PROJECT_DIR = path.dirname(path.dirname(__dirname))

const WINDOW_ID_FILE = path.join(
    os.tmpdir(),
    'time-tracer',
    'focused_window_id.txt',
)
if (atom.inDevMode()) {
    console.log('using', WINDOW_ID_FILE)
}


module.exports = {
    PROJECT_DIR,
    WINDOW_ID_FILE,
    getWindowId: async () => {
        if (await fs.pathExists(WINDOW_ID_FILE)) {
            const content = await fs.readFile(WINDOW_ID_FILE, 'utf8')
            return parseInt(content.trim(), 10)
        }
        else {
            return null
        }
    },
    setWindowId: async id => {
        await fs.ensureDir(path.dirname(WINDOW_ID_FILE))
        await fs.writeFile(WINDOW_ID_FILE, `${id}`)
    }
}
