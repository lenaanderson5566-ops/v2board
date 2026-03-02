<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\CurrencyRate;
use App\Models\Payment;
use App\Models\CurrencySetting;
use App\Services\CurrencyRateService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

class CurrencyCenterController extends Controller
{
    public function fetch(Request $request)
    {
        $base = strtoupper(CurrencySetting::getValue('business_base_currency', 'CNY'));

        $rates = collect();
        $latestFetchedAt = null;
        if (Schema::hasTable('v2_currency_rate')) {
            $rates = CurrencyRate::where('base_currency', $base)
                ->orderBy('quote_currency', 'ASC')
                ->get(['quote_currency', 'rate_to_base', 'fetched_at']);
            $latestFetchedAt = CurrencyRate::where('base_currency', $base)->max('fetched_at');
        }

        if (Schema::hasColumn('v2_payment', 'currency')) {
            $payments = Payment::orderBy('sort', 'ASC')->get(['id', 'name', 'payment', 'currency']);
        } else {
            $payments = Payment::orderBy('sort', 'ASC')->get(['id', 'name', 'payment'])->map(function ($item) {
                $item['currency'] = 'CNY';
                return $item;
            });
        }

        return response([
            'data' => [
                'business_base_currency' => $base,
                'currency_rate_api' => CurrencySetting::getValue('currency_rate_api', 'https://open.er-api.com/v6/latest/{base}'),
                'latest_fetched_at' => $latestFetchedAt,
                'rates' => $rates,
                'payments' => $payments,
            ]
        ]);
    }

    public function sync(CurrencyRateService $service)
    {
        $ok = $service->refreshAllRates();
        if (!$ok) {
            return response([
                'data' => false,
                'message' => '拉取失败，已回退使用上一版有效汇率'
            ]);
        }

        return response([
            'data' => true
        ]);
    }


    public function saveSettings(Request $request)
    {
        $params = $request->validate([
            'business_base_currency' => 'required|string|max:8',
            'currency_rate_api' => 'nullable|string'
        ]);

        $baseCurrency = strtoupper($params['business_base_currency']);
        CurrencySetting::setValue('business_base_currency', $baseCurrency);
        CurrencySetting::setValue('currency_rate_api', $params['currency_rate_api'] ?? 'https://open.er-api.com/v6/latest/{base}');

        if (Schema::hasTable('v2_user') && Schema::hasColumn('v2_user', 'commission_currency')) {
            DB::table('v2_user')
                ->where(function ($query) {
                    $query->whereNull('commission_currency')
                        ->orWhere('commission_currency', '')
                        ->orWhereRaw('UPPER(commission_currency) = ?', ['CNY']);
                })
                ->update(['commission_currency' => $baseCurrency]);
        }

        return response(['data' => true]);
    }

    public function setPaymentCurrency(Request $request)
    {
        $params = $request->validate([
            'id' => 'required|integer',
            'currency' => 'required|string|max:8'
        ]);

        $payment = Payment::find($params['id']);
        if (!$payment) {
            abort(500, '支付方式不存在');
        }

        if (!Schema::hasColumn('v2_payment', 'currency')) {
            abort(500, '请先执行数据库迁移以启用支付币种设置');
        }

        $payment->currency = strtoupper($params['currency']);
        if (!$payment->save()) {
            abort(500, '保存失败');
        }

        return response(['data' => true]);
    }
}
