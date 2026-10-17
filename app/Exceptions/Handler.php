<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Support\Arr;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;
use Illuminate\View\ViewException;

class Handler extends ExceptionHandler
{
    /**
     * A list of the exception types that are not reported.
     *
     * @var array
     */
    protected $dontReport = [
        //
    ];

    /**
     * A list of the inputs that are never flashed for validation exceptions.
     *
     * @var array
     */
    protected $dontFlash = [
        'password',
        'password_confirmation',
    ];

    /**
     * Report or log an exception.
     *
     * @param  \Throwable  $exception
     * @return void
     *
     * @throws \Throwable
     */
    public function report(Throwable $exception)
    {
        if (request()->is('api/v10','api/v10/*')) {
            \Illuminate\Support\Facades\Log::error('V10 exception', ['requestId'=>request()->attributes->get('requestId'), 'exceptionClass'=>get_class($exception)]);
            return;
        }
        parent::report($exception);
    }

    /**
     * Render an exception into an HTTP response.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Throwable  $exception
     * @return \Symfony\Component\HttpFoundation\Response
     *
     * @throws \Throwable
     */
    public function render($request, Throwable $exception)
    {
        if ($request->is('api/v10','api/v10/*')) {
            $response = app(\App\Http\Middleware\V10::class)->exceptionResponse($request,$exception);
            if ($request->attributes->has('browser.session')) $response->headers->set('Cache-Control', 'private, no-store');
            return $response;
        }
        // API failures must not negotiate an HTML debug page, even before routing.
        if ($request->is('api', 'api/*')) $request->headers->set('Accept', 'application/json');
        if ($exception instanceof ViewException && !$request->is('api', 'api/*')) {
            abort(500, "主题渲染失败。如更新主题，参数可能发生变化请重新配置主题后再试。");
        }
        $response = parent::render($request, $exception);
        if ($request->is('api', 'api/*') || $request->attributes->has('browser.session')) $response->headers->set('Cache-Control', 'private, no-store');
        return $response;
    }


    protected function convertExceptionToArray(Throwable $e)
    {
        if (request()->is('api', 'api/*')) {
            return ['message' => $this->isHttpException($e) && $e->getStatusCode() < 500
                ? $e->getMessage() : __("Uh-oh, we've had some problems, we're working on it.")];
        }
        return config('app.debug') ? [
            'message' => $e->getMessage(),
            'exception' => get_class($e),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => collect($e->getTrace())->map(function ($trace) {
                return Arr::except($trace, ['args']);
            })->all(),
        ] : [
            'message' => $this->isHttpException($e) ? $e->getMessage() : __("Uh-oh, we've had some problems, we're working on it."),
        ];
    }
}
