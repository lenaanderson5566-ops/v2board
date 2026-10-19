export type ApiObservation = {
    duration: number;
    failure: "api_error" | "network_error" | null;
};
let sink: ((sample: ApiObservation) => void) | undefined;
export function setTelemetrySink(value?: (sample: ApiObservation) => void) {
    sink = value;
}
export function observeApi(sample: ApiObservation) {
    try {
        sink?.(sample);
    } catch {
        /* Optional analytics never changes requests. */
    }
}
