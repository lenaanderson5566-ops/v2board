<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {
        $this->app->scoped(\App\Services\NodeDictionary::class);
        $this->app->scoped(\App\Services\ClientRecognition::class);
        $this->app->scoped(\App\Services\ObservabilitySettings::class);
        $this->app->scoped(\App\Services\RequestPerformance::class);
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        \Illuminate\Support\Facades\DB::listen(function ($query) {
            app(\App\Services\RequestPerformance::class)->query((float)$query->time);
        });
        \App\Services\TimeZones::apply();
        \Illuminate\Support\Facades\Queue::before(function ($event) {
            \App\Services\TimeZones::apply(true);
            if (in_array($event->job->resolveName(), [\App\Jobs\SendEmailJob::class, \App\Jobs\SendCampaignMailJob::class], true)) {
                \App\Services\Mail\MailRateLimiter::reloadSettings();
            }
        });
        \Illuminate\Support\Facades\Validator::resolver(function ($translator, $data, $rules, $messages, $attributes) {
            return new \App\Validation\Validator($translator, $data, $rules, $messages, $attributes);
        });
    }
}
