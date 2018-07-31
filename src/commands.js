'use babel'


export default class Commands {
    static boundTo(timeTracer) {
        return {
            'time-tracer:start': () => timeTracer.start(),
            'time-tracer:stop': () => timeTracer.stop(),
            'time-tracer:report': () => timeTracer.report(),
        }
    }
}
