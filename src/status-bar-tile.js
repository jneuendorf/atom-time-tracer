'use babel'

import Chart from 'chart.js/dist/Chart.min.js'


export default class StatusBarTile {
    constructor(statusBar, timeTracer) {
        this.props = {}
        this.timeTracer = timeTracer

        const wrapper = document.createElement('span')
        wrapper.innerHTML = `<div class='inline-block time-tracer'>
            <div class='inline-block stats'></div>
            <button class='btn btn-xs icon icon-graph inline-block-tight'></button>
            <div class='inline-block timer'>
                <canvas width='14' height='14'></canvas>
            </div>
        </div>`
        this.element = wrapper.children[0]

        this.tooltipDisposable = atom.tooltips.add(
            this.element,
            {title: this.getTooltip}
        )

        this.stats = this.element.querySelector('.stats')
        this.reportButton = this.element.querySelector('button.icon-graph')

        this.reportButton.addEventListener('click', timeTracer.report)

        this.pieChart = new Chart(this.element.querySelector('canvas'), {
            type: 'pie',
            data: {
                datasets: [{
                    data: this.getData(0),
                    backgroundColor: [
                        'rgb(102, 240, 67)', 'rgba(0, 0, 0, 0)',
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

        const leftTiles = statusBar.getLeftTiles()
        let maxPrio = 0
        for (const tile of leftTiles) {
            const prio = tile.getPriority()
            if (prio > maxPrio) {
                maxPrio = prio
            }
        }
        this.statusBarTile = statusBar.addLeftTile({
            item: this.element,
            priority: maxPrio + 1,
        })
    }

    render(props) {
        const {seconds, percent} = props
        if (seconds != null && seconds !== this.props.seconds) {
            const {workDays} = this.getTimeData(seconds)
            this.stats.innerHTML = `${workDays}d`
        }
        if (percent != null && percent !== this.props.percent) {
            this.pieChart.data.datasets[0].data = this.getData(percent)
            this.pieChart.update()
        }
        this.props = {...this.props, ...props}
    }

    getData(percent) {
        return [percent, 1 - percent]
    }

    getTimeData(seconds=this.props.seconds) {
        const secondsPerMinute = 60
        const secondsPerHour = 60 * secondsPerMinute
        const secondsPerWorkDay = 8 * secondsPerHour

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

    getTooltip = () => {
        const {workDays, hours, minutes} = this.getTimeData()
        return `time-tracer: ${workDays > 0 ? `${workDays}d` : ''} ${hours}h ${minutes}m`
    }

    destroy() {
        this.statusBarTile.destroy()
        this.tooltipDisposable.dispose()
        this.reportButton.removeEventListener('click', this.timeTracer.report)
    }
}
