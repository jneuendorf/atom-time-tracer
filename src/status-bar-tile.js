'use babel'

// SVG piechart taken from https://css-tricks.com/how-to-make-charts-with-svg/
const PIECHART_SIZE = 16
const PIECHART_CIRCUMFERENCE = Math.PI * PIECHART_SIZE / 2


export default class StatusBarTile {

    constructor(statusBar, timeTracer) {
        // Initial props
        this.props = {projectName: timeTracer.settings.get('name')}
        this.timeTracer = timeTracer

        const wrapper = document.createElement('span')
        wrapper.innerHTML = `<div class='inline-block time-tracer'>
            <span class="icon icon-watch"></span>
            <div class='inline-block timer'>
                <svg width='${PIECHART_SIZE}' height='${PIECHART_SIZE}' class='piechart'>
                    <circle r='${PIECHART_SIZE/4}' cx='${PIECHART_SIZE/2}' cy='${PIECHART_SIZE/2}' class='pie'/>
                </svg>
            </div>
            <div class='inline-block project-name'>${this.props.projectName}</div>
        </div>`
        this.tileElement = wrapper.children[0]
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

        this.pieChartCircle = this.tileElement.querySelector('.piechart circle')
    }

    render(props) {
        const {percent, projectName} = props
        if (percent != null && percent !== this.props.percent) {
            this.pieChartCircle.style.strokeDasharray = `${percent * PIECHART_CIRCUMFERENCE} ${PIECHART_CIRCUMFERENCE}`
        }
        if (projectName != null && projectName !== this.props.projectName) {
            this.tileElement.querySelector('.project-name').innerText = projectName
        }
        this.props = {...this.props, ...props}
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
        const secondsPerWorkDay = this.timeTracer.settings.get('ui.hoursPerWorkDay') * secondsPerHour

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
        this.tileElement.removeEventListener('mouseenter', this.updateTooltip)
    }
}
