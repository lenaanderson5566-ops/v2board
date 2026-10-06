import { expect, it, vi } from 'vitest';
import { completePages } from './paginated-data';

it('collects all pages before rendering a complete usage window', async () => {
    const load = vi.fn(async (page: number) => ({data:[page]}));
    const result = await completePages({data:[1],meta:{pagination:{page:1,pageSize:1,total:3,totalPages:3}}},load);
    expect(result.data).toEqual([1,2,3]);
    expect(load.mock.calls).toEqual([[2],[3]]);
});
it('leaves legacy responses intact and stops loading after unmount', async () => {
    const load = vi.fn();
    expect(await completePages({data:[1]},load)).toEqual({data:[1]});
    await completePages({data:[1],meta:{pagination:{page:1,totalPages:3}}},load,()=>false);
    expect(load).not.toHaveBeenCalled();
});
