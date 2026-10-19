<?php
namespace App\Http\Controllers\V10;

use App\Models\User;
use App\Services\Actions\User\DeleteAccount;
use Illuminate\Http\Request;

final class AccountDeletionController extends ResourceController
{
    public function state(Request $request, DeleteAccount $action)
    {
        $this->prepare($request,'getMeAccountDeletion');
        $enabled=(bool)config('v2board.account_deletion_enable',0);
        return response()->json(['data'=>['enabled'=>$enabled,'blockers'=>$enabled ? $action->blockers(User::findOrFail($request->user['id'])) : []]]);
    }
    public function remove(Request $request, DeleteAccount $action)
    {
        abort_unless($request->isJson(),415,'JSON is required.');
        abort_if(strlen($request->getContent())>4096,413,'Request is too large.');
        abort_if(array_diff(array_keys($request->all()),['password','confirmation']),422,'Unsupported field.');
        $this->prepare($request,'deleteMe');
        $request->validate(['password'=>'required|string|max:128','confirmation'=>'required|in:DELETE']);
        $action->remove($request);
        return response('',204);
    }
}
