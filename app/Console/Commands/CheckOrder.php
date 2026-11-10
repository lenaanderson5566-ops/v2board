<?php

namespace App\Console\Commands;

use App\Jobs\OrderHandleJob;
use Illuminate\Console\Command;
use App\Models\Order;

class CheckOrder extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'check:order';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = '订单检查任务';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle()
    {
        $cutoff = time() - OrderHandleJob::PENDING_EXPIRY_SECONDS;
        Order::query()->select(['id', 'trade_no'])
            ->where(fn ($query) => $query->where('status', 1)
                ->orWhere(fn ($unpaid) => $unpaid->where('status', 0)->where('created_at', '<=', $cutoff)))
            ->chunkById(200, static function ($orders) {
                foreach ($orders as $order) OrderHandleJob::dispatch($order->trade_no);
            });
    }
}
