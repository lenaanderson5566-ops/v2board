// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const api=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn()}));
vi.mock('../shared/api',()=>({admin:(path:string)=>path,request:api.request}));
vi.mock('../shared/timezone',()=>({formatInstant:()=> '2026-10-14'}));
vi.mock('../shared/ui',async()=>({
    TableViewport:(await import('../shared/ui/TableViewport')).TableViewport,
    useData:()=>({loading:false,error:'',total:1,reload:api.reload,data:[{id:3,couponName:'Fixture',discountPercent:10,scope:'all',status:'queued',matched:2,pending:2,issued:0,skipped:0,failed:0,cancelled:0,createdAt:1}]}),
    State:({children}:{children:React.ReactNode})=>children,
    Modal:({children,title}:{children:React.ReactNode,title:string})=><div role="dialog" aria-label={title}>{children}</div>,
    Pager:()=>null,Reload:()=>null,
}));
import { AdminCouponCampaigns } from './AdminCouponCampaigns';
beforeEach(()=>{vi.clearAllMocks();api.request.mockResolvedValue({data:{}});});
afterEach(cleanup);
it('requires an application confirmation before cancelling and prevents duplicate requests',async()=>{
    render(<AdminCouponCampaigns/>);fireEvent.click(screen.getByText('取消剩余发放'));
    expect(screen.getByRole('dialog',{name:'取消剩余发放'})).toBeTruthy();expect(api.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认取消'));fireEvent.click(screen.getByText('确认取消'));
    await screen.findByText('已取消剩余发放。');expect(api.request).toHaveBeenCalledOnce();
    expect(api.request).toHaveBeenCalledWith('coupon-campaign/cancel',{id:3});expect(api.reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps the confirmation open on failure so the administrator can retry safely',async()=>{
    api.request.mockRejectedValue(new Error('Permission denied'));render(<AdminCouponCampaigns/>);
    fireEvent.click(screen.getByText('取消剩余发放'));fireEvent.click(screen.getByText('确认取消'));
    await waitFor(()=>expect(screen.getAllByRole('alert').some(item=>item.textContent?.includes('Permission denied'))).toBe(true));
    expect(screen.getByRole('dialog')).toBeTruthy();expect(api.reload).not.toHaveBeenCalled();
});
