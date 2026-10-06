import type { Envelope } from './api';

// Charts need the complete selected window, including every page of raw records.
export async function completePages<T>(first: Envelope<T[]>, load: (page: number) => Promise<Envelope<T[]>>, active = () => true): Promise<Envelope<T[]>> {
    const pagination = first.meta?.pagination;
    if (!pagination || pagination.page !== 1) return first;
    const rows = [...first.data];
    for (let page = 2; page <= pagination.totalPages && active(); page++) {
        const next = await load(page);
        rows.push(...next.data);
    }
    return {...first, data: rows};
}
