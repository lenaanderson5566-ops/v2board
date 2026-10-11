<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use App\Models\StatUser;
use App\Models\StatServer;
class ResetLog extends Command {
    protected $signature='reset:log';
    protected $description='Apply existing statistics retention and configured log cleanup';
    public function handle() {
        // Existing statistics policy is independent from configurable raw-log retention.
        StatUser::where('record_at','<',strtotime('-2 month'))->delete();
        StatServer::where('record_at','<',strtotime('-2 month'))->delete();
        return $this->call('logs:prune');
    }
}
