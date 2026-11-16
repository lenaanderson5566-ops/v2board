// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const api=vi.hoisted(()=>({request:vi.fn(),reload:vi.fn()}));
vi.mock('../shared/api',()=>({admin:(path:string)=>path,request:api.request}));
vi.mock('../shared/timezone',()=>({formatInstant:()=> '2026-10-14'}));
vi.mock('../shared/ui',async()=>({
    TableViewport:(await import('../shared/ui/TableViewport')).TableViewport,
    useData:(path:string)=>{
        const state={loading:false,error:'',reload:api.reload};
        if(path.startsWith('coupon-campaign/recipients?')) {
            const status=new URLSearchParams(path.split('?')[1]).get('status');
            const rows=status==='failed' ? [] : [{user_id:7,status:'issued',reason:'issued',updated_at:1}];
            return {...state,total:rows.length,data:rows};
        }
        return {...state,total:1,data:[{id:3,couponName:'Fixture',discountPercent:10,scope:'all',status:'queued',matched:2,pending:2,issued:0,skipped:0,failed:0,cancelled:0,createdAt:1}]};
    },
    State:({children}:{children:React.ReactNode})=>children,
    Modal:({children,title}:{children:React.ReactNode,title:string})=><div role="dialog" aria-label={title}>{children}</div>,
    Empty:({text}:{text:string})=><div>{text}</div>,
    Pager:()=>null,Reload:()=>null,
}));
import { AdminCouponCampaigns } from './AdminCouponCampaigns';
beforeEach(()=>{vi.clearAllMocks();api.request.mockResolvedValue({data:{}});});
afterEach(cleanup);
it('shows an empty result for recipient filters and restores the list and focus on clear',()=>{
    render(<AdminCouponCampaigns/>);
    fireEvent.click(screen.getByRole('button',{name:'查看明细'}));
    const detail=within(screen.getByRole('dialog',{name:'批次 #3 发放明细'}));
    const filter=detail.getByRole('combobox',{name:'结果筛选'}) as HTMLSelectElement;
    expect(detail.getByRole('cell',{name:'#7'})).toBeTruthy();
    fireEvent.change(filter,{target:{value:'failed'}});
    expect(detail.getByText('没有符合所选结果的发放记录')).toBeTruthy();
    expect(detail.queryByRole('table')).toBeNull();
    fireEvent.click(detail.getByRole('button',{name:'清除结果筛选'}));
    expect(filter.value).toBe('');
    expect(document.activeElement).toBe(filter);
    expect(detail.getByRole('cell',{name:'#7'})).toBeTruthy();
});
it('requires an application confirmation before cancelling and prevents duplicate requests',async()=>{
    render(<AdminCouponCampaigns/>);
    expect(screen.queryByRole('button',{name:'取消剩余发放'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'更多操作'}));
    fireEvent.click(screen.getByRole('button',{name:'取消剩余发放'}));
    expect(screen.getByRole('dialog',{name:'取消剩余发放'})).toBeTruthy();expect(api.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认取消'));fireEvent.click(screen.getByText('确认取消'));
    await screen.findByText('已取消剩余发放。');expect(api.request).toHaveBeenCalledOnce();
    expect(api.request).toHaveBeenCalledWith('coupon-campaign/cancel',{id:3});expect(api.reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps the confirmation open on failure so the administrator can retry safely',async()=>{
    api.request.mockRejectedValue(new Error('Permission denied'));render(<AdminCouponCampaigns/>);
    fireEvent.click(screen.getByRole('button',{name:'更多操作'}));
    fireEvent.click(screen.getByRole('button',{name:'取消剩余发放'}));fireEvent.click(screen.getByText('确认取消'));
    await waitFor(()=>expect(screen.getAllByRole('alert').some(item=>item.textContent?.includes('Permission denied'))).toBe(true));
    expect(screen.getByRole('dialog')).toBeTruthy();expect(api.reload).not.toHaveBeenCalled();
});
