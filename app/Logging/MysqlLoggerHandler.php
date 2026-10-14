<?php
namespace App\Logging;

use Illuminate\Support\Facades\Log;
use Monolog\Handler\AbstractProcessingHandler;
use Monolog\Logger;
use Monolog\LogRecord;
use App\Models\Log as LogModel;

class MysqlLoggerHandler extends AbstractProcessingHandler
{
    public function __construct($level = Logger::DEBUG, bool $bubble = true)
    {
        parent::__construct($level, $bubble);
    }

    protected function write(LogRecord $record): void
    {
        try{
            // Never collect request bodies, query values, exception objects or arbitrary context.
            $context = array_intersect_key($record->context ?? [], array_flip(['requestId','route','method','status','durationMs']));
            $context = array_filter($context, 'is_scalar');
            if (isset($record->context['exceptionClass'])) {
                $context['errorCode'] = match ($record->context['exceptionClass']) {
                    \App\Exceptions\TelegramApiException::class => 'TELEGRAM_UNAVAILABLE',
                    \Illuminate\Database\QueryException::class => 'DATABASE_ERROR',
                    \ErrorException::class => 'INVALID_RESPONSE',
                    default => 'APPLICATION_ERROR',
                };
            }
            $route = request()->route();
            $safeTitles = ['API request','Admin operation','Client configuration request','V10 request failed','V10 exception'];
            $log = [
                'title' => in_array($record->message, $safeTitles, true) ? $record->message : (isset($record->context['exception']) ? 'Application exception' : 'Application event'),
                'level' => $record->level->getName(),
                'host' => $record->extra['request_host'] ?? request()->getSchemeAndHttpHost(),
                'uri' => $route ? '/'.$route->uri() : 'unmatched',
                'method' => $record->extra['request_method'] ?? request()->getMethod(),
                'ip' => request()->getClientIp(),
                'data' => '[]' ,
                'context' => json_encode($context),
                'created_at' => $record->datetime->getTimestamp(),
                'updated_at' => $record->datetime->getTimestamp(),
            ];

            $log += \App\Services\SystemLogService::metadata($context);
            $log['route_template'] = $route ? substr('/'.$route->uri(),0,512) : 'unmatched';
            LogModel::insert($log);
        }catch (\Throwable $e){
            Log::channel('daily')->error('Database log write failed');
        }
    }
}
