'use babel'

import Chart from 'chart.js/dist/Chart.min.js'

import {log} from './utils'


export default class StatusBarTile {
    constructor(statusBar, timeTracer) {
        this.props = {}
        this.timeTracer = timeTracer

        const wrapper = document.createElement('span')
        wrapper.innerHTML = `<div class='inline-block time-tracer'>
            <span class="icon icon-watch"></span>
            <div class='inline-block timer'>
                <canvas width='14' height='14'></canvas>
            </div>
            ${''/* Used for figuring out the current theme's colors. */}
            <div class='hidden color-info'></div>
        </div>`
        this.tileElement = wrapper.children[0]
        this.tileElement.addEventListener('click', timeTracer.report)
        this.tileElement.addEventListener('mouseenter', this.updateTooltip)

        // Add tile to the DOM.
        const leftTiles = statusBar.getLeftTiles()
        let maxPrio = 0
        for (const tile of leftTiles) {
            const prio = tile.getPriority()
            if (prio > maxPrio) {
                maxPrio = prio
            }
        }
        this.statusBarTile = statusBar.addLeftTile({
            item: this.tileElement,
            priority: maxPrio + 1,
        })

        this.tooltipElement = document.createElement('span')
        this.tooltipDisposable = atom.tooltips.add(
            this.tileElement,
            {item: this.tooltipElement},
        )

        // The computed style can be retrieved only after the element was added
        // to the DOM.
        const successColor = (
            window.getComputedStyle(this.tileElement.querySelector('.color-info'))
            .getPropertyValue('color')
        )
        this.pieChart = new Chart(this.tileElement.querySelector('canvas'), {
            type: 'pie',
            data: {
                datasets: [{
                    data: this.getData(0),
                    backgroundColor: [
                        successColor, 'rgba(0, 0, 0, 0)',
                    ],
                    borderWidth: [0, 0],
                    hoverBorderWidth: [0, 0],
                }],
            },
            options: {
                legend: {
                    display: false,
                },
                tooltips: {
                    enabled: false,
                },
                animation: {
                    duration: 0,
                },
            },
        })
    }

    render(props) {
        const {percent} = props
        if (percent != null && percent !== this.props.percent) {
            log('rendering percent', percent, this.props.percent)
            this.pieChart.data.datasets[0].data = this.getData(percent)
            this.pieChart.update()
        }
        this.props = {...this.props, ...props}
    }

    getData(percent) {
        return [percent, 1 - percent]
    }

    updateTooltip = async () => {
        this.tooltipElement.innerHTML = `<span class='loading loading-spinner-tiny'></span>`
        const {workDays, hours, minutes} = await this.getTimeData()
        const text = `${workDays > 0 ? `${workDays}d` : ''} ${hours}h ${minutes}m`
        this.tooltipElement.innerText = text
    }

    async getTimeData() {
        let seconds = await this.timeTracer.getSeconds()
        const secondsPerMinute = 60
        const secondsPerHour = 60 * secondsPerMinute
        const secondsPerWorkDay = this.timeTracer.settings.ui.hoursPerWorkDay * secondsPerHour

        const workDays = Math.floor(seconds / secondsPerWorkDay)
        seconds -= workDays * secondsPerWorkDay
        const hours = Math.floor(seconds / secondsPerHour)
        seconds -= hours * secondsPerHour
        const minutes = Math.floor(seconds / secondsPerMinute)
        return {
            workDays,
            hours,
            minutes,
        }
    }

    destroy() {
        this.statusBarTile.destroy()
        this.tooltipDisposable.dispose()
        this.tileElement.removeEventListener('click', this.timeTracer.report)
        this.tileElement.removeEventListener('mouseenter', this.updateTooltip)
    }
}
