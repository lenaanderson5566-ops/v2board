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
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        \App\Services\TimeZones::apply();
        \Illuminate\Support\Facades\Queue::before(function () { \App\Services\TimeZones::apply(true); });
        \Illuminate\Support\Facades\Validator::resolver(function ($translator, $data, $rules, $messages, $attributes) {
            return new \App\Validation\Validator($translator, $data, $rules, $messages, $attributes);
        });
    }
}
