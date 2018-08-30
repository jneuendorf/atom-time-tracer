const {setWindowId} = require('../src/utils/cjs')


const [_bin, _script, arg] = process.argv
const windowId = parseInt(arg, 10)
const main = async () => {
    await setWindowId(windowId)
}


main()
