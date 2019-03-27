'use babel'


const placeholders = {
    '%project': 'project',
    '%tags': 'tags',
    '%branches': 'branches',
    '%path': 'project path',
}
const placeholdersText = (
    Object.entries(placeholders)
    .map(([placeholder, description]) => {
        return `\`${placeholder}\` (${description})`
    })
    .join(', ')
)


export const schema = {
    tracking: {
        order: 1,
        type: 'object',
        title: 'Time tracking',
        properties: {
            startOnOpen: {
                order: 1,
                type: 'boolean',
                default: true,
                title: 'Start when project is opened',
            },
            waitTillAutoStop: {
                order: 2,
                type: 'integer',
                default: 600,
                title: 'How long to wait after last activity (seconds)',
            },
            regardedEvents: {
                order: 3,
                type: 'string',
                // Mostly taken from https://gist.github.com/ardcore/9262498
                default: [
                    'core:copy',
                    'core:cut',
                    'core:move-down',
                    'core:move-to-bottom',
                    'core:move-to-top',
                    'core:move-up',
                    'core:paste',
                    'core:save',

                    'click',
                    'contextmenu',
                    'dblclick',
                    'dragend',
                    'keyup',
                    'mousewheel',
                    'scroll',
                    'resize'
                ].join(' '),
                title: 'Events that extend the timer until auto stop',
            },
        },
    },
    tool: {
        order: 2,
        type: 'object',
        title: 'Command line tool',
        properties: {
            start: {
                order: 1,
                type: 'string',
                default: 'watson start %project %tags',
                title: 'start',
                description: `Command for starting tracking time. Possible placeholders: ${placeholdersText}`,
            },
            stop: {
                order: 2,
                type: 'string',
                default: 'watson stop',
                title: 'stop',
                description: `Command for stopping tracking ALL trackings. Possible placeholders: ${placeholdersText}`,
            },
            report: {
                order: 3,
                type: 'string',
                default: 'watson report --project %project --json',
                title: 'report',
                description: `Command for getting tracked-time data in JSON format. Possible placeholders: ${placeholdersText}`,
            },
            log: {
                order: 4,
                type: 'string',
                default: 'watson log --project %project --json',
                title: 'log',
                description: `Command for getting detailed tracked-time data in JSON format. Used for creating the report chart. Possible placeholders: ${placeholdersText}`,
            },
            sleepWatcher: {
                order: 5,
                type: 'string',
                default: `./bin/sleepwatcher-%os`,
                title: 'sleep watcher',
                description: 'Command for executing its first argument when the machine goes to sleep. The `stop` command from above will be executed. The binary\'s path must be relative to package\'s project directory (shipped with package), available on `$PATH` or absolute. `%os` is `mac`, `linux`, `windows` or else `os.type()`.',
            },
        },
    },
    ui: {
        order: 3,
        type: 'object',
        title: 'UI',
        properties: {
            showInStatusBar: {
                order: 1,
                type: 'boolean',
                default: true,
                title: 'Display a status bar tile',
                description: 'The tile shows the activity indicator, the tracked time and the project name',
            },
            hoursPerWorkDay: {
                order: 2,
                type: 'integer',
                default: 8,
                minimum: 1,
                maximum: 24,
                title: 'Hours per work day',
                description: 'This affects the calculation of the status bar\'s tile\'s tooltip',
            },
            ignoredCommandErrorsRegex: {
                order: 3,
                type: 'string',
                default: 'already started|no project started',
                title: 'Regex for ignoring command errors',
                description: 'If an error occurs while running a command it will not be displayed if its message is matched by the specified regular expression.',
            },
            openReportInSplitPane: {
                order: 4,
                type: 'boolean',
                default: true,
                title: 'Open report chart in a split pane',
            },
            preferedChartColors: {
                order: 5,
                type: 'string',
                default: '',
                title: 'Prefered chart colors',
                description: 'List of space separated color strings (thus no spaces allowed between color values). See http://www.chartjs.org/docs/latest/general/colors.html#colors for valid colors. If not specified or insufficient random colors will be used.',
            },
        },
    },
}


export const get = key => atom.config.get(`time-tracer.${key}`)
