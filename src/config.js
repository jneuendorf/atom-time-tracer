'use babel'


const placeholders = {
    '%p': 'project',
    '%t': 'tags',
    '%f': 'changed files',
}
const placeholdersText = (
    Object.entries(placeholders)
    .map(([placeholder, description]) => {
        return `${placeholder} (${description})`
    })
    .join(', ')
)


export const config = {
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
                // description: '',
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
                    // 'editor:attached',
                    // 'editor:display-updated',
                    // 'editor:grammar-changed',
                    // 'editor:min-width-changed',
                    // 'editor:path-changed',
                    // 'editor:scroll-to-cursor',
                    // 'editor:will-be-removed',
                    // 'palette:toggle',
                    // 'pane:active-item-changed',
                    // 'pane:active-item-title-changed',
                    // 'pane:attached',
                    // 'pane:became-active',
                    // 'pane:became-inactive',
                    // 'pane:before-item-destroyed',
                    // 'pane:item-added',
                    // 'pane:item-moved',
                    // 'pane:item-removed',
                    // 'pane:removed',
                    // 'pane:show-previous-item',
                    // 'pane:split-down',
                    // 'pane:split-left',
                    // 'pane:split-right',
                    // 'pane:split-up',
                    // 'panel:unfocus',
                    // 'selection:changed',
                    // 'tree-view:collapse-directory',
                    // 'tree-view:copy-full-path',
                    // 'tree-view:copy-project-path',
                    // 'tree-view:directory-modified',
                    // 'tree-view:expand-directory',
                    // 'tree-view:move',
                    // 'tree-view:open-selected-entry',
                    // 'tree-view:remove',
                    // 'tree-view:reveal-active-file',
                    // 'tree-view:toggle',

                    'click',
                    'contextmenu',
                    'dblclick',
                    'dragend',
                    'keyup',
                    // 'mousemove',
                    'mousewheel',
                    'scroll',
                    'resize'
                ].join(' '),
                title: 'Events that extend the timer until auto stop',
            },
            // parallel: {
            //     // http://tailordev.github.io/Watson/user-guide/commands/#start
            //     // watson config options.stop_on_start 1
            //     order: 3,
            //     type: 'boolean',
            //     default: false,
            //     title: 'Allow tracking multiple projects at the same time',
            //     description: 'If true ',
            // },
            preferedChartColors: {
                order: 4,
                type: 'string',
                default: '',
                title: 'Prefered chart colors',
                description: 'List of space separated color strings. See http://www.chartjs.org/docs/latest/general/colors.html#colors for valid colors. If not specified or insufficient random colors will be used.',
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
                default: 'watson start %p %t',
                title: 'Command for starting tracking time',
                description: `Possible placeholders: ${placeholdersText}`,
            },
            stop: {
                order: 2,
                type: 'string',
                default: 'watson stop',
                title: 'Command for stopping tracking **all** trackings',
                description: `Possible placeholders: ${placeholdersText}`,
            },
            report: {
                order: 3,
                type: 'string',
                default: 'watson report --project %p --json',
                title: 'Command for getting tracked-time data in JSON format',
                description: `Possible placeholders: ${placeholdersText}`,
            },
            /* {
                "projects": [
                    {
                        "name": "watson",
                        "tags": [
                            {
                                "name": "export",
                                "time": 530.0
                            },
                            {
                                "name": "report",
                                "time": 530.0
                            }
                        ],
                        "time": 530.0
                    }
                ],
                "time": 530.0,
                "timespan": {
                    "from": "2016-02-21T00:00:00-08:00",
                    "to": "2016-02-28T23:59:59.999999-08:00"
                }
            } */
            log: {
                order: 4,
                type: 'string',
                default: 'watson log --project %p --json',
                title: 'Command for getting detailed tracked-time data in JSON format',
                description: `Used for creating the report chart. Possible placeholders: ${placeholdersText}`,
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
                title: 'Show tracked time in status bar',
                // description: '',
            },
        },
    },
    // __internal__: {
    //     order: 4,
    //     type: 'string',
    //     default: '',
    //     // title: '',
    //     // description: '',
    // },
}


export const get = key => atom.config.get(`time-tracer.${key}`)

// const getDefault = key => atom.config.getSchema(`time-tracer.${key}`).default
