'use babel'

import Chart from 'chart.js/dist/Chart.min.js'
import moment from 'moment'


export default class StatusBarTile {
    constructor(statusBar) {
        this.props = {}

        const wrapper = document.createElement('span')
        wrapper.innerHTML = `<div class='inline-block time-tracer'>
            <a class="icon icon-clock"></a>
            <div class='inline-block stats'></div>
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
            const humanizedTime =   moment.duration(seconds, 'seconds').humanize()
            this.stats.innerHTML = humanizedTime
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

    getTooltip = () => {
        return `time-tracer: ${moment.duration(this.props.seconds, 'seconds').humanize()}`
    }

    destroy() {
        this.statusBarTile.destroy()
        this.tooltipDisposable.dispose()
    }
}
