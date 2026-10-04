<?php
namespace App\Http\Controllers;

// Compatibility adapter for existing administrator-defined subscription links.
class CustomSubscriptionController extends \App\Http\Controllers\Controller
{
    public function subscribe(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Client\ClientActions::class)->subscribe($request);
    }
}
