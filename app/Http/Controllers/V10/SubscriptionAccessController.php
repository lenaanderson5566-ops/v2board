<?php
namespace App\Http\Controllers\V10;

use App\Services\Actions\User\SubscriptionAccessActions;
use Illuminate\Http\Request;

final class SubscriptionAccessController extends ResourceController
{
    public function index(Request $request, SubscriptionAccessActions $action)
    {
        $this->prepare($request, 'getMeSubscriptionAccessRecords');
        return $action->index($request);
    }
}
