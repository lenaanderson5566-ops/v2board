<?php
namespace App\Http\Controllers\V10;

final class UserDiagnosticController extends ResourceController {
    public function postMeDiagnosticReports(\Illuminate\Http\Request $request) {
        if (strlen($request->getContent()) > 8192) abort(413, 'Diagnostic report is too large.');
        $this->prepare($request, 'postMeDiagnosticReports');
        return $this->respond($request, app(\App\Services\Actions\User\DiagnosticActions::class)->store($request), 'postMeDiagnosticReports');
    }
}
