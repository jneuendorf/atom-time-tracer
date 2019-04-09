module.exports = {
    name: 'testname',
    tags: ['tag1', 'tag2'],
    onStart: ({project, tags, branches, path}) => {
        console.log('started w/', project, tags, branches, path)
    },
    onStop: ({project, tags, branches, path}) => {
        console.log('stopped w/', project, tags, branches, path)
    },
    ui: {
        preferedChartColors: 'rgb(203,68,55) rgb(107,203,74)',
    },
}
